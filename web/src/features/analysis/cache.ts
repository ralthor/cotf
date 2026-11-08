import type { PositionAnalysis, SearchRequest } from '../../core/engine/types';

export const SCORE_CONVENTION = 'white-relative-v1';

export interface AnalysisCache {
  get(key: string): Promise<PositionAnalysis | undefined>;
  set(key: string, value: PositionAnalysis): Promise<void>;
}

/**
 * Canonical FEN for caching: board, side to move, castling and en-passant fields. The halfmove
 * clock is kept only when it is close enough to the 50-move rule to influence evaluation.
 */
export function canonicalFen(fen: string): string {
  const [board, stm, castling, ep, half] = fen.trim().split(/\s+/);
  const h = Number(half ?? '0');
  return [board, stm, castling ?? '-', ep ?? '-', h >= 80 ? `h${h}` : ''].join(' ').trim();
}

/** Cache key: position + engine build + full search configuration + score convention. */
export function analysisCacheKey(engineId: string, req: SearchRequest): string {
  return JSON.stringify({
    fen: canonicalFen(req.fen),
    engine: engineId,
    depth: req.depth ?? null,
    nodes: req.nodes ?? null,
    movetime: req.movetimeMs ?? null,
    multiPv: req.multiPv ?? 1,
    searchMoves: req.searchMoves ?? null,
    clearHash: !!req.clearHash,
    convention: SCORE_CONVENTION,
  });
}

export class MemoryAnalysisCache implements AnalysisCache {
  private map = new Map<string, PositionAnalysis>();
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, value: PositionAnalysis) {
    this.map.set(key, value);
  }
  get size() {
    return this.map.size;
  }
}
