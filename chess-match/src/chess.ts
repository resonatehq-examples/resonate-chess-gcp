import type { Context } from "@resonatehq/sdk";
import type { Firestore } from "@google-cloud/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { Chess, type Move, type Square } from "chess.js";
import { Game } from "js-chess-engine";
import { z } from "zod";

// ── Constants ─────────────────────────────────────────────────────────────────

const MOVE_DELAY_MS = 4500;
const GAME_PAUSE_MS = 6000;

// White = engine (js-chess-engine level 3). Black = Claude Haiku 4.5.
// The resonatehq.io hero is labelled "White · js-chess-engine L3" / "Black ·
// Claude Haiku 4.5" — these constants are what those labels are claiming.
const WHITE_LEVEL = 3;
const AGENT_MODEL = "claude-haiku-4-5-20251001";
const AGENT_MAX_RETRIES = 2;

const AGENT_SYSTEM_PROMPT = `You are playing a game of chess as Black against a deterministic opponent.

Your job each turn: look at the FEN position and the list of legal moves, pick one move, and give one short sentence of reasoning.

Rules for your output:
- "move" must be one of the legal moves, verbatim, in UCI format (e.g. "e7e5", "g8f6", with promotion suffix like "e7e8q" when relevant).
- "reasoning" is ONE sentence. Be concrete — name the piece and the goal (attack, defend, develop, trade, etc.). No filler, no hedging.
- If you see a forced tactic (fork, pin, mate in N), say so. Otherwise prefer moves that develop pieces, control the center, and keep your king safe.
- You are Black. Do not confuse yourself with White.`;

const AgentMoveSchema = z.object({
  move: z.string(),
  reasoning: z.string(),
});
type AgentMove = z.infer<typeof AgentMoveSchema>;

const anthropic = new Anthropic();

// ── Game ──────────────────────────────────────────────────────────────────────

export function* chessGame(ctx: Context, gameNumber = 1): Generator<any, void, any> {
  const game = new Chess();
  let moveCount = 0;

  yield* ctx.run(publish, buildState(game, undefined, moveCount));

  while (!game.isGameOver()) {
    const side = game.turn();
    let uci: string;
    let reasoning: string | undefined;

    if (side === "w") {
      uci = yield* ctx.run(enginePlayer, game.fen(), WHITE_LEVEL);
    } else {
      const legal = legalMovesUci(game);
      const history = recentHistory(game);
      const result = yield* ctx.run(agentPlayer, game.fen(), legal, history);
      uci = result.move;
      reasoning = result.reasoning;
    }

    const move = applyUciMove(game, uci);
    moveCount++;

    yield* ctx.run(publish, buildState(game, move, moveCount, reasoning));
    yield* ctx.sleep(MOVE_DELAY_MS);
  }

  yield* ctx.sleep(GAME_PAUSE_MS);

  // Each game is its own root promise so replay cost stays bounded to a single
  // game. Detaching here breaks lineage: the next game has its own origin and
  // won't replay this game's promise tree. Forever-loops inside a single
  // durable invocation eventually hit a replay-vs-lease cliff (1199 errors).
  yield* ctx.detached(chessGame, gameNumber + 1);
}

// ── Players ───────────────────────────────────────────────────────────────────

async function enginePlayer(_ctx: Context, fen: string, level: number): Promise<string> {
  const { move } = new Game(fen).ai({ level });
  const [from, to] = Object.entries(move)[0] as [string, string];
  return `${from.toLowerCase()}${to.toLowerCase()}`;
}

async function agentPlayer(
  _ctx: Context,
  fen: string,
  legalMoves: string[],
  historyText: string,
): Promise<AgentMove> {
  const userMessage = [
    `FEN: ${fen}`,
    `Side to move: Black`,
    `Recent moves (SAN): ${historyText}`,
    `Legal moves (UCI): ${legalMoves.join(", ")}`,
    ``,
    `Pick one move from the legal list. Respond with the JSON schema.`,
  ].join("\n");

  let lastError: string | null = null;

  for (let attempt = 0; attempt <= AGENT_MAX_RETRIES; attempt++) {
    const correction = lastError
      ? `\n\nYour previous attempt was invalid: ${lastError}. Pick a move that is literally present in the legal moves list above.`
      : "";

    const response = await anthropic.messages.parse({
      model: AGENT_MODEL,
      max_tokens: 512,
      system: [
        {
          type: "text",
          text: AGENT_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage + correction }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              move: { type: "string" },
              reasoning: { type: "string" },
            },
            required: ["move", "reasoning"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      lastError = "model returned no structured output";
      continue;
    }
    const validation = AgentMoveSchema.safeParse(parsed);
    if (!validation.success) {
      lastError = `output did not match schema (${validation.error.message})`;
      continue;
    }

    const candidate = validation.data.move.trim().toLowerCase();
    if (legalMoves.includes(candidate)) {
      return { move: candidate, reasoning: validation.data.reasoning };
    }
    lastError = `"${candidate}" is not in the legal moves list`;
  }

  const fallback = legalMoves[Math.floor(Math.random() * legalMoves.length)];
  return {
    move: fallback,
    reasoning: `Fallback: random legal move (agent produced invalid output — ${lastError ?? "unknown"})`,
  };
}

// ── Firestore ─────────────────────────────────────────────────────────────────

async function publish(ctx: Context, state: Record<string, unknown>): Promise<void> {
  const db = ctx.getDependency("firestore") as Firestore;
  await db.collection("chess").doc("live").set(state);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildState(
  game: Chess,
  lastMove: Move | undefined,
  moveCount: number,
  agentReasoning?: string,
): Record<string, unknown> {
  const state: Record<string, unknown> = {
    fen: game.fen(),
    turn: game.turn(),
    moveCount,
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isStalemate: game.isStalemate(),
    isDraw: game.isDraw(),
    isGameOver: game.isGameOver(),
    updatedAt: Date.now(),
  };
  if (lastMove) {
    const m: Record<string, string> = { from: lastMove.from, to: lastMove.to };
    if (lastMove.captured) m.captured = lastMove.captured;
    state.lastMove = m;
  }
  if (agentReasoning) state.agentReasoning = agentReasoning;
  if (game.isCheckmate()) {
    state.result = game.turn() === "w" ? "black" : "white";
  } else if (game.isDraw() || game.isStalemate()) {
    state.result = "draw";
  }
  return state;
}

function legalMovesUci(game: Chess): string[] {
  return game.moves({ verbose: true }).map((m) => {
    const promo = m.promotion ? m.promotion : "";
    return `${m.from}${m.to}${promo}`;
  });
}

function recentHistory(game: Chess, count = 6): string {
  const h = game.history();
  if (h.length === 0) return "(no moves yet — this is the first move of the game)";
  return h.slice(-count).join(" ");
}

function applyUciMove(game: Chess, uci: string): Move {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  let promotion = uci.length > 4 ? uci[4] : undefined;
  if (!promotion) {
    // js-chess-engine returns promotions without the piece; default to queen
    // when a pawn lands on the back rank.
    const piece = game.get(from as Square);
    if (
      piece?.type === "p" &&
      ((piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1"))
    ) {
      promotion = "q";
    }
  }
  const move = game.move({ from, to, promotion });
  if (!move) throw new Error(`Invalid move: ${uci} in position ${game.fen()}`);
  return move;
}
