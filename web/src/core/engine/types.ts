import type { Colour } from '../chess/types';

/**
 * Canonical stored score. Always white-relative:
 *  - cp: positive = good for White.
 *  - mate: `winner` delivers mate in `moves` full moves (0 = the position is already mate).
 */
export type EngineScore =
  | { kind: 'cp'; value: number; perspective: 'white' }
  | { kind: 'mate'; moves: number; winner: Colour; perspective: 'white' };

export type Wdl = { win: number; draw: number; loss: number }; // per mille, white-relative

export type EngineLine = {
  rank: number; // multipv number (1-based)
  score: EngineScore;
  pvUci: string[];
  depth: number;
  seldepth?: number;
  nodes?: number;
  timeMs?: number;
  isBound?: boolean;
  wdl?: Wdl;
};

export type SearchLimits = {
  depth?: number;
  nodes?: number;
  movetimeMs?: number;
};

export type SearchRequest = SearchLimits & {
  fen: string;
  multiPv?: number;
  /** Restricts the root search to these UCI moves (`go ... searchmoves`). */
  searchMoves?: string[];
  /** Sends `ucinewgame` first so the hash is cleared (reproducible research runs). */
  clearHash?: boolean;
  /** Safety net: if no `bestmove` arrives within this time the worker is restarted. */
  timeoutMs?: number;
};

export type DepthSnapshot = { depth: number; lines: EngineLine[] };

export type PositionAnalysis = {
  fen: string;
  engineId: string;
  engineVersion: string;
  options: {
    multiPv: number;
    searchMoves?: string[];
    hashCleared: boolean;
    limits: SearchLimits;
  };
  requestedDepth?: number;
  completedDepth: number;
  /** Lines from the deepest complete depth, sorted by rank. */
  lines: EngineLine[];
  /** Every depth snapshot seen (iterative deepening trajectory). */
  byDepth: DepthSnapshot[];
  bestMoveUci?: string;
  /** True when the search ended by stop/timeout/cancel rather than reaching its limit. */
  stopped: boolean;
  /** Set when the position is terminal (checkmate/stalemate) and the engine was not consulted. */
  terminal?: 'checkmate' | 'stalemate' | 'insufficient' | 'draw';
  completedAt: string;
};

export type EngineInfo = { id: string; name: string; version: string; flavour: string };

export class EngineError extends Error {
  readonly code: 'cancelled' | 'timeout' | 'crashed' | 'invalid-fen' | 'not-ready';
  constructor(code: EngineError['code'], message: string) {
    super(message);
    this.code = code;
  }
}
