export type Colour = 'w' | 'b';

export type GameSource = 'chesscom' | 'lichess' | 'pgn-file' | 'pgn-paste';

export type MoveRecord = {
  ply: number; // 1..N
  fullMoveNumber: number;
  colour: Colour;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  isCheck: boolean;
  isCheckmate: boolean;
  /** Seconds remaining on the mover's clock after the move, if the PGN had [%clk]. */
  clockSeconds?: number;
  comment?: string;
  /** Number of legal moves available to the mover in fenBefore (1 = forced). */
  legalMoveCount: number;
};

export type GameRecord = {
  id: string;
  source: GameSource;
  sourceUrl?: string;
  headers: Record<string, string>;
  rawPgn: string;
  importedAt: string;
  initialFen: string;
  moves: MoveRecord[];
  /** Data supplied by the provider (never substituted for our own analysis). */
  providerData?: {
    accuracies?: { white?: number; black?: number };
    timeClass?: string;
    endTime?: number;
  };
};

/** positions[0] is before any move; positions[i] is after ply i. */
export function positionsOf(game: GameRecord): string[] {
  return [game.initialFen, ...game.moves.map((m) => m.fenAfter)];
}
