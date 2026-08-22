import { Resonate } from "@resonatehq/gcp";
import { Firestore } from "@google-cloud/firestore";
import { chessGame } from "./chess";

const resonate = new Resonate({
  // Task lease must safely exceed the Cloud Function's 3600s timeout so the
  // server never reassigns a task that's still running mid-invocation.
  ttl: 65 * 60 * 1000,
});

// ignoreUndefinedProperties so optional fields (lastMove, agentReasoning,
// result) can be omitted from the published state without throwing.
const firestore = new Firestore({ ignoreUndefinedProperties: true });

resonate.setDependency("firestore", firestore);
resonate.register("chessGame", chessGame);

export const handler = resonate.handlerHttp();
