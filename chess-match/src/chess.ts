import type { Context } from "@resonatehq/sdk";
import type { Firestore } from "@google-cloud/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { Game } from "js-chess-engine";
import { Chess } from "chess.js";

// ── Game ──────────────────────────────────────────────────────────────────────

export function* chessGame(ctx: Context): Generator<any, void, any> {
  const chess = new Chess();

  while (!chess.isGameOver()) {
    const pFn = chess.turn() === "w" ? gePlayer : aiPlayer;
    const san = yield* ctx.run(pFn, chess.fen());
    chess.move(san);

    const state: GameState = { gameOver: false, fen: chess.fen(), san };
    yield* ctx.run(publish, state);
    yield* ctx.sleep(10 * 1000);
  }

  const final: GameState = { gameOver: true, result: gameResult(chess) };
  yield* ctx.run(publish, final);

  yield* ctx.detached(chessGame);
}

// ── Players ───────────────────────────────────────────────────────────────────

async function gePlayer(_ctx: Context, fen: string): Promise<string> {
  const { move } = new Game(fen).ai({ level: 4 });
  const [from, to] = Object.entries(move)[0] as [string, string];
  return new Chess(fen).move({
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    promotion: "q",
  }).san;
}

async function aiPlayer(_ctx: Context, fen: string): Promise<string> {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  const uci = legal.map((m) => m.from + m.to + (m.promotion ?? ""));

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16,
    messages: [
      {
        role: "user",
        content: `You are playing chess as Black. FEN: ${fen}\nLegal moves (UCI): ${uci.join(", ")}\nReply with exactly one move from the list. Nothing else.`,
      },
    ],
  });

  const text = (
    response.content[0] as { type: "text"; text: string }
  ).text.trim();
  const move =
    chess.move(text) ??
    chess.move({ from: text.slice(0, 2), to: text.slice(2, 4), promotion: text[4] ?? "q" });
  if (!move) {
    throw new Error(`illegal move from Claude: ${text}`);
  }
  return move.san;
}

// ── Firestore ─────────────────────────────────────────────────────────────────

async function publish(ctx: Context, state: GameState): Promise<void> {
  const db = ctx.getDependency("firestore") as Firestore;
  await db
    .collection("chess-games")
    .doc("current")
    .set(state as Record<string, unknown>);
}

// ── Types & Helpers ───────────────────────────────────────────────────────────

type GameResult =
  | { outcome: "checkmate"; winner: "white" | "black"; moves: number }
  | { outcome: "stalemate"; moves: number }
  | { outcome: "draw"; reason: string; moves: number };

type GameState =
  | { gameOver: false; fen: string; san: string }
  | { gameOver: true; result: GameResult };

function gameResult(chess: Chess): GameResult {
  const moves = chess.history().length;
  if (chess.isCheckmate()) {
    return {
      outcome: "checkmate",
      winner: chess.turn() === "w" ? "black" : "white",
      moves,
    };
  }
  if (chess.isStalemate()) return { outcome: "stalemate", moves };
  if (chess.isInsufficientMaterial())
    return { outcome: "draw", reason: "insufficient-material", moves };
  if (chess.isThreefoldRepetition())
    return { outcome: "draw", reason: "threefold-repetition", moves };
  return { outcome: "draw", reason: "other", moves };
}
