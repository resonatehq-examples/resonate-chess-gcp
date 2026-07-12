import { Resonate } from "@resonatehq/gcp";
import { Firestore } from "@google-cloud/firestore";
import { chessGame } from "./chess";

const resonate = new Resonate({
  // Task lease must safely exceed the Cloud Function's 540s timeout so the
  // server never reassigns a task that's still running mid-invocation.
  ttl: 10 * 60 * 1000,
});

// ignoreUndefinedProperties so optional fields (lastMove, agentReasoning,
// result) can be omitted from the published state without throwing.
const firestore = new Firestore({ ignoreUndefinedProperties: true });

resonate.setDependency("firestore", firestore);
// @resonatehq/gcp 0.2.x bundles its own SDK 0.10.x copy, so its register()
// signature comes from a different type graph than this package's 0.11.x
// import. The generator-engine runtime contract is identical across the two;
// drop the assertion once the adapter depends on SDK 0.11.
resonate.register("chessGame", chessGame as any);

export const handler = resonate.handlerHttp();
