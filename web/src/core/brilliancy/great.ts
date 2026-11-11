import type { EngineScore } from '../engine/types';
import { expectedScore, sortKey } from '../scoring/score';
import type { BrillianceInput } from './detector';

/**
 * EXPERIMENTAL "great move" heuristic (version great-v1). It reads the same evidence as the
 * brilliancy detector (see detector.ts and docs/ALGORITHM_AND_TEST_CASES.md).
 *
 * Idea: a great move is the best move, far better than every alternative at full depth, while a
 * player who calculates only 1–3 plies (the "shallow horizon") cannot tell it apart from the
 * alternatives. An obvious recapture is far better than the alternatives too, but even a 1-ply
 * look sees that, so it stays "best". Brilliant moves outrank great ones (the classifier decides).
 */
export const GREAT_VERSION = 'great-v1';

export const GREAT_POLICY = {
  /** At full depth the move must lead the next-best move by at least this much (pts). */
  minDeepGapPct: 12,
  /** At the horizon the move may lead the best other move by less than this, or trail it (pts). */
  maxShallowLeadPct: 4,
  /** Not "great" when even the best move leaves the mover clearly worse (expected score). */
  minDeepExpected: 0.3,
  /** Treated as best when within this of the deep best move (pts). */
  bestTolerancePct: 1.5,
  /** On the deeper recheck the lead may shrink by at most this much (pts). */
  stabilityTolerancePct: 4,
};

export type GreatVerdict = 'great' | 'none';

export type GreatEvidence = {
  version: string;
  verdict: GreatVerdict;
  signals: {
    horizon: number;
    /** Played move minus the best other move at the horizon (negative: another move looked better). */
    shallowLeadPct: number | null;
    shallowRivalUci: string | null;
    shallowRank: number | null;
    legalMoves: number | null;
    /** Played move minus the best other move at full depth. */
    deepGapPct: number | null;
    deepRivalUci: string | null;
    recheckGapPct: number | null;
    deepExpectedPct: number;
  };
  gates: { name: string; passed: boolean; detail: string }[];
  reasons: string[];
};

const pct = (s: EngineScore, mover: 'w' | 'b') => expectedScore(s, mover) * 100;

/** Lead of the played move over the best other move in a MultiPV-2 deep result. */
function deepGap(
  d: NonNullable<BrillianceInput['recheck']>,
  playedUci: string,
  mover: 'w' | 'b',
): { gap: number | null; rival: string | null; isBest: boolean } {
  const played = pct(d.playedScore, mover);
  const best = pct(d.bestScore, mover);
  const isBest = d.bestUci === playedUci || sortKey(d.playedScore, mover) >= sortKey(d.bestScore, mover);
  if (isBest) {
    if (d.secondScore === undefined) return { gap: null, rival: null, isBest };
    return { gap: played - pct(d.secondScore, mover), rival: d.secondUci ?? null, isBest };
  }
  return { gap: played - best, rival: d.bestUci, isBest: best - played <= GREAT_POLICY.bestTolerancePct };
}

export function evaluateGreat(input: BrillianceInput, policy = GREAT_POLICY): GreatEvidence {
  const { mover, playedUci } = input;
  const gates: GreatEvidence['gates'] = [];
  const reasons: string[] = [];

  // --- 1. Enough choice: at least two legal moves --------------------------------------------
  const sampled = [...input.shallow].filter((s) => s.depth >= 1).sort((a, b) => a.depth - b.depth);
  const atHorizon = sampled.at(-1);
  const legalMoves = atHorizon?.legalMoves ?? null;
  gates.push({
    name: 'has-alternatives',
    passed: legalMoves === null || legalMoves >= 2,
    detail: legalMoves === null ? 'Legal move count unknown.' : `${legalMoves} legal moves.`,
  });

  // --- 2. Best at depth, and the position is not lost anyway ---------------------------------
  const deep = deepGap(input.deep, playedUci, mover);
  const deepExpectedPct = pct(input.deep.playedScore, mover);
  gates.push({
    name: 'best-at-depth',
    passed: deep.isBest && deepExpectedPct >= policy.minDeepExpected * 100,
    detail: `At depth ${input.deep.depth} the move is ${deep.isBest ? 'best/tied' : 'not best'} with ${deepExpectedPct.toFixed(1)}% expected score.`,
  });

  // --- 3. Far better than the alternatives at depth ------------------------------------------
  // With no second line the move was the only sensible one, which is not a "choice".
  gates.push({
    name: 'far-better-at-depth',
    passed: deep.gap !== null && deep.gap >= policy.minDeepGapPct,
    detail:
      deep.gap === null
        ? 'No second move to compare with.'
        : `Lead over the next move${deep.rival ? ` (${deep.rival})` : ''} at depth ${input.deep.depth}: ${deep.gap.toFixed(1)} pts (needs ≥ ${policy.minDeepGapPct}).`,
  });

  // --- 4. Shallow look cannot tell it apart ----------------------------------------------------
  let shallowLeadPct: number | null = null;
  let shallowRivalUci: string | null = null;
  if (atHorizon) {
    if (atHorizon.playedScore && atHorizon.bestOtherScore) {
      shallowLeadPct = pct(atHorizon.playedScore, mover) - pct(atHorizon.bestOtherScore, mover);
      shallowRivalUci = atHorizon.bestOtherUci ?? null;
    } else if (atHorizon.playedScore && atHorizon.bestUci !== playedUci) {
      // Another move was best there, so the played move did not stand out.
      shallowLeadPct = pct(atHorizon.playedScore, mover) - pct(atHorizon.bestScore, mover);
      shallowRivalUci = atHorizon.bestUci;
    }
  }
  const horizon = atHorizon?.depth ?? 0;
  gates.push({
    name: 'ambiguous-at-shallow-depth',
    passed: shallowLeadPct !== null && shallowLeadPct < policy.maxShallowLeadPct,
    detail:
      shallowLeadPct === null
        ? 'The alternatives were not measured at shallow depth.'
        : `Searching ${horizon} ${horizon === 1 ? 'ply' : 'plies'} ahead, the move ${
            shallowLeadPct < 0
              ? `trails ${shallowRivalUci ?? 'another move'} by`
              : `leads ${shallowRivalUci ?? 'the next move'} by${shallowLeadPct < policy.maxShallowLeadPct ? ' only' : ''}`
          } ${Math.abs(shallowLeadPct).toFixed(1)} pts (needs a lead < ${policy.maxShallowLeadPct}).`,
  });

  // --- 5. Same picture on a deeper recheck -----------------------------------------------------
  let recheckGapPct: number | null = null;
  if (input.recheck) {
    const re = deepGap(input.recheck, playedUci, mover);
    recheckGapPct = re.gap;
    gates.push({
      name: 'stable-on-recheck',
      passed: re.isBest && re.gap !== null && re.gap >= policy.minDeepGapPct - policy.stabilityTolerancePct,
      detail: `Recheck at depth ${input.recheck.depth}: ${re.isBest ? 'still best' : 'no longer best'}, lead ${re.gap === null ? '—' : re.gap.toFixed(1)} pts.`,
    });
  } else {
    gates.push({ name: 'stable-on-recheck', passed: false, detail: 'No deeper recheck was available.' });
  }

  const verdict: GreatVerdict = gates.every((g) => g.passed) ? 'great' : 'none';
  if (verdict === 'great') {
    reasons.push(
      `Far better than the next move at depth ${input.deep.depth} (${deep.gap!.toFixed(1)} pts), but a ${horizon}-ply look cannot tell it apart from ${shallowRivalUci ?? 'the alternatives'}.`,
    );
  }

  return {
    version: GREAT_VERSION,
    verdict,
    signals: {
      horizon,
      shallowLeadPct,
      shallowRivalUci,
      shallowRank: atHorizon?.playedRank ?? null,
      legalMoves,
      deepGapPct: deep.gap,
      deepRivalUci: deep.rival,
      recheckGapPct,
      deepExpectedPct,
    },
    gates,
    reasons,
  };
}
