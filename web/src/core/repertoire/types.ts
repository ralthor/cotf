/**
 * Opening repertoires: chapters keep the move tree exactly as imported (variations, comments,
 * NAGs, arrows, evals); `RepMove` rows are derived from them, merged by position, so
 * transpositions and the same position in several chapters count once.
 */
export type Side = 'w' | 'b';

/** Position key: FEN without move counters, en-passant square only when a capture is legal. */
export type PosKey = string;

export type Repertoire = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ChapterSource =
  | { kind: 'pgn-file'; fileName: string }
  | { kind: 'pgn-paste' }
  | {
      kind: 'lichess-study';
      studyId: string;
      chapterId: string;
      studyName?: string;
      url: string;
      /** Imported with the whole study (updates add its new chapters), not as a single chapter. */
      wholeStudy?: boolean;
    };

export type ShapeColor = 'green' | 'red' | 'yellow' | 'blue';
/** An arrow, or a circled square when `from === to`. */
export type Shape = { color: ShapeColor; from: string; to: string };
export type Eval = { pawns: number; depth?: number } | { mate: number; depth?: number };

export type RepNode = {
  /** Absent on the root (the start position). */
  san?: string;
  /** Standard UCI (castling as e1g1). */
  uci?: string;
  /** Full FEN after this move (on the root: the start position). */
  fen: string;
  posKey: PosKey;
  nags?: number[];
  /** Comments before this move (on the root: before the first move). */
  commentsBefore?: string[];
  /** Comment text after this move, with [%…] commands parsed out. */
  comments?: string[];
  shapes?: Shape[];
  eval?: Eval;
  /** children[0] is the main line. */
  children: RepNode[];
};

export type Chapter = {
  id: string;
  repertoireId: string;
  title: string;
  side: Side;
  source: ChapterSource;
  importedAt: string;
  headers: Record<string, string>;
  startFen: string;
  root: RepNode;
  /** Position in the repertoire's chapter list. */
  order: number;
};

/** One move of a repertoire graph, per (repertoire, side, from, uci). */
export type RepMove = {
  repertoireId: string;
  side: Side;
  from: PosKey;
  uci: string;
  san: string;
  to: PosKey;
  /** The mover is `side`: the position `from` is one the user has to answer. */
  mine: boolean;
  /** Main move in at least one chapter. */
  main: boolean;
  /** Where the move appears: chapter and child-index path from the root. */
  refs: { chapterId: string; path: number[] }[];
};
