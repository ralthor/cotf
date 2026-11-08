/**
 * Our own accuracy estimate ("Analyser accuracy", version acc-v1). It is NOT Chess.com's or
 * Lichess's accuracy, and is never substituted for provider-supplied numbers.
 *
 *   moveAccuracy = 100 · exp(-ACC_DECAY · expectedLossPct)
 *
 * where expectedLossPct is the mover's drop in expected score (0..100 percentage points)
 * between the best move and the played move. Reference points:
 *   loss 0 → 100, 2 → 91.4, 5 → 79.9, 10 → 63.8, 20 → 40.7, 40 → 16.5.
 *
 * Game accuracy per colour = arithmetic mean of move accuracies over non-forced moves.
 * With fewer than MIN_MOVES scored moves we report no number (avoids spurious 100%).
 */
export const ACCURACY_VERSION = 'acc-v1';
export const ACC_DECAY = 0.045;
export const MIN_MOVES = 5;

export function moveAccuracy(expectedLossPct: number): number {
  const loss = Math.max(0, expectedLossPct);
  return 100 * Math.exp(-ACC_DECAY * loss);
}

export type AccuracyInput = { expectedLossPct?: number; forced: boolean };

export type AccuracyResult = {
  version: string;
  value?: number; // undefined when not enough scored moves
  scoredMoves: number;
  totalMoves: number;
  provisional: boolean;
};

export function gameAccuracy(moves: AccuracyInput[]): AccuracyResult {
  const eligible = moves.filter((m) => !m.forced);
  const scored = eligible.filter((m) => m.expectedLossPct !== undefined);
  const provisional = scored.length < eligible.length;
  const base = { version: ACCURACY_VERSION, scoredMoves: scored.length, totalMoves: eligible.length, provisional };
  if (scored.length < MIN_MOVES) return base;
  const mean = scored.reduce((s, m) => s + moveAccuracy(m.expectedLossPct!), 0) / scored.length;
  return { ...base, value: Math.round(mean * 10) / 10 };
}
