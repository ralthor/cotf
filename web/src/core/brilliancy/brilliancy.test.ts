import { describe, expect, it } from 'vitest';
import { evaluateBrilliance, type BrillianceInput, type ShallowRankSample } from './detector';
import { detectSacrifice, materialBalance } from './sacrifice';
import type { EngineScore } from '../engine/types';

const cp = (value: number): EngineScore => ({ kind: 'cp', value, perspective: 'white' });

/** Shallow samples where the played move has `ranks[d-1]` at depth d (full-width sampling). */
function shallow(ranks: (number | null)[], sampledLines = 30, legalMoves = 30): ShallowRankSample[] {
  return ranks.map((r, i) => ({ depth: i + 1, playedRank: r, sampledLines, legalMoves, bestScore: cp(50) }));
}

/** White-to-move hypothetical Rxf7!!: looks bad until depth ~8, then +4.5. */
function brilliantInput(overrides: Partial<BrillianceInput> = {}): BrillianceInput {
  const trajectory = [-280, -310, -250, -200, -150, -60, 40, 300, 380, 420, 430, 440, 450, 450, 450, 450, 450, 450, 450, 450].map(
    (v, i) => ({ depth: i + 1, score: cp(v) }),
  );
  return {
    mover: 'w',
    playedUci: 'f1f7',
    shallow: shallow([6, 7, 6, 5, 4, 3, 2, 1]),
    trajectory,
    deep: { depth: 20, bestUci: 'f1f7', bestScore: cp(450), secondScore: cp(60), playedScore: cp(450) },
    recheck: { depth: 24, bestUci: 'f1f7', bestScore: cp(440), secondScore: cp(50), playedScore: cp(440) },
    sacrifice: { isSacrifice: true, maxDeficit: 5, persistedCheckpoints: 2, finalDelta: 1, inspectedPlies: 8, note: 'rook sac' },
    ...overrides,
  };
}

describe('evaluateBrilliance', () => {
  it('recognises a sound shallow-to-deep reversal and explains it', () => {
    const e = evaluateBrilliance(brilliantInput());
    expect(e.verdict).toBe('brilliant');
    expect(e.signals.shallowWorstRank).toBe(7);
    expect(e.signals.discoveryInterval).toEqual([8, 9]);
    expect(e.confidence).toBe('high');
    expect(e.reasons.join(' ')).toMatch(/Ranked #7/);
  });

  it('a deeply refuted sacrifice is NOT brilliant despite its initial appearance', () => {
    const e = evaluateBrilliance(
      brilliantInput({
        deep: { depth: 20, bestUci: 'e2e4', bestScore: cp(80), secondScore: cp(60), playedScore: cp(-350) },
        trajectory: [-280, 150, 300, 200, 50, -100, -250, -300, -340, -350].map((v, i) => ({ depth: i + 1, score: cp(v) })),
      }),
    );
    expect(e.verdict).toBe('none');
    expect(e.gates.find((g) => g.name === 'deep-quality')!.passed).toBe(false);
  });

  it('an obvious best move (rank 1 throughout, never looked bad) is not brilliant', () => {
    const e = evaluateBrilliance(
      brilliantInput({
        shallow: shallow([1, 1, 1, 1, 1, 1, 1, 1]),
        trajectory: Array.from({ length: 20 }, (_, i) => ({ depth: i + 1, score: cp(450) })),
        sacrifice: undefined,
      }),
    );
    expect(e.verdict).toBe('none');
  });

  it('without an independent recheck the best possible verdict is "candidate"', () => {
    const e = evaluateBrilliance(brilliantInput({ recheck: undefined }));
    expect(e.verdict).toBe('candidate');
    expect(e.signals.stable).toBeNull();
  });

  it('an unstable recheck rejects the move', () => {
    const e = evaluateBrilliance(
      brilliantInput({ recheck: { depth: 24, bestUci: 'g1f3', bestScore: cp(300), playedScore: cp(-50) } }),
    );
    expect(e.verdict).toBe('none');
  });

  it('does not claim exact rank #6 from a MultiPV=2 sample', () => {
    const e = evaluateBrilliance(brilliantInput({ shallow: shallow([null, null, null, 2, 1, 1], 2, 30) }));
    expect(e.signals.shallowRankIsExact).toBe(false);
    expect(e.signals.shallowWorstRank).toBe(3); // only "outside top 2"
    expect(e.reasons.join(' ')).toMatch(/#3\+/);
  });

  it('noisy oscillation that only settles at the last depth does not qualify', () => {
    const traj = [-300, 400, -300, 400, -300, 400, -300, 400, -300, 450].map((v, i) => ({ depth: i + 1, score: cp(v) }));
    const e = evaluateBrilliance(brilliantInput({ trajectory: traj, deep: { ...brilliantInput().deep, depth: 10 } }));
    expect(e.gates.find((g) => g.name === 'sustained-discovery')!.passed).toBe(false);
    expect(e.verdict).toBe('none');
  });

  it('scores Black moves from Black\'s perspective', () => {
    const flip = (s: EngineScore): EngineScore => (s.kind === 'cp' ? cp(-s.value) : s);
    const w = brilliantInput();
    const b: BrillianceInput = {
      ...w,
      mover: 'b',
      trajectory: w.trajectory.map((t) => ({ ...t, score: flip(t.score) })),
      deep: { ...w.deep, bestScore: flip(w.deep.bestScore), secondScore: flip(w.deep.secondScore!), playedScore: flip(w.deep.playedScore) },
      recheck: { ...w.recheck!, bestScore: flip(w.recheck!.bestScore), playedScore: flip(w.recheck!.playedScore) },
    };
    expect(evaluateBrilliance(b).verdict).toBe('brilliant');
  });
});

describe('detectSacrifice', () => {
  it('computes material balance per colour', () => {
    expect(materialBalance('r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'w')).toBe(0);
    expect(materialBalance('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'b')).toBe(-5);
  });
  it('detects a rook left en prise for several replies', () => {
    const s = detectSacrifice('r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['a1a7', 'a8a7', 'h2h3', 'g7g6', 'g1h2', 'h7h6']);
    expect(s.isSacrifice).toBe(true);
    expect(s.maxDeficit).toBe(5);
  });
  it('an exchange with recapture is not a sacrifice', () => {
    const s = detectSacrifice('r2q2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['a1a8', 'd8a8', 'h2h3', 'h7h6']);
    expect(s.isSacrifice).toBe(false);
  });
});
