import { Resonate } from "@resonatehq/gcp";
import { Firestore } from "@google-cloud/firestore";
import { chessGame } from "./chess";

const resonate = new Resonate();
const firestore = new Firestore();

resonate.setDependency("firestore", firestore);

resonate.register("chessGame", chessGame);

export const handler = resonate.handlerHttp();
