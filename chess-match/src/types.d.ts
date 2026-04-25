declare module "js-chess-engine" {
  export class Game {
    constructor(fen?: string);
    ai(opts: { level: number }): { move: Record<string, string> };
    moves(opts?: object): Record<string, string[]>;
  }
}
