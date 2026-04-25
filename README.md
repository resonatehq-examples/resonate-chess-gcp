# Chess on GCP with Resonate

An AI-vs-AI chess game powered by [Resonate](https://resonatehq.io) durable execution, running on Google Cloud Platform. Two AI players compete move by move; each move is a durably-executed step — if the process crashes mid-game, it picks up exactly where it left off.

**How durable execution works here:** The `chessGame` generator function yields at every `ctx.run()` and `ctx.sleep()`. Resonate records each completed step's result in PostgreSQL. On every resume, the function replays instantly through already-completed steps and only executes the next pending one — so a 200-move game survives restarts, crashes, and cold starts.

---

## 1  GCP Project

```bash
# Use an existing project or create one
gcloud projects create resonate-chess --name="Resonate Chess"
gcloud config set project resonate-chess

# Enable every API we'll need in one shot
gcloud services enable \
  run.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  sqladmin.googleapis.com \
  firestore.googleapis.com \
  firebase.googleapis.com \
  artifactregistry.googleapis.com
```

Pick a region and stick with it throughout (Cloud SQL and Cloud Run should share a region to minimize latency):

```bash
export GCP_REGION=us-central1
export GCP_PROJECT=$(gcloud config get-value project)
```

---

## 2  Cloud SQL — PostgreSQL

### Create the instance

```bash
gcloud sql instances create resonate-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --edition=ENTERPRISE \
  --region=$GCP_REGION \
  --assign-ip
```

> `db-f1-micro` is the smallest (cheapest) tier — fine for development and light workloads.  
> `--edition=ENTERPRISE` is required; without it GCP rejects `db-f1-micro` and expects the newer ENTERPRISE_PLUS tier names.  
> `--assign-ip` gives the instance a public IP so Cloud Run can reach it over TCP. You must add an authorized network (see below) or restrict access to Cloud Run's egress IPs.

### Create the database and user

```bash
# Set a strong password
DB_PASSWORD="change-me-$(openssl rand -hex 8)"
echo "DB_PASSWORD=$DB_PASSWORD"   # save this

gcloud sql databases create resonate --instance=resonate-db
gcloud sql users create resonate \
  --instance=resonate-db \
  --password="$DB_PASSWORD"
```

### Note the Cloud SQL IP

```bash
export CLOUD_SQL_IP=$(gcloud sql instances describe resonate-db --format="value(ipAddresses[0].ipAddress)")
echo $CLOUD_SQL_IP
```

### Allow access from Cloud Run

For testing, open the instance to all IPs (remove this for production — use VPC + private IP instead):

```bash
gcloud sql instances patch resonate-db --authorized-networks=0.0.0.0/0 --quiet
```

---

## 3  Resonate Server — Cloud Run

The Resonate server image on GitHub Container Registry (`ghcr.io`) cannot be pulled directly by Cloud Run. Mirror it through Artifact Registry first:

```bash
# Create a Docker repository in Artifact Registry
gcloud artifacts repositories create resonate \
  --repository-format=docker \
  --location=$GCP_REGION

# Authenticate Docker to Artifact Registry
gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev --quiet

# Copy the linux/amd64 image (Cloud Run requires amd64; without --platform Docker may pull arm64 on Apple Silicon)
docker buildx imagetools create \
  --tag ${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/resonate/resonate:v0.9.3 \
  ghcr.io/resonatehq/resonate:v0.9.3@sha256:06801e48af809967d1e3ba00b612977b6a5a77db8fe3c35885bfbea34b70cbb4
```

> The digest above is the `linux/amd64` manifest for `v0.9.3`. Inspect with `docker buildx imagetools inspect ghcr.io/resonatehq/resonate:v0.9.3` to verify or find the digest for a newer version.

### Deploy (step 1 — get the URL)

Cloud Run assigns the service URL on first deploy. Deploy without `--server-url` first, record the URL, then redeploy with it set.

```bash
gcloud run deploy resonate-server \
  --image=${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/resonate/resonate:v0.9.3 \
  --region=$GCP_REGION \
  --platform=managed \
  --port=8080 \
  --min-instances=1 \
  --ingress=all \
  --set-env-vars="RESONATE_SERVER__PORT=8080" \
  --set-env-vars="RESONATE_STORAGE__TYPE=postgres" \
  --set-env-vars="RESONATE_STORAGE__POSTGRES__URL=postgres://resonate:${DB_PASSWORD}@${CLOUD_SQL_IP}/resonate?sslmode=require" \
  --set-env-vars="RESONATE_STORAGE__POSTGRES__POOL_SIZE=5" \
  --allow-unauthenticated
```

### Record the URL

```bash
export RESONATE_SERVER_URL=$(gcloud run services describe resonate-server \
  --region=$GCP_REGION --format="value(status.url)")
echo $RESONATE_SERVER_URL
# https://resonate-server-xxxxxxxxxx-uc.a.run.app
```

### Deploy (step 2 — pass `--server-url`)

The server must know its own public URL so it can embed it in execute messages sent to the chess function. Pass it via `--args` (not an env var — the binary's CLI parser does not accept `RESONATE_SERVER__URL`):

```bash
gcloud run deploy resonate-server \
  --image=${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/resonate/resonate:v0.9.3 \
  --region=$GCP_REGION \
  --platform=managed \
  --port=8080 \
  --min-instances=1 \
  --ingress=all \
  --args="serve,--server-url,${RESONATE_SERVER_URL}" \
  --set-env-vars="RESONATE_SERVER__PORT=8080" \
  --set-env-vars="RESONATE_STORAGE__TYPE=postgres" \
  --set-env-vars="RESONATE_STORAGE__POSTGRES__URL=postgres://resonate:${DB_PASSWORD}@${CLOUD_SQL_IP}/resonate?sslmode=require" \
  --set-env-vars="RESONATE_STORAGE__POSTGRES__POOL_SIZE=5" \
  --allow-unauthenticated
```

> **`--min-instances=1`** is important — the Resonate server must not cold-start because it holds in-flight scheduling state in memory between requests.  
> **`--ingress=all`** is required. `--ingress=internal` blocks `gcloud run services proxy` from developer machines (proxy traffic originates outside the VPC and is rejected at the GCP edge).  
> **`--allow-unauthenticated`** lets the Resonate CLI invoke the server directly without an identity token.  
> **`--args="serve,--server-url,…"`** tells the server its own public URL. Without this the execute messages sent to the chess function have an empty `serverUrl`, and the SDK falls back to `http://localhost:8001` — which fails. Do **not** use `RESONATE_SERVER__URL` as an env var; the binary interprets it as `--server` (unknown flag) and exits with code 2.  
> The Postgres URL uses the public IP with `sslmode=require`. Cloud SQL enforces SSL by default for public connections.

---

## 4  Chess Function — Cloud Functions Gen2

### Install dependencies and build

```bash
cd chess-match
npm install
npm run build
```

### Deploy

```bash
gcloud functions deploy chess-function \
  --gen2 \
  --runtime=nodejs22 \
  --region=$GCP_REGION \
  --source=. \
  --entry-point=handler \
  --trigger-http \
  --ingress-settings=all \
  --allow-unauthenticated \
  --memory=512MB \
  --set-env-vars="RESONATE_SERVER_URL=${RESONATE_SERVER_URL}"
```

> **`--allow-unauthenticated`** is needed because the Resonate server makes plain HTTP calls to this function without a GCP identity token.  
> **`--ingress-settings=all`** is required. Cloud Functions Gen2 is backed by Cloud Run. A Cloud Run service (Resonate server) calling another Cloud Run-backed service (chess function) is **not** treated as internal traffic unless both are in the same Shared VPC — without VPC, `--ingress-settings=internal-only` blocks the Resonate server's outbound calls.  
> **`--memory=512MB`** is required. `js-chess-engine` at level 4 peaks at ~308 MB RSS mid-game; 256 MB causes an OOM kill. Level 5 peaks at ~776 MB and would require 1+ GiB plus a CPU bump — not worth it for a demo.

### Record the URL

```bash
export CHESS_FUNCTION_URL=$(gcloud functions describe chess-function \
  --gen2 --region=$GCP_REGION --format="value(serviceConfig.uri)")
echo $CHESS_FUNCTION_URL
# https://chess-function-xxxxxxxxxx-uc.a.run.app
```

---

## 5  Firestore

### Enable Firestore

```bash
gcloud firestore databases create \
  --location=$GCP_REGION \
  --type=firestore-native
```

> If the command says "already exists", your project already has Firestore — that's fine.

### Security rules

The web UI reads game state from the browser. Deploy rules that allow public reads on the `chess-games` collection while blocking browser writes (only the server-side function writes via a service account):

```bash
gcloud services enable firebaserules.googleapis.com

ACCESS_TOKEN=$(gcloud auth print-access-token)

# Create a ruleset
RULESET=$(curl -s -X POST \
  "https://firebaserules.googleapis.com/v1/projects/${GCP_PROJECT}/rulesets" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: ${GCP_PROJECT}" \
  -d '{
    "source": {"files": [{"name": "firestore.rules", "content":
      "rules_version = '\''2'\'';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /chess-games/{gameId} {\n      allow read: if true;\n      allow write: if false;\n    }\n  }\n}"
    }]}
  }')
RULESET_NAME=$(echo "$RULESET" | python3 -c "import json,sys; print(json.load(sys.stdin)['name'])")

# Release the ruleset for Firestore
curl -s -X POST \
  "https://firebaserules.googleapis.com/v1/projects/${GCP_PROJECT}/releases" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: ${GCP_PROJECT}" \
  -d "{\"name\":\"projects/${GCP_PROJECT}/releases/cloud.firestore\",\"rulesetName\":\"$RULESET_NAME\"}"
```

> `gcloud firestore rules deploy` does not exist — Firebase Rules must be deployed via the Firebase CLI or the REST API as shown above.

---

## 6  Web UI

### Create a browser API key and update `chess-board/index.html`

The Firebase JS SDK needs an API key scoped to the GCP project. You do **not** need to add the project to the Firebase Console — the SDK uses `projectId` to reach Firestore directly.

```bash
gcloud services enable apikeys.googleapis.com

ACCESS_TOKEN=$(gcloud auth print-access-token)

# Create an unrestricted key (restrict to firestore.googleapis.com for production)
curl -s -X POST \
  "https://apikeys.googleapis.com/v2/projects/${GCP_PROJECT}/locations/global/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: ${GCP_PROJECT}" \
  -d '{"displayName": "Chess UI browser key"}' | python3 -m json.tool

# Wait a few seconds, then retrieve the key string
sleep 3
KEY_NAME=$(curl -s "https://apikeys.googleapis.com/v2/projects/${GCP_PROJECT}/locations/global/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Goog-User-Project: ${GCP_PROJECT}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['keys'][0]['name'])")

API_KEY=$(curl -s "https://apikeys.googleapis.com/v2/${KEY_NAME}/keyString" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Goog-User-Project: ${GCP_PROJECT}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['keyString'])")
echo "API_KEY=$API_KEY"
```

Open `chess-board/index.html` and replace the placeholder config near the top of the `<script>` block:

```js
const firebaseConfig = {
  apiKey:    "<API_KEY from above>",
  authDomain: "resonate-chess.firebaseapp.com",
  projectId: "resonate-chess",
};
```

### Serve locally

```bash
cd chess-board
python3 -m http.server 3000
# Open http://localhost:3000
```

### (Optional) Deploy to Cloud Storage

```bash
BUCKET="gs://${GCP_PROJECT}-chess-ui"
gcloud storage buckets create $BUCKET --location=$GCP_REGION --uniform-bucket-level-access

# Enable website serving
gcloud storage buckets update $BUCKET --web-main-page-suffix=index.html

gcloud storage cp chess-board/index.html chess-board/chess-scene.js $BUCKET --cache-control="no-cache"
gcloud storage objects update $BUCKET/index.html --add-acl-grant=entity=allUsers,role=READER
gcloud storage objects update $BUCKET/chess-scene.js --add-acl-grant=entity=allUsers,role=READER
```

The public URL will be `https://storage.googleapis.com/${GCP_PROJECT}-chess-ui/index.html`.

---

## 7  Run a Game

Open two terminals.

**Terminal 1 — start the UI:**

```bash
cd chess-board
python3 -m http.server 3000
```

**Terminal 2 — invoke a chess game:**

```bash
GAME_ID="chess/game-$(date +%s)"

resonate invoke \
  --server $RESONATE_SERVER_URL \
  --func chessGame \
  --target $CHESS_FUNCTION_URL \
  "$GAME_ID"
```

Open `http://localhost:3000` in your browser. The 3D board updates live as moves are played (roughly every 10 seconds). Every new game overwrites the `chess-games/current` document in Firestore — the UI always shows the latest game.

**Watch the execution tree:**

```bash
resonate tree --server $RESONATE_SERVER_URL "$GAME_ID"
```

**Check Cloud Logs:**

```bash
gcloud functions logs read chess-function --gen2 --region=$GCP_REGION --limit=50
```

---

## Local Development

You can run the chess function locally against a local Resonate server (no GCP needed during development).

### 1  Run Resonate locally

Install the Resonate CLI from [GitHub Releases](https://github.com/resonatehq/resonate/releases) and start it in dev mode (in-memory SQLite):

```bash
resonate dev --server-port 8002
```

### 2  Authenticate for Firestore

The function writes to Firestore even in local development — it targets whichever GCP project your ADC points to:

```bash
gcloud auth application-default login
```

### 3  Start the function locally

```bash
cd chess-match
npm install
npm run dev
# Listening on http://localhost:8080
```

### 4  Invoke locally

```bash
resonate invoke \
  --server http://localhost:8002 \
  --func chessGame \
  --target http://localhost:8080 \
  "chess/game-$(date +%s)"
```

Edit `chess-board/index.html` with your Firebase config, serve the UI (`python3 -m http.server 3000`), and open `http://localhost:3000`.

---

## Architecture Notes

### Why Firestore instead of NATS?

The original NATS version used a WebSocket connection from the browser to a NATS broker. Firestore provides the same real-time pub/sub behaviour as a managed GCP service — no broker to run, and the `onSnapshot` listener delivers updates in milliseconds.

### Why Resonate's replay model works here

Every time the Resonate server resumes the `chessGame` generator after a sleep, the function re-runs from the top. Completed `ctx.run()` calls (moves already made) return their stored results instantly without re-executing the AI engine. The `chess` variable is rebuilt by replaying moves in order. Only the next pending step actually executes. This is why the game survives crashes, cold starts, and redeployments.

### Cloud SQL TCP connection

The Resonate server connects to Cloud SQL over TCP using the instance's public IP address (`sslmode=require`). Cloud SQL enforces SSL on public connections. For production, use a private IP and VPC peering instead — that removes the need for `--authorized-networks=0.0.0.0/0`.

### Keeping costs small

| Resource | Smallest option | Approximate cost |
|----------|-----------------|-----------------|
| Cloud SQL | `db-f1-micro` | ~$7/month |
| Resonate Server | Cloud Run, 1 min instance, 256MB | ~$5/month |
| Chess Function | Cloud Functions Gen2, invocations-based, 512 MB | cents/game |
| Firestore | free tier covers hobby use | $0 |

To zero out costs when not playing, scale Cloud Run min instances to 0 (games in flight will fail to resume, but the DB stays intact):

```bash
gcloud run services update resonate-server --region=$GCP_REGION --min-instances=0
```
