# Chess on GCP with Resonate

A live AI-vs-AI chess game powered by [Resonate](https://resonatehq.io) durable execution, running on Google Cloud Platform. White is a deterministic chess engine, Black is Claude Haiku 4.5 — each move is a durably-executed step, so if the process crashes mid-game it resumes from the next pending step instead of restarting the match.

Live demo: https://resonatehq-examples.github.io/resonate-chess-gcp/

Also powers the live hero on https://resonatehq.io.

![Chess · Resonate](chess-board/chess.jpg)

```typescript
export function* chessGame(ctx: Context, gameNumber = 1) {
  const game = new Chess();
  let moveCount = 0;

  yield* ctx.run(publish, buildState(game, undefined, moveCount));

  while (!game.isGameOver()) {
    const uci = game.turn() === "w"
      ? yield* ctx.run(enginePlayer, game.fen(), WHITE_LEVEL)
      : (yield* ctx.run(agentPlayer, game.fen(), legalMovesUci(game), recentHistory(game))).move;

    const move = applyUciMove(game, uci);
    moveCount++;

    yield* ctx.run(publish, buildState(game, move, moveCount));
    yield* ctx.sleep(MOVE_DELAY_MS);
  }

  yield* ctx.sleep(GAME_PAUSE_MS);

  // Each game is its own root promise — replay scope stays bounded forever.
  yield* ctx.detached(chessGame, gameNumber + 1);
}
```

## How It Works

Every Google Cloud Function invocation has two phases: replay and resume. On replay, the Resonate SDK runs the function again from the top, but any promise that has already completed, whether from `ctx.run()` or `ctx.sleep()`, advances immediately instead of executing again. On resume, execution reaches the first pending promise and continues from there.

When execution reaches a pending `ctx.sleep()`, the workflow suspends and the current invocation ends. The Resonate server waits for the timer promise to complete, then starts a fresh invocation.

### One game = one root promise

`chessGame` resolves at game-over. The last yield is `ctx.detached(chessGame, n + 1)`, which starts the next game as a brand-new root with its own origin id. Replay scope is bounded to a single game forever, regardless of how long the demo runs.

A previous shape was `while(true) { play one game }` inside a single durable invocation. After thousands of accumulated child promises, each replay took longer than the task lease and the server would reassign tasks mid-execution (`code 1199 — Task is not acquired`). The detach-per-game shape avoids that entirely.

`@resonatehq/gcp` defaults `ttl` (acquired-task lease) to 5min. We set it to 10min in `index.ts` so it always exceeds the Cloud Function's 540s timeout — belt-and-braces against any single invocation that legitimately runs long.

## State Bus — Firestore

Each move publishes a snapshot to Firestore at `chess/live`:

```ts
{
  fen: string,
  turn: "w" | "b",
  moveCount: number,
  isCheck: boolean,
  isCheckmate: boolean,
  isStalemate: boolean,
  isDraw: boolean,
  isGameOver: boolean,
  updatedAt: number,
  lastMove?: { from: string, to: string, captured?: string },
  agentReasoning?: string,   // Black's one-sentence reason for the move
  result?: "white" | "black" | "draw",
}
```

Browser clients subscribe via Firebase JS SDK `onSnapshot('chess/live')`. The `chess-board/` static page in this repo and the hero on resonatehq.io both consume this same shape. No SSE gateway, no always-on service on the worker side — the function scales to zero between moves.

## Players

- **White** — `js-chess-engine` at level 3 (pure JS, deterministic minimax). Pulled in as a Cloud Function dep, no native binary or WASM.
- **Black** — Claude Haiku 4.5 via the Anthropic SDK. Returns `{ move, reasoning }` as structured JSON output, validated against the legal-moves list with up to 2 retries on invalid output, then falls back to a random legal move if all retries fail.

## Cost Profile

| Resource | Smallest option | Approximate cost |
|----------|-----------------|-----------------|
| Cloud SQL | `db-f1-micro` | ~$7/month |
| Resonate Server | Cloud Run, 1 min instance, 256MB | ~$5/month |
| Chess Function | Cloud Functions Gen2, 512MB, ~5s active every ~4.5s | ~$3/month |
| Firestore | free tier covers hobby use | $0 |
| Anthropic API | Haiku 4.5, ~1 call per Black move, prompt cached | depends on traffic |

## Files

- `chess-match/src/index.ts` — registers `chessGame`, injects Firestore as a Resonate dependency, exports the HTTP handler
- `chess-match/src/chess.ts` — the `chessGame` generator, both players, Firestore publish, helpers
- `chess-board/` — static SVG board for GitHub Pages, subscribes to `chess/live`
- `firestore.rules` — public-read on `chess/{docId}`, writes server-only

## Deploy

The Cloud Function needs an Anthropic API key for the Black player. Set it as a secret in your project first:

```bash
echo -n "<ANTHROPIC_API_KEY>" | gcloud secrets create anthropic-api-key --data-file=-
```

Then deploy the worker:

```bash
cd chess-match
npm run build
gcloud functions deploy chess-match \
  --gen2 --region=us-central1 --runtime=nodejs22 \
  --source=. --entry-point=handler --trigger-http \
  --allow-unauthenticated \
  --memory=512Mi --timeout=540s \
  --set-env-vars=RESONATE_URL=<resonate-server-url> \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --project=<gcp-project>
```

Kick off the chain once (each game self-detaches the next):

```bash
resonate invoke chess-game-1 \
  --func chessGame \
  --data '{"args":[1]}' \
  --server <resonate-server-url> \
  --target <function-url> \
  --timeout 24h
```
