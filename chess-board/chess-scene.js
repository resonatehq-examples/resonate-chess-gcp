// 2D SVG chess renderer.
//
// Mirrors the resonatehq.io hero board: slate cells, FontAwesome-solid piece
// silhouettes, champagne-ember highlights for last-move/capture/check.
//
// Keeps the same `new ChessScene(el, opts)` + `scene.next(state)` API the
// original 3D scene exposed, so index.html only needed minor cleanup.

import { Chess } from "https://esm.sh/chess.js@1.4.0";

// ── Constants ─────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

const BOARD_SIZE = 8;
const CELL_SIZE = 64;
const CELL_GAP = 2;
const BOARD_PX = BOARD_SIZE * CELL_SIZE + (BOARD_SIZE - 1) * CELL_GAP;
const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const COLORS = {
  cellLight:    "#64748B",
  cellDark:     "#334155",
  cellBorder:   "rgba(255, 255, 255, 0.06)",
  pieceWhite:   "#F8FAFC",
  pieceBlack:   "#0F172A",
  accent:       "#FBBF24",
  captureFlash: "#DC2626",
};

// FontAwesome solid (chess-king/queen/rook/bishop/knight/pawn) — same paths
// the resonatehq.io hero board uses.
const PIECES = {
  k: { vw: 448, vh: 512, path: "M224 0c17.7 0 32 14.3 32 32l0 16 16 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-16 0 0 48 152 0c22.1 0 40 17.9 40 40c0 5.3-1 10.5-3.1 15.4L368 400 80 400 3.1 215.4C1 210.5 0 205.3 0 200c0-22.1 17.9-40 40-40l152 0 0-48-16 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l16 0 0-16c0-17.7 14.3-32 32-32zM38.6 473.4L80 432l288 0 41.4 41.4c4.2 4.2 6.6 10 6.6 16c0 12.5-10.1 22.6-22.6 22.6L54.6 512C42.1 512 32 501.9 32 489.4c0-6 2.4-11.8 6.6-16z" },
  q: { vw: 512, vh: 512, path: "M256 0a56 56 0 1 1 0 112A56 56 0 1 1 256 0zM134.1 143.8c3.3-13 15-23.8 30.2-23.8c12.3 0 22.6 7.2 27.7 17c12 23.2 36.2 39 64 39s52-15.8 64-39c5.1-9.8 15.4-17 27.7-17c15.3 0 27 10.8 30.2 23.8c7 27.8 32.2 48.3 62.1 48.3c10.8 0 21-2.7 29.8-7.4c8.4-4.4 18.9-4.5 27.6 .9c13 8 17.1 25 9.2 38L399.7 400 384 400l-40.4 0-175.1 0L128 400l-15.7 0L5.4 223.6c-7.9-13-3.8-30 9.2-38c8.7-5.3 19.2-5.3 27.6-.9c8.9 4.7 19 7.4 29.8 7.4c29.9 0 55.1-20.5 62.1-48.3zM112 432l288 0 41.4 41.4c4.2 4.2 6.6 10 6.6 16c0 12.5-10.1 22.6-22.6 22.6L86.6 512C74.1 512 64 501.9 64 489.4c0-6 2.4-11.8 6.6-16L112 432z" },
  r: { vw: 448, vh: 512, path: "M32 192L32 48c0-8.8 7.2-16 16-16l64 0c8.8 0 16 7.2 16 16l0 40c0 4.4 3.6 8 8 8l32 0c4.4 0 8-3.6 8-8l0-40c0-8.8 7.2-16 16-16l64 0c8.8 0 16 7.2 16 16l0 40c0 4.4 3.6 8 8 8l32 0c4.4 0 8-3.6 8-8l0-40c0-8.8 7.2-16 16-16l64 0c8.8 0 16 7.2 16 16l0 144c0 10.1-4.7 19.6-12.8 25.6L352 256l16 144L80 400 96 256 44.8 217.6C36.7 211.6 32 202.1 32 192zm176 96l32 0c8.8 0 16-7.2 16-16l0-48c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 48c0 8.8 7.2 16 16 16zM22.6 473.4L64 432l320 0 41.4 41.4c4.2 4.2 6.6 10 6.6 16c0 12.5-10.1 22.6-22.6 22.6L38.6 512C26.1 512 16 501.9 16 489.4c0-6 2.4-11.8 6.6-16z" },
  b: { vw: 320, vh: 512, path: "M128 0C110.3 0 96 14.3 96 32c0 16.1 11.9 29.4 27.4 31.7C78.4 106.8 8 190 8 288c0 47.4 30.8 72.3 56 84.7L64 400l192 0 0-27.3c25.2-12.5 56-37.4 56-84.7c0-37.3-10.2-72.4-25.3-104.1l-99.4 99.4c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6L270.8 154.6c-23.2-38.1-51.8-69.5-74.2-90.9C212.1 61.4 224 48.1 224 32c0-17.7-14.3-32-32-32L128 0zM48 432L6.6 473.4c-4.2 4.2-6.6 10-6.6 16C0 501.9 10.1 512 22.6 512l274.7 0c12.5 0 22.6-10.1 22.6-22.6c0-6-2.4-11.8-6.6-16L272 432 48 432z" },
  n: { vw: 448, vh: 512, path: "M96 48L82.7 61.3C70.7 73.3 64 89.5 64 106.5l0 132.4c0 10.7 5.3 20.7 14.2 26.6l10.6 7c14.3 9.6 32.7 10.7 48.1 3l3.2-1.6c2.6-1.3 5-2.8 7.3-4.5l49.4-37c6.6-5 15.7-5 22.3 0c10.2 7.7 9.9 23.1-.7 30.3L90.4 350C73.9 361.3 64 380 64 400l320 0 28.9-159c2.1-11.3 3.1-22.8 3.1-34.3l0-14.7C416 86 330 0 224 0L83.8 0C72.9 0 64 8.9 64 19.8c0 7.5 4.2 14.3 10.9 17.7L96 48zm24 68a20 20 0 1 1 40 0 20 20 0 1 1 -40 0zM22.6 473.4c-4.2 4.2-6.6 10-6.6 16C16 501.9 26.1 512 38.6 512l370.7 0c12.5 0 22.6-10.1 22.6-22.6c0-6-2.4-11.8-6.6-16L384 432 64 432 22.6 473.4z" },
  p: { vw: 320, vh: 512, path: "M215.5 224c29.2-18.4 48.5-50.9 48.5-88c0-57.4-46.6-104-104-104S56 78.6 56 136c0 37.1 19.4 69.6 48.5 88L96 224c-17.7 0-32 14.3-32 32c0 16.5 12.5 30 28.5 31.8L80 400l160 0L227.5 287.8c16-1.8 28.5-15.3 28.5-31.8c0-17.7-14.3-32-32-32l-8.5 0zM22.6 473.4c-4.2 4.2-6.6 10-6.6 16C16 501.9 26.1 512 38.6 512l242.7 0c12.5 0 22.6-10.1 22.6-22.6c0-6-2.4-11.8-6.6-16L256 432 64 432 22.6 473.4z" },
};

// ── Helpers ───────────────────────────────────────────────────────

function squareToCoords(sq) {
  return { col: sq.charCodeAt(0) - 97, row: 8 - parseInt(sq[1], 10) };
}
function cellX(col) { return col * (CELL_SIZE + CELL_GAP); }
function cellY(row) { return row * (CELL_SIZE + CELL_GAP); }
function cellCenter(col, row) {
  return { x: cellX(col) + CELL_SIZE / 2, y: cellY(row) + CELL_SIZE / 2 };
}

function parseFenBoard(fen) {
  const ranks = fen.split(" ")[0].split("/");
  const out = [];
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of ranks[r]) {
      if (ch >= "1" && ch <= "8") { c += parseInt(ch); continue; }
      out.push({
        col: c, row: r,
        type: ch.toLowerCase(),
        color: ch === ch.toUpperCase() ? "w" : "b",
      });
      c++;
    }
  }
  return out;
}

function svg(name, attrs, children) {
  const e = document.createElementNS(SVG_NS, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    e.setAttribute(k, String(v));
  }
  if (children) for (const c of children) e.appendChild(c);
  return e;
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes chess-from {
      0%   { fill-opacity: 0.55; }
      40%  { fill-opacity: 0.35; }
      100% { fill-opacity: 0.18; }
    }
    @keyframes chess-to {
      0%   { fill-opacity: 0.15; }
      15%  { fill-opacity: 0.75; }
      35%  { fill-opacity: 0.45; }
      100% { fill-opacity: 0.25; }
    }
    @keyframes chess-capture-flash {
      0%   { fill-opacity: 0.75; }
      60%  { fill-opacity: 0.45; }
      100% { fill-opacity: 0; }
    }
    @keyframes chess-arrow {
      0%   { opacity: 0; stroke-dasharray: 0 200; }
      15%  { opacity: 0.95; stroke-dasharray: 200 0; }
      70%  { opacity: 0.8; }
      100% { opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .chess-anim {
        animation: none !important;
        fill-opacity: 0.35 !important;
        opacity: 0.6 !important;
      }
    }
  `;
  document.head.appendChild(s);
}

// ── Scene ─────────────────────────────────────────────────────────

export class ChessScene {
  constructor(container, _options = {}) {
    this.container = container;
    this.fen = STARTING_FEN;
    this.lastMove = null;       // { from, to, captured, isCheck, kingSq? }
    this.disposed = false;

    injectStyles();

    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.padding = "min(3vw, 32px)";
    container.replaceChildren();

    this.svg = svg("svg", {
      viewBox: `0 0 ${BOARD_PX} ${BOARD_PX}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Live chess game powered by Resonate",
    });
    this.svg.style.width = "100%";
    this.svg.style.height = "100%";
    this.svg.style.maxWidth = "100%";
    this.svg.style.maxHeight = "100%";
    this.svg.style.display = "block";

    const defs = svg("defs", null, [
      svg("marker", {
        id: "chess-arrowhead",
        viewBox: "0 0 10 10",
        refX: 7, refY: 5,
        markerWidth: 5, markerHeight: 5,
        orient: "auto-start-reverse",
      }, [
        svg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: COLORS.accent }),
      ]),
    ]);

    this.cellsLayer     = svg("g");
    this.highlightLayer = svg("g");
    this.checkLayer     = svg("g");
    this.piecesLayer    = svg("g");

    this.svg.append(defs, this.cellsLayer, this.highlightLayer, this.checkLayer, this.piecesLayer);

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const isLight = (r + c) % 2 === 0;
        this.cellsLayer.appendChild(svg("rect", {
          x: cellX(c), y: cellY(r),
          width: CELL_SIZE, height: CELL_SIZE,
          fill: isLight ? COLORS.cellLight : COLORS.cellDark,
          stroke: COLORS.cellBorder,
          "stroke-width": 0.5,
        }));
      }
    }

    container.appendChild(this.svg);
    this.render();
  }

  next(state) {
    if (this.disposed || !state || state.gameOver) return Promise.resolve();
    const { fen, san } = state;
    if (!fen) return Promise.resolve();

    let move = null;
    if (san) {
      try {
        const game = new Chess(this.fen);
        const m = game.move(san);
        if (m) {
          move = {
            from: m.from,
            to: m.to,
            captured: !!m.captured,
            isCheck: game.inCheck(),
            kingSq: null,
          };
          if (move.isCheck) {
            const sideToMove = game.turn();
            const board = game.board();
            outer: for (let r = 0; r < 8; r++) {
              for (let c = 0; c < 8; c++) {
                const cell = board[r]?.[c];
                if (cell && cell.type === "k" && cell.color === sideToMove) {
                  move.kingSq = { col: c, row: r };
                  break outer;
                }
              }
            }
          }
        }
      } catch {
        // FEN/SAN mismatch — fall through and just render the new position.
      }
    }

    this.fen = fen;
    this.lastMove = move;
    this.render();

    return move ? new Promise((r) => setTimeout(r, 3000)) : Promise.resolve();
  }

  reset() {
    this.fen = STARTING_FEN;
    this.lastMove = null;
    this.render();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.container.replaceChildren();
  }

  render() {
    this.highlightLayer.replaceChildren();
    this.checkLayer.replaceChildren();
    this.piecesLayer.replaceChildren();

    if (this.lastMove) {
      const { from, to, captured, isCheck, kingSq } = this.lastMove;
      const f = squareToCoords(from);
      const t = squareToCoords(to);

      this.highlightLayer.appendChild(svg("rect", {
        x: cellX(f.col), y: cellY(f.row),
        width: CELL_SIZE, height: CELL_SIZE,
        fill: COLORS.accent,
        class: "chess-anim",
        style: "animation: chess-from 3s ease-out forwards;",
      }));
      this.highlightLayer.appendChild(svg("rect", {
        x: cellX(t.col), y: cellY(t.row),
        width: CELL_SIZE, height: CELL_SIZE,
        fill: COLORS.accent,
        class: "chess-anim",
        style: "animation: chess-to 3s ease-out forwards;",
      }));
      if (captured) {
        this.highlightLayer.appendChild(svg("rect", {
          x: cellX(t.col), y: cellY(t.row),
          width: CELL_SIZE, height: CELL_SIZE,
          fill: COLORS.captureFlash,
          class: "chess-anim",
          style: "animation: chess-capture-flash 900ms ease-out forwards;",
        }));
      }

      const a = cellCenter(f.col, f.row);
      const b = cellCenter(t.col, t.row);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const pullback = Math.min(10, len * 0.2);
      this.highlightLayer.appendChild(svg("line", {
        x1: a.x, y1: a.y,
        x2: b.x - (dx / len) * pullback,
        y2: b.y - (dy / len) * pullback,
        stroke: COLORS.accent,
        "stroke-width": 3,
        "stroke-linecap": "round",
        "marker-end": "url(#chess-arrowhead)",
        class: "chess-anim",
        style: "animation: chess-arrow 2.4s ease-out forwards;",
      }));

      if (isCheck && kingSq) {
        this.checkLayer.appendChild(svg("rect", {
          x: cellX(kingSq.col) - 1, y: cellY(kingSq.row) - 1,
          width: CELL_SIZE + 2, height: CELL_SIZE + 2,
          fill: "none",
          stroke: COLORS.accent,
          "stroke-width": 2,
          opacity: 0.9,
        }));
      }
    }

    const ICON_SIZE = CELL_SIZE * 0.75;
    const ICON_PAD = (CELL_SIZE - ICON_SIZE) / 2;
    for (const p of parseFenBoard(this.fen)) {
      const def = PIECES[p.type];
      if (!def) continue;
      const inner = svg("svg", {
        x: cellX(p.col) + ICON_PAD,
        y: cellY(p.row) + ICON_PAD,
        width: ICON_SIZE,
        height: ICON_SIZE,
        viewBox: `0 0 ${def.vw} ${def.vh}`,
      }, [
        svg("path", {
          d: def.path,
          fill: p.color === "w" ? COLORS.pieceWhite : COLORS.pieceBlack,
          opacity: 0.95,
        }),
      ]);
      this.piecesLayer.appendChild(inner);
    }
  }
}
