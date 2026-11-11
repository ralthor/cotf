import type { Colour } from '../chess/types';
import type { EngineScore } from '../engine/types';
import { expectedScore, sortKey } from '../scoring/score';
import type { SacrificeEvidence } from './sacrifice';

/**
 * EXPERIMENTAL brilliancy heuristic (version brill-v3). A research heuristic, not a definition of
 * human brilliance. See docs/ALGORITHM_AND_TEST_CASES.md.
 *
 * Idea: look at the position the way a player who calculates only 1–3 plies would (the
 * "shallow horizon"). If the played move looks like a clear mistake there, but a full-depth
 * search finds it is the best move, decisively better than the alternatives, and only becomes
 * sound beyond the horizon, it is a brilliant candidate.
 *
 * brill-v3: the horizon slides with the size of the sacrifice. Players rarely look even one
 * move past giving up their queen, so a queen-sized sacrifice (≥ 8 pawns) only needs to look bad
 * within 1 ply (e.g. queen sac, then mate in one); everything else keeps the full shallow horizon.
 */
export const BRILLIANCY_VERSION = 'brill-v3';

/** One depth (≤ horizon) of a full-width search: every legal move scored at this depth. */
export type ShallowSample = {
  depth: number;
  /** 1-based rank of the played move among all legal moves at this depth, or null if not sampled. */
  playedRank: number | null;
  sampledLines: number;
  legalMoves: number;
  bestUci: string;
  bestScore: EngineScore;
  /** The played move's score at this depth (from the same full-width search). */
  playedScore?: EngineScore;
  /** The best move other than the played one at this depth (for the great-move check). */
  bestOtherUci?: string;
  bestOtherScore?: EngineScore;
};

/** The played move's own score per depth, from a `go … searchmoves <played>` search. */
export type PlayedTrajectoryPoint = { depth: number; score: EngineScore };

export type DeepVerification = {
  depth: number;
  bestUci: string;
  bestScore: EngineScore;
  secondScore?: EngineScore;
  secondUci?: string;
  playedScore: EngineScore;
};

export type BrillianceInput = {
  mover: Colour;
  playedUci: string;
  /** Depths 1..horizon of a full-width shallow search. */
  shallow: ShallowSample[];
  trajectory: PlayedTrajectoryPoint[];
  deep: DeepVerification;
  /** Independent re-verification (deeper). Missing ⇒ at most "candidate". */
  recheck?: DeepVerification;
  sacrifice?: SacrificeEvidence;
};

export type BrillianceVerdict = 'brilliant' | 'candidate' | 'none';

export type ShallowViewRow = {
  depth: number;
  playedRank: number | null;
  legalMoves: number;
  bestUci: string;
  bestPct: number;
  playedPct: number | null;
  /** How much worse the played move looked than the best move at this depth (pts). */
  lossPct: number | null;
};

export type BrillianceEvidence = {
  version: string;
  verdict: BrillianceVerdict;
  score: number; // 0..100
  confidence: 'low' | 'medium' | 'high';
  signals: {
    horizon: number;
    /** Loss vs the shallow best move at the horizon depth (what a shallow calculator concludes). */
    shallowLossPct: number | null;
    shallowRank: number | null;
    legalMoves: number | null;
    shallowView: ShallowViewRow[];
    deepRank: 1 | null;
    deepExpectedPct: number;
    inversionPct: number | null;
    uniquenessGapPct: number | null;
    discoveryDepth: number | null;
    discoveryInterval: [number, number] | null;
    sacrifice: boolean;
    /** Sacrifice size in pawns (0 when no sacrifice). */
    sacrificeSize: number;
    /** Material the opponent could win by capturing right after the move. */
    offered: number;
    stable: boolean | null;
  };
  gates: { name: string; passed: boolean; detail: string }[];
  reasons: string[];
};

export const BRILLIANCY_POLICY = {
  /** Default shallow horizon in plies (search depth); the harness lets you change it. */
  horizon: 3,
  /** At the horizon the move must look at least this much worse than the best move (mistake level). */
  minShallowLossPct: 10,
  minDeepExpected: 0.4, // not brilliant if the move still leaves the mover clearly losing
  bestTolerancePct: 1.5,
  /** The move must matter: best minus second-best at depth. */
  minUniquenessPct: 8, // tentative: old false positive had 1.1, Légal 5.Nxe5 has ~9.4
  soundTolerancePct: 8, // trajectory point counts as "sound" if within this of the deep value
  minSustainedDepths: 3,
  stabilityTolerancePct: 6,
  /** Sacrifices at least this big (pawns: a queen) use the short horizon below. */
  bigSacrificeMin: 8,
  /** Horizon (plies) for big sacrifices: nobody looks past "I lose my queen". */
  bigSacrificeHorizon: 1,
  /** …and also "look bad" if the opponent can simply win this much by taking (e.g. queen for a rook). */
  bigSacrificeHangingMin: 5,
};

const pct = (s: EngineScore, c: Colour) => expectedScore(s, c) * 100;

/** English ordinal for ranks ("1st", "2nd", "23rd"). */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
}

export function evaluateBrilliance(input: BrillianceInput, policy = BRILLIANCY_POLICY): BrillianceEvidence {
  const { mover } = input;
  const gates: BrillianceEvidence['gates'] = [];
  const reasons: string[] = [];

  // --- 1. Shallow view (depths 1..horizon) ---------------------------------------------------
  const sacrifice = input.sacrifice?.isSacrifice ?? false;
  const sacrificeSize = sacrifice ? (input.sacrifice!.size ?? input.sacrifice!.maxDeficit) : 0;
  const offered = input.sacrifice?.offered ?? 0;
  const bigSacrifice = sacrificeSize >= policy.bigSacrificeMin;
  const sampled = [...input.shallow].filter((s) => s.depth >= 1).sort((a, b) => a.depth - b.depth);
  const fullHorizon = sampled.length ? sampled[sampled.length - 1]!.depth : 0;
  const horizon = bigSacrifice ? Math.min(fullHorizon, policy.bigSacrificeHorizon) : fullHorizon;
  const shallow = sampled.filter((s) => s.depth <= horizon);
  const shallowView: ShallowViewRow[] = shallow.map((s) => {
    const bestPct = pct(s.bestScore, mover);
    const playedPct = s.playedScore ? pct(s.playedScore, mover) : null;
    return {
      depth: s.depth,
      playedRank: s.playedRank,
      legalMoves: s.legalMoves,
      bestUci: s.bestUci,
      bestPct,
      playedPct,
      lossPct: playedPct === null ? null : Math.max(0, bestPct - playedPct),
    };
  });
  const atHorizon = shallowView[shallowView.length - 1];
  const shallowLossPct = atHorizon?.lossPct ?? null;
  const looksBadByEngine = shallowLossPct !== null && shallowLossPct >= policy.minShallowLossPct;
  // A queen that can simply be taken looks like a blunder to a human, whatever a 1-ply search says.
  const looksBadByHanging = bigSacrifice && offered >= policy.bigSacrificeHangingMin;
  const horizonNote = bigSacrifice ? ` (short horizon for a ${sacrificeSize}-pawn sacrifice)` : '';
  gates.push({
    name: 'looks-bad-at-shallow-depth',
    passed: looksBadByEngine || looksBadByHanging,
    detail:
      (shallowLossPct === null
        ? 'The played move was not measured at shallow depth.'
        : `Searching ${horizon} ${horizon === 1 ? 'ply' : 'plies'} ahead${horizonNote}, the move looks ${shallowLossPct.toFixed(1)} pts worse than ${atHorizon!.bestUci} (needs ≥ ${policy.minShallowLossPct}).`) +
      (looksBadByHanging && !looksBadByEngine ? ` The opponent can take ${offered} pawns of material outright.` : ''),
  });

  // --- 2. Deep quality ------------------------------------------------------------------------
  const deepPlayedPct = pct(input.deep.playedScore, mover);
  const deepBestPct = pct(input.deep.bestScore, mover);
  const deepIsBest =
    input.deep.bestUci === input.playedUci ||
    sortKey(input.deep.playedScore, mover) >= sortKey(input.deep.bestScore, mover) ||
    deepBestPct - deepPlayedPct <= policy.bestTolerancePct;
  gates.push({
    name: 'best-at-depth',
    passed: deepIsBest && deepPlayedPct >= policy.minDeepExpected * 100,
    detail: `At depth ${input.deep.depth} the move is ${deepIsBest ? 'best/tied' : 'not best'} with ${deepPlayedPct.toFixed(1)}% expected score.`,
  });

  // --- 3. Decisive: clearly better than the alternatives ------------------------------------
  const uniquenessGapPct = input.deep.secondScore !== undefined ? deepBestPct - pct(input.deep.secondScore, mover) : null;
  gates.push({
    name: 'decisive',
    passed: uniquenessGapPct === null || uniquenessGapPct >= policy.minUniquenessPct,
    detail:
      uniquenessGapPct === null
        ? 'Only one sensible move was available.'
        : `Best minus second-best at depth: ${uniquenessGapPct.toFixed(1)} pts (needs ≥ ${policy.minUniquenessPct}).`,
  });

  // --- 4. Found only beyond the horizon, and stays sound ---------------------------------------
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
  if (lastUnsound === null && traj.length > 0) discoveryDepth = traj[0]!.depth;
  const discoveryInterval: [number, number] | null =
    discoveryDepth !== null && lastUnsound !== null ? [lastUnsound, discoveryDepth] : null;
  const sustained = discoveryDepth !== null && traj.filter((t) => t.depth >= discoveryDepth!).length >= policy.minSustainedDepths;
  gates.push({
    name: 'found-beyond-horizon',
    passed: discoveryDepth !== null && discoveryDepth > horizon && sustained,
    detail:
      discoveryDepth === null
        ? 'The move never settled into a sound evaluation.'
        : discoveryDepth <= horizon
          ? `Already sound at depth ${discoveryDepth}, within the ${horizon}-ply horizon.`
          : `Looked unsound up to depth ${lastUnsound}, sound from depth ${discoveryDepth}${sustained ? '' : ' (not sustained)'}.`,
  });

  // --- 5. Same move, shallow vs deep -----------------------------------------------------------
  const horizonPlayed = traj.filter((t) => t.depth <= horizon).at(-1);
  const inversionPct = horizonPlayed ? deepPlayedPct - pct(horizonPlayed.score, mover) : null;

  // --- 6. Stability on an independent recheck ---------------------------------------------------
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

  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const score =
    30 * clamp01((shallowLossPct ?? 0) / 30) +
    25 * clamp01((inversionPct ?? 0) / 40) +
    20 * clamp01((uniquenessGapPct ?? policy.minUniquenessPct) / 25) +
    (sacrifice ? 5 + 10 * Math.min(sacrificeSize, 9) / 9 : 0) +
    10 * clamp01(((discoveryDepth ?? 0) - horizon) / 8);

  // Verdict = the checks. The score only ranks how strong the evidence is.
  const hardGatesPassed = gates.filter((g) => g.name !== 'stable-on-recheck').every((g) => g.passed);
  let verdict: BrillianceVerdict = 'none';
  if (hardGatesPassed) verdict = stable === true ? 'brilliant' : stable === null ? 'candidate' : 'none';

  if (looksBadByEngine && shallowLossPct !== null) {
    const rank = atHorizon?.playedRank;
    reasons.push(
      `A ${horizon}-ply look rates it a mistake (${shallowLossPct.toFixed(1)} pts worse than ${atHorizon!.bestUci}${rank ? `; ${ordinal(rank)} of ${atHorizon!.legalMoves} moves` : ''}).`,
    );
  }
  if (deepIsBest) reasons.push(`Best move at depth ${input.deep.depth}.`);
  if (uniquenessGapPct !== null && uniquenessGapPct >= policy.minUniquenessPct)
    reasons.push(`Clearly better than the second-best move (${uniquenessGapPct.toFixed(1)} pts).`);
  if (sacrifice) reasons.push(input.sacrifice!.note);
  if (discoveryInterval) reasons.push(`The engine finds it between depth ${discoveryInterval[0]} and ${discoveryInterval[1]}.`);
  for (const g of gates) if (!g.passed) reasons.push(`Gate failed (${g.name}): ${g.detail}`);

  const confidence: BrillianceEvidence['confidence'] =
    stable === true && input.deep.depth >= 20 ? 'high' : stable === true ? 'medium' : 'low';

  return {
    version: BRILLIANCY_VERSION,
    verdict,
    score: Math.round(score),
    confidence,
    signals: {
      horizon,
      shallowLossPct,
      shallowRank: atHorizon?.playedRank ?? null,
      legalMoves: atHorizon?.legalMoves ?? null,
      shallowView,
      deepRank: deepIsBest ? 1 : null,
      deepExpectedPct: deepPlayedPct,
      inversionPct,
      uniquenessGapPct,
      discoveryDepth,
      discoveryInterval,
      sacrifice,
      sacrificeSize,
      offered,
      stable,
    },
    gates,
    reasons,
  };
}
