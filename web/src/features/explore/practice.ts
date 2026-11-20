import type { Colour } from '../../core/chess/types';
import type { EngineLine } from '../../core/engine/types';
import type { MoveAnalysis } from '../analysis/types';

/** How each practice position ended: solved on the first try, solved after retries, or skipped / shown. */
export type PracticeResult = 'first' | 'retry' | 'skipped';

export type PracticeState = {
  side: Colour;
  /** Plies of the mistakes to practise, in game order. */
  plies: number[];
  /** Current item; equal to plies.length when finished. */
  index: number;
  /** The move being tried (UCI), shown on the board while it is graded. */
  attempt: string | null;
  tries: number;
  hint: boolean;
  solution: boolean;
  results: (PracticeResult | undefined)[];
};

/** Mistakes and blunders made by `side`, in game order. */
export function practicePlies(moves: readonly (MoveAnalysis | undefined)[] | undefined, side: Colour): number[] {
  return (moves ?? [])
    .filter((m): m is MoveAnalysis => !!m && m.colour === side && (m.category === 'mistake' || m.category === 'blunder'))
    .map((m) => m.ply);
}

export function startPractice(side: Colour, plies: number[]): PracticeState {
  return { side, plies, index: 0, attempt: null, tries: 0, hint: false, solution: false, results: [] };
}

/** Moves on to the next position, recording how the current one ended. */
export function nextItem(p: PracticeState, result: PracticeResult): PracticeState {
  const results = [...p.results];
  results[p.index] = result;
  return { ...p, results, index: p.index + 1, attempt: null, tries: 0, hint: false, solution: false };
}

/**
 * Lines already known for the position before a mistake: the analysis' top lines plus the move
 * played (scored even when it was not among the top lines), so most tries need no new search.
 */
export function knownLines(m: MoveAnalysis): EngineLine[] {
  const lines = [...m.lines];
  if (m.playedScore && !lines.some((l) => l.pvUci[0] === m.uci)) {
    lines.push({ rank: lines.length + 1, score: m.playedScore, pvUci: m.playedPv ?? [m.uci], depth: m.depth });
  }
  return lines;
}
