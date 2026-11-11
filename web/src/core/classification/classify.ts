import type { Colour } from '../chess/types';
import type { EngineScore } from '../engine/types';
import { moveLoss, type MoveLoss } from '../scoring/score';

export type MoveCategory = 'brilliant' | 'great' | 'best' | 'good' | 'questionable' | 'mistake' | 'blunder';

export const CATEGORY_ORDER: MoveCategory[] = ['brilliant', 'great', 'best', 'good', 'questionable', 'mistake', 'blunder'];

export const CATEGORY_LABELS: Record<MoveCategory, { label: string; glyph: string; description: string }> = {
  brilliant: { label: 'Brilliant', glyph: '!!', description: 'Hard-to-find, deeply verified strong move (experimental detector).' },
  great: { label: 'Great', glyph: '!', description: 'Far better than every alternative, though a 1–3 ply look cannot tell them apart.' },
  best: { label: 'Best', glyph: '★', description: 'Engine top choice or effectively tied with it.' },
  good: { label: 'Good', glyph: '✓', description: 'Small loss of expected score.' },
  questionable: { label: 'Inaccuracy', glyph: '?!', description: 'Noticeable loss, not severe (a.k.a. questionable).' },
  mistake: { label: 'Mistake', glyph: '?', description: 'Substantial loss of expected score.' },
  blunder: { label: 'Blunder', glyph: '??', description: 'Large loss, missed forced win, or allowed mate.' },
};

/**
 * Versioned classifier thresholds. All values are losses of the mover's expected score in
 * percentage points. These are initial, tunable estimates — not any provider's thresholds.
 */
export type ClassifierPolicy = {
  version: string;
  bestMaxLossPct: number;
  bestMaxCpLoss: number;
  goodMaxLossPct: number;
  questionableMaxLossPct: number;
  mistakeMaxLossPct: number;
};

export const DEFAULT_POLICY: ClassifierPolicy = {
  version: 'cls-v1',
  bestMaxLossPct: 1.0,
  bestMaxCpLoss: 10,
  goodMaxLossPct: 4,
  questionableMaxLossPct: 10,
  mistakeMaxLossPct: 20,
};

export type ClassificationInput = {
  mover: Colour;
  playedUci: string;
  bestUci?: string;
  best: EngineScore;
  played: EngineScore;
  /** True if only one legal move existed. */
  forced?: boolean;
  /** Outcome of the brilliancy detector, if it ran. */
  brilliant?: boolean;
  /** Outcome of the great-move detector, if it ran. Brilliant wins when both are set. */
  great?: boolean;
};

export type Classification = {
  category: MoveCategory;
  loss: MoveLoss;
  reasons: string[];
  policyVersion: string;
};

/** Priority decision tree: brilliant → great → best → mate rules → loss thresholds. */
export function classifyMove(input: ClassificationInput, policy: ClassifierPolicy = DEFAULT_POLICY): Classification {
  const loss = moveLoss(input.best, input.played, input.mover);
  const reasons: string[] = [];
  const done = (category: MoveCategory): Classification => ({ category, loss, reasons, policyVersion: policy.version });

  const isTop = input.bestUci !== undefined && input.bestUci === input.playedUci;
  const bestMatesForMover = input.best.kind === 'mate' && input.best.winner === input.mover;
  const playedMatesForMover = input.played.kind === 'mate' && input.played.winner === input.mover;
  const playedGetsMated = input.played.kind === 'mate' && input.played.winner !== input.mover;
  const bestGetsMated = input.best.kind === 'mate' && input.best.winner !== input.mover;
  // Expected score saturates at 1 for any mate, so a slower mate must not count as a tie.
  const slowerMate =
    bestMatesForMover && playedMatesForMover && input.played.kind === 'mate' && input.best.kind === 'mate' &&
    input.played.moves > input.best.moves;
  const tied =
    !slowerMate &&
    (loss.matchesBest ||
      (loss.expectedLossPct <= policy.bestMaxLossPct &&
        (loss.centipawnLoss === undefined || loss.centipawnLoss <= policy.bestMaxCpLoss)));

  if (input.brilliant && (isTop || tied)) {
    reasons.push('Passed the depth-reversal brilliancy checks and is best at the deepest search.');
    return done('brilliant');
  }
  if (input.great && !input.forced && (isTop || tied)) {
    reasons.push('Far better than every alternative at depth, which a shallow look cannot see.');
    return done('great');
  }
  if (input.forced) {
    reasons.push('Only legal move.');
    return done('best');
  }
  if (isTop || tied) {
    reasons.push(isTop ? "Engine's top choice." : 'Effectively tied with the top choice.');
    return done('best');
  }

  if (playedGetsMated && !bestGetsMated) {
    reasons.push('Allows a forced mate that could have been avoided.');
    return done('blunder');
  }
  if (bestMatesForMover && !playedMatesForMover) {
    reasons.push('Misses a forced mate.');
    return done(loss.expectedLossPct > policy.questionableMaxLossPct ? 'blunder' : 'mistake');
  }
  if (bestMatesForMover && playedMatesForMover) {
    // Still mating, just slower: never worse than "good".
    reasons.push('Still mates, but slower than the fastest mate.');
    return done('good');
  }

  const l = loss.expectedLossPct;
  reasons.push(`Expected score drops by ${l.toFixed(1)} percentage points.`);
  if (l <= policy.goodMaxLossPct) return done('good');
  if (l <= policy.questionableMaxLossPct) return done('questionable');
  if (l <= policy.mistakeMaxLossPct) return done('mistake');
  return done('blunder');
}
