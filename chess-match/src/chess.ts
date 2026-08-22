import { Exponential, type Context } from "@resonatehq/sdk";
import type { Firestore } from "@google-cloud/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { Chess, type Move, type Square } from "chess.js";
import { z } from "zod";

// ── Constants ─────────────────────────────────────────────────────────────────

const MOVE_DELAY_MS = 4500;
const GAME_PAUSE_MS = 6000;

// Hard cap on game length, in plies. Every move adds durable steps that each
// subsequent resume must replay, and replay does one server roundtrip per
// recorded step — so per-invocation time grows linearly with the ply count.
// Measured against a live chain: ~0.72s per recorded step, and each ply records
// three steps (agent call, publish, sleep), so the resume that plays ply p costs
// roughly 2.16 * p seconds. At this cap that is ~346s, and it has to fit inside
// the Cloud Function request timeout alongside the agent call itself and any
// AGENT_MAX_RETRIES attempts. Once a resume can no longer reach the next step
// before the platform deadline, every retry replays the same prefix and dies the
// same way (HTTP 504): the board freezes mid-game and no retry gets further. The
// function is therefore deployed at the gen2 maximum 3600s timeout, which leaves
// roughly 10x headroom at this cap. Two LLMs shuffling a locked endgame can
// outrun the fifty-move rule for hundreds of plies, so games that reach the cap
// are adjudicated as draws and the chain detaches into the next game, which
// starts with an empty replay again.
const MAX_PLIES = 160;

// Both players are Claude Haiku 4.5 — the SAME agent loop, forked twice. The
// only thing that differs between White and Black is the system prompt: one is
// told to attack, the other to play positionally. Same model, same tools (the
// legal-move list), same finish line (game over). That is the whole point the
// resonatehq.ai hero is making: you reshape one durable loop, you don't rebuild
// a new agent each time.
const AGENT_MODEL = "claude-haiku-4-5-20251001";
const AGENT_MAX_RETRIES = 2;

const WHITE_SYSTEM_PROMPT = `You are playing a game of chess as White. Your style is aggressive: seize the initiative, develop with tempo, open lines toward the enemy king, and take tactical chances.

Your job each turn: look at the FEN position and the list of legal moves, pick one move, and give one short sentence of reasoning.

Rules for your output:
- "move" must be one of the legal moves, verbatim, in UCI format (e.g. "e2e4", "g1f3", with promotion suffix like "e7e8q" when relevant).
- "reasoning" is ONE sentence. Be concrete — name the piece and the goal (attack, open a file, sacrifice for initiative, etc.). No filler, no hedging.
- If you see a forced tactic (fork, pin, mate in N), take it. Otherwise prefer moves that create threats, contest the center, and keep the initiative.
- You are White. Do not confuse yourself with Black.`;

const BLACK_SYSTEM_PROMPT = `You are playing a game of chess as Black. Your style is positional: prioritize a solid structure, a safe king, active pieces, and favorable trades over sharp risks.

Your job each turn: look at the FEN position and the list of legal moves, pick one move, and give one short sentence of reasoning.

Rules for your output:
- "move" must be one of the legal moves, verbatim, in UCI format (e.g. "e7e5", "g8f6", with promotion suffix like "a2a1q" when relevant).
- "reasoning" is ONE sentence. Be concrete — name the piece and the goal (develop, defend, trade, fix a weakness, etc.). No filler, no hedging.
- If you see a forced tactic (fork, pin, mate in N), take it. Otherwise prefer moves that develop pieces, control the center, keep your king safe, and avoid weaknesses.
- You are Black. Do not confuse yourself with White.`;

const SYSTEM_PROMPTS: Record<"w" | "b", string> = {
  w: WHITE_SYSTEM_PROMPT,
  b: BLACK_SYSTEM_PROMPT,
};

const AgentMoveSchema = z.object({
  move: z.string(),
  reasoning: z.string(),
});
type AgentMove = z.infer<typeof AgentMoveSchema>;

const anthropic = new Anthropic();

// Bounded Resonate-level retry policy for agentPlayer ctx.run calls.
// On an API outage the step backs off exponentially (1s, 2s, 4s … up to 60s)
// for up to 15 retries (~20 min total headroom), then rejects the promise.
// The chain rejects, the board freezes, and a manual re-seed restarts the game
// — see the Operations section in the README.
const AGENT_RETRY_POLICY = new Exponential({ delay: 1000, factor: 2, maxRetries: 15, maxDelay: 60000 });

// ── Game ──────────────────────────────────────────────────────────────────────

export function* chessGame(ctx: Context, gameNumber = 1): Generator<any, void, any> {
  const game = new Chess();
  let moveCount = 0;

  yield* ctx.run(publish, buildState(game, undefined, moveCount));

  while (!game.isGameOver() && moveCount < MAX_PLIES) {
    const side = game.turn();

    // Every move is a durable step. Asking Claude for a move is wrapped in the
    // exact same primitive — ctx.run — as writing state below: an LLM call is
    // just a durable step. If the API flakes, the step retries; if Claude hands
    // back an illegal move, agentPlayer corrects it before we ever apply it.
    const { move: uci, reasoning } = yield* ctx.run(
      agentPlayer,
      side,
      game.fen(),
      legalMovesUci(game),
      recentHistory(game),
      ctx.options({ retryPolicy: AGENT_RETRY_POLICY }),
    );

    const move = applyUciMove(game, uci);
    moveCount++;

    yield* ctx.run(publish, buildState(game, move, moveCount, reasoning));

    // Durable suspension. The worker terminates here; the server holds the
    // continuation in Postgres and re-invokes the function when the timer
    // fires. Between moves there is no long-lived process to pay for.
    yield* ctx.sleep(MOVE_DELAY_MS);
  }

  if (!game.isGameOver()) {
    // Move cap reached — adjudicate. The position is still legal chess, so
    // publish one final snapshot that declares the game over and drawn; the
    // board only keys off isGameOver/result, never off chess.js state.
    yield* ctx.run(publish, adjudicatedDrawState(game, moveCount));
  }

  yield* ctx.sleep(GAME_PAUSE_MS);

  // Each game is its own root promise so replay cost stays bounded to a single
  // game. Detaching here breaks lineage: the next game has its own origin and
  // won't replay this game's promise tree — every game plays out in its own
  // crash domain. Forever-loops inside a single durable invocation eventually
  // hit a replay-vs-lease cliff (1199 errors).
  //
  // The SDK assigns the next promise's id automatically. SDK versions before
  // 0.10.4 grew the id by one segment per generation, which eventually
  // overflowed the server's task.suspend payload and froze long-running
  // chains. The SDK now bounds detached ids via a pinned `resonate:prefix`
  // tag (each generation is `${prefix}.d${hash}`, one segment past the prefix
  // at every depth), so this self-detaching shape runs indefinitely without
  // re-seeding. See https://github.com/resonatehq/resonate-sdk-ts/pull/528.
  yield* ctx.detached(chessGame, gameNumber + 1);
}

// ── Player ──────────────────────────────────────────────────────────────────

// agentPlayer is not Resonate-specific — it's a Claude-API surface (structured
// output + schema validation + retry/fallback). The "Resonate-shaped" code in
// this file is small: the `chessGame` generator above, the `publish` ctx.run,
// and the `ctx.detached(chessGame, n+1)` self-restart pattern that bounds
// replay scope to a single game. Everything below this comment is plumbing
// around the language model; treat it as one example of an LLM player rather
// than as Resonate guidance.
//
// Both players call this same function — only `side` (and so the system prompt)
// changes. That is "fork one loop and reshape it" made literal.

async function agentPlayer(
  _ctx: Context,
  side: "w" | "b",
  fen: string,
  legalMoves: string[],
  historyText: string,
): Promise<AgentMove> {
  const sideLabel = side === "w" ? "White" : "Black";
  const userMessage = [
    `FEN: ${fen}`,
    `Side to move: ${sideLabel}`,
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

    let response: Awaited<ReturnType<typeof anthropic.messages.parse>>;
    try {
      response = await anthropic.messages.parse({
        model: AGENT_MODEL,
        max_tokens: 512,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPTS[side],
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
    } catch (apiErr) {
      // API-level failure (429, network, revoked key, etc.) — this is NOT a
      // bad-output retry. Log it, pause briefly, and count it as an attempt.
      // We do NOT fall back to a random move on API errors: that would be
      // dishonest for a "two Claude agents" demo.
      const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      console.error(`[agentPlayer] API error (attempt ${attempt + 1}/${AGENT_MAX_RETRIES + 1}): ${msg}`);
      if (attempt < AGENT_MAX_RETRIES) {
        // Short in-function pause before the next attempt: 2s, 4s, 6s.
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      } else {
        // All attempts failed with API errors — rethrow so Resonate's bounded
        // retry policy (AGENT_RETRY_POLICY) handles the outage. The game pauses
        // until the API recovers or the retry budget is exhausted.
        throw apiErr;
      }
      continue;
    }

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

  // All attempts failed due to bad model output (schema-valid but illegal /
  // malformed move). The random fallback is appropriate here: the API is
  // responding, the model is just confused.
  const fallback = legalMoves[Math.floor(Math.random() * legalMoves.length)];
  return {
    move: fallback,
    reasoning: `Fallback: random legal move (agent produced invalid output — ${lastError ?? "unknown"})`,
  };
}

// ── Firestore ─────────────────────────────────────────────────────────────────

async function publish(ctx: Context, state: Record<string, unknown>): Promise<void> {
  const db = ctx.getDependency("firestore") as Firestore;
  console.log("[publish]", JSON.stringify(state));
  await db.collection("chess").doc("live").set(state);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildState(
  game: Chess,
  lastMove: Move | undefined,
  moveCount: number,
  agentReasoning?: string, // the mover's one-sentence reason — set for both sides
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

function adjudicatedDrawState(game: Chess, moveCount: number): Record<string, unknown> {
  const state = buildState(
    game,
    undefined,
    moveCount,
    `Adjudicated: game reached the ${MAX_PLIES}-ply cap and is scored as a draw.`,
  );
  state.isGameOver = true;
  state.isDraw = true;
  state.result = "draw";
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
    // Default under-specified promotions to a queen when a pawn reaches the
    // back rank.
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
