import type { Colour } from '../chess/types';
import type { EngineScore, Wdl } from '../engine/types';

/**
 * Logistic slope converting centipawns into an expected score. With modern
 * Stockfish normalisation, +100cp ≈ 59% expected score. This is our model
 * choice; it is versioned via ACCURACY_VERSION below.
 */
export const CP_LOGISTIC_K = 0.00368208;
export const MATE_SORT_BASE = 100_000;

export function opponent(c: Colour): Colour {
  return c === 'w' ? 'b' : 'w';
}

/** Signed centipawns from `colour`'s perspective, or undefined for mate scores. */
export function cpFor(score: EngineScore, colour: Colour): number | undefined {
  if (score.kind !== 'cp') return undefined;
  return colour === 'w' ? score.value : -score.value;
}

/**
 * A total order for comparing scores from `colour`'s perspective:
 * faster mates for colour rank highest, being mated sooner ranks lowest.
 * This is a sort key only; never display or subtract it as centipawns.
 */
export function sortKey(score: EngineScore, colour: Colour): number {
  if (score.kind === 'cp') return colour === 'w' ? score.value : -score.value;
  const good = score.winner === colour;
  return good ? MATE_SORT_BASE - score.moves : -MATE_SORT_BASE + score.moves;
}

/** Expected score (0..1) for `colour`. Prefers WDL when available. */
export function expectedScore(score: EngineScore, colour: Colour, wdl?: Wdl): number {
  if (score.kind === 'mate') return score.winner === colour ? 1 : 0;
  if (wdl) {
    const total = wdl.win + wdl.draw + wdl.loss;
    if (total > 0) {
      const whiteExp = (wdl.win + wdl.draw / 2) / total;
      return colour === 'w' ? whiteExp : 1 - whiteExp;
    }
  }
  const cp = cpFor(score, colour)!;
  return 1 / (1 + Math.exp(-CP_LOGISTIC_K * cp));
}

/** Formats a white-relative score for display (e.g. "+1.24", "#3", "#-2"). */
export function formatScore(score: EngineScore | undefined): string {
  if (!score) return '…';
  if (score.kind === 'mate') {
    if (score.moves === 0) return score.winner === 'w' ? '1-0' : '0-1';
    return score.winner === 'w' ? `#${score.moves}` : `#-${score.moves}`;
  }
  const v = score.value / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** White-relative value clamped to ±1000cp for charts (mates pinned to the rails). */
export function chartValue(score: EngineScore): number {
  if (score.kind === 'mate') return score.winner === 'w' ? 1000 : -1000;
  return Math.max(-1000, Math.min(1000, score.value));
}

export type MoveLoss = {
  /** Centipawn loss for the mover; undefined when either score is a mate score. */
  centipawnLoss?: number;
  /** Loss of expected score for the mover, in percentage points (0..100). */
  expectedLossPct: number;
  /** True when the played move is at least as good as the best line (within search noise). */
  matchesBest: boolean;
};

export function moveLoss(
  best: EngineScore,
  played: EngineScore,
  mover: Colour,
  wdl?: { best?: Wdl; played?: Wdl },
): MoveLoss {
  const bestCp = cpFor(best, mover);
  const playedCp = cpFor(played, mover);
  const centipawnLoss = bestCp !== undefined && playedCp !== undefined ? Math.max(0, bestCp - playedCp) : undefined;
  const eBest = expectedScore(best, mover, wdl?.best);
  const ePlayed = expectedScore(played, mover, wdl?.played);
  const expectedLossPct = Math.max(0, (eBest - ePlayed) * 100);
  return { centipawnLoss, expectedLossPct, matchesBest: sortKey(played, mover) >= sortKey(best, mover) };
}
