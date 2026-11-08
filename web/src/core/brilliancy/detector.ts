import type { Colour } from '../chess/types';
import type { EngineScore } from '../engine/types';
import { expectedScore, sortKey } from '../scoring/score';
import type { SacrificeEvidence } from './sacrifice';

/**
 * EXPERIMENTAL depth/rank-reversal brilliancy heuristic (version brill-v1).
 * A research heuristic, not a definition of human brilliance. See docs/ALGORITHM_AND_TEST_CASES.md.
 */
export const BRILLIANCY_VERSION = 'brill-v1';

/** One depth of a full-width (MultiPV ≈ all legal moves) shallow root search. */
export type ShallowRankSample = {
  depth: number;
  /** 1-based rank of the played move among the sampled lines, or null if it was not among them. */
  playedRank: number | null;
  sampledLines: number;
  legalMoves: number;
  bestScore: EngineScore;
  /** Played move's score at this depth when it appears among the sampled lines. */
  playedScore?: EngineScore;
};

/** The played move's own score per depth, from a `go … searchmoves <played>` search. */
export type PlayedTrajectoryPoint = { depth: number; score: EngineScore };

export type DeepVerification = {
  depth: number;
  bestUci: string;
  bestScore: EngineScore;
  secondScore?: EngineScore;
  playedScore: EngineScore;
};

export type BrillianceInput = {
  mover: Colour;
  playedUci: string;
  shallow: ShallowRankSample[];
  trajectory: PlayedTrajectoryPoint[];
  deep: DeepVerification;
  /** Independent re-verification (deeper or different budget). Missing ⇒ at most "candidate". */
  recheck?: DeepVerification;
  sacrifice?: SacrificeEvidence;
};

export type BrillianceVerdict = 'brilliant' | 'candidate' | 'none';

export type BrillianceEvidence = {
  version: string;
  verdict: BrillianceVerdict;
  score: number; // 0..100
  confidence: 'low' | 'medium' | 'high';
  signals: {
    shallowWorstRank: number | null;
    shallowRankIsExact: boolean;
    deepRank: 1 | null;
    shallowWorstExpectedPct: number | null;
    deepExpectedPct: number;
    inversionPct: number | null;
    uniquenessGapPct: number | null;
    discoveryDepth: number | null;
    discoveryInterval: [number, number] | null;
    sacrifice: boolean;
    stable: boolean | null;
  };
  gates: { name: string; passed: boolean; detail: string }[];
  reasons: string[];
};

export const BRILLIANCY_POLICY = {
  minDeepExpected: 0.4, // not brilliant if the move still leaves the mover clearly losing
  bestTolerancePct: 1.5,
  minShallowRank: 3,
  minInversionPct: 15, // expected-score points gained by the same move from shallow to deep
  minDiscoveryDepth: 4,
  minSustainedDepths: 3, // the move must stay sound for at least this many trailing depths
  soundTolerancePct: 8, // trajectory point counts as "sound" if within this of the deep value
  stabilityTolerancePct: 6,
  brilliantScore: 55,
  candidateScore: 40,
};

const pct = (s: EngineScore, c: Colour) => expectedScore(s, c) * 100;

export function evaluateBrilliance(input: BrillianceInput, policy = BRILLIANCY_POLICY): BrillianceEvidence {
  const { mover } = input;
  const gates: BrillianceEvidence['gates'] = [];
  const reasons: string[] = [];

  // 1. Deep quality: played move is best or tied at the deepest search, and not losing.
  const deepPlayedPct = pct(input.deep.playedScore, mover);
  const deepBestPct = pct(input.deep.bestScore, mover);
  const deepIsBest =
    input.deep.bestUci === input.playedUci ||
    sortKey(input.deep.playedScore, mover) >= sortKey(input.deep.bestScore, mover) ||
    deepBestPct - deepPlayedPct <= policy.bestTolerancePct;
  gates.push({
    name: 'deep-quality',
    passed: deepIsBest && deepPlayedPct >= policy.minDeepExpected * 100,
    detail: `At depth ${input.deep.depth} the move is ${deepIsBest ? 'best/tied' : 'not best'} with ${deepPlayedPct.toFixed(1)}% expected score.`,
  });

  // 2. Shallow rank (only trusted when the sample covered the played move or all legal moves).
  const ranked = input.shallow.filter((s) => s.depth >= 1);
  let shallowWorstRank: number | null = null;
  let shallowRankIsExact = true;
  let shallowWorstExpected: number | null = null;
  for (const s of ranked) {
    const exact = s.playedRank !== null || s.sampledLines >= s.legalMoves;
    const rank = s.playedRank ?? s.sampledLines + 1; // "outside top N" ⇒ at least N+1
    if (!exact) shallowRankIsExact = false;
    if (shallowWorstRank === null || rank > shallowWorstRank) shallowWorstRank = rank;
  }
  for (const t of input.trajectory) {
    if (t.depth > Math.max(...ranked.map((s) => s.depth), 0)) continue;
    const p = pct(t.score, mover);
    if (shallowWorstExpected === null || p < shallowWorstExpected) shallowWorstExpected = p;
  }
  const rankReversal = shallowWorstRank !== null && shallowWorstRank >= policy.minShallowRank;

  // 3. Depth inversion for the SAME move.
  const inversionPct = shallowWorstExpected === null ? null : deepPlayedPct - shallowWorstExpected;
  const inverted = inversionPct !== null && inversionPct >= policy.minInversionPct;
  gates.push({
    name: 'overlooked-at-shallow-depth',
    passed: rankReversal || inverted,
    detail: `Worst shallow rank ${shallowWorstRank ?? 'n/a'}${shallowRankIsExact ? '' : ' (lower bound)'}; inversion ${inversionPct?.toFixed(1) ?? 'n/a'} pts.`,
  });

  // 4. Discovery depth: first depth after which the move stays sound until the end.
  const traj = [...input.trajectory].sort((a, b) => a.depth - b.depth);
  let discoveryDepth: number | null = null;
  let lastUnsound: number | null = null;
  for (const t of traj) {
    const sound = pct(t.score, mover) >= deepPlayedPct - policy.soundTolerancePct;
    if (!sound) {
      lastUnsound = t.depth;
      discoveryDepth = null;
    } else if (discoveryDepth === null) discoveryDepth = t.depth;
  }
  if (lastUnsound === null && traj.length > 0) discoveryDepth = traj[0]!.depth; // never looked bad
  const discoveryInterval: [number, number] | null =
    discoveryDepth !== null && lastUnsound !== null ? [lastUnsound, discoveryDepth] : null;
  gates.push({
    name: 'sustained-discovery',
    passed:
      discoveryDepth !== null &&
      lastUnsound !== null &&
      discoveryDepth >= policy.minDiscoveryDepth &&
      traj.filter((t) => t.depth >= discoveryDepth!).length >= policy.minSustainedDepths,
    detail:
      discoveryDepth === null
        ? 'The move never settled into a sound evaluation.'
        : lastUnsound === null
          ? `Already sound from depth ${discoveryDepth}; nothing to discover.`
          : `Looked unsound up to depth ${lastUnsound}, stays sound from depth ${discoveryDepth}.`,
  });

  // 5. Uniqueness: best vs second-best at depth.
  const uniquenessGapPct =
    input.deep.secondScore !== undefined ? deepBestPct - pct(input.deep.secondScore, mover) : null;

  // 6. Stability: independent recheck agrees.
  let stable: boolean | null = null;
  if (input.recheck) {
    const rePlayed = pct(input.recheck.playedScore, mover);
    const reBest = pct(input.recheck.bestScore, mover);
    stable =
      Math.abs(rePlayed - deepPlayedPct) <= policy.stabilityTolerancePct &&
      (input.recheck.bestUci === input.playedUci || reBest - rePlayed <= policy.bestTolerancePct);
    gates.push({
      name: 'stable-on-recheck',
      passed: stable,
      detail: `Recheck at depth ${input.recheck.depth}: ${rePlayed.toFixed(1)}% vs ${deepPlayedPct.toFixed(1)}%.`,
    });
  }

  const sacrifice = input.sacrifice?.isSacrifice ?? false;

  // Score: weighted, bounded signals.
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const score =
    30 * clamp01((inversionPct ?? 0) / 40) +
    25 * clamp01(((shallowWorstRank ?? 1) - 1) / 5) +
    20 * clamp01((uniquenessGapPct ?? 0) / 25) +
    15 * (sacrifice ? 1 : 0) +
    10 * clamp01((discoveryDepth ?? 0) / 12);

  const hardGatesPassed = gates.filter((g) => g.name !== 'stable-on-recheck').every((g) => g.passed);
  let verdict: BrillianceVerdict = 'none';
  if (hardGatesPassed && score >= policy.candidateScore) verdict = 'candidate';
  if (hardGatesPassed && stable === true && score >= policy.brilliantScore) verdict = 'brilliant';
  if (stable === false) verdict = 'none';

  if (rankReversal) reasons.push(`Ranked #${shallowWorstRank}${shallowRankIsExact ? '' : '+'} at shallow depth, #1 at depth ${input.deep.depth}.`);
  if (inverted) reasons.push(`Same move gained ${inversionPct!.toFixed(1)} expected-score points from shallow to deep search.`);
  if (uniquenessGapPct !== null && uniquenessGapPct >= 10) reasons.push(`Clearly better than the second-best move (${uniquenessGapPct.toFixed(1)} pts).`);
  if (sacrifice) reasons.push(input.sacrifice!.note);
  if (discoveryInterval) reasons.push(`Discovered between depth ${discoveryInterval[0]} and ${discoveryInterval[1]}.`);
  for (const g of gates) if (!g.passed) reasons.push(`Gate failed (${g.name}): ${g.detail}`);

  const confidence: BrillianceEvidence['confidence'] =
    stable === true && shallowRankIsExact && input.deep.depth >= 20 ? 'high' : stable === true ? 'medium' : 'low';

  return {
    version: BRILLIANCY_VERSION,
    verdict,
    score: Math.round(score),
    confidence,
    signals: {
      shallowWorstRank,
      shallowRankIsExact,
      deepRank: deepIsBest ? 1 : null,
      shallowWorstExpectedPct: shallowWorstExpected,
      deepExpectedPct: deepPlayedPct,
      inversionPct,
      uniquenessGapPct,
      discoveryDepth,
      discoveryInterval,
      sacrifice,
      stable,
    },
    gates,
    reasons,
  };
}
