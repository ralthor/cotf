import { describe, expect, it } from 'vitest';
import { evaluateBrilliance, ordinal, type BrillianceInput, type ShallowSample } from './detector';
import { detectSacrifice, materialBalance } from './sacrifice';
import type { EngineScore } from '../engine/types';

const cp = (value: number): EngineScore => ({ kind: 'cp', value, perspective: 'white' });

/** Shallow samples (depths 1..n): played move score vs best-at-depth score, White to move. */
function shallow(rows: [played: number, best: number, rank: number][], legal = 30): ShallowSample[] {
  return rows.map(([played, best, rank], i) => ({
    depth: i + 1,
    playedRank: rank,
    sampledLines: legal,
    legalMoves: legal,
    bestUci: 'g1f3',
    bestScore: cp(best),
    playedScore: cp(played),
  }));
}

/**
 * Hypothetical Nxe5!: a 3-ply look sees a lost queen (-600 vs +30 for the best move);
 * the engine finds the refutation of the capture from depth 6 and plays it at +150.
 */
function base(overrides: Partial<BrillianceInput> = {}): BrillianceInput {
  const traj = [-650, -600, -600, -580, -300, 120, 140, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150];
  return {
    mover: 'w',
    playedUci: 'f3e5',
    shallow: shallow([
      [-650, 40, 30],
      [-600, 35, 29],
      [-600, 30, 28],
    ]),
    trajectory: traj.map((v, i) => ({ depth: i + 1, score: cp(v) })),
    deep: { depth: 18, bestUci: 'f3e5', bestScore: cp(150), secondScore: cp(20), playedScore: cp(150) },
    recheck: { depth: 20, bestUci: 'f3e5', bestScore: cp(155), secondScore: cp(25), playedScore: cp(155) },
    ...overrides,
  };
}

describe('evaluateBrilliance (brill-v2, shallow horizon)', () => {
  it('a move that looks like a blunder within 3 plies but is the decisive best move is brilliant', () => {
    const e = evaluateBrilliance(base());
    expect(e.verdict).toBe('brilliant');
    expect(e.signals.horizon).toBe(3);
    expect(e.signals.shallowLossPct).toBeGreaterThan(40);
    expect(e.signals.shallowView).toHaveLength(3);
    expect(e.signals.discoveryInterval).toEqual([5, 6]);
    expect(e.reasons.join(' ')).toMatch(/3-ply look rates it a mistake/);
    expect(e.reasons.join(' ')).toMatch(/28th of 30/);
  });

  it('a low shallow rank in an already-winning position is NOT enough (the old false positive)', () => {
    // Everything wins: the played move is +4 at shallow depth while the best is +8, and at depth
    // it is only marginally better than the second move.
    const e = evaluateBrilliance(
      base({
        shallow: shallow([
          [409, 804, 26],
          [409, 879, 26],
          [548, 897, 26],
        ], 34),
        trajectory: [409, 409, 548, 357, 455, 455, 455, 700, 720, 730, 735, 740, 740, 740].map((v, i) => ({ depth: i + 1, score: cp(v) })),
        deep: { depth: 14, bestUci: 'f3e5', bestScore: cp(740), secondScore: cp(700), playedScore: cp(740) },
        recheck: { depth: 16, bestUci: 'f3e5', bestScore: cp(735), secondScore: cp(690), playedScore: cp(735) },
      }),
    );
    expect(e.verdict).toBe('none');
    expect(e.gates.find((g) => g.name === 'looks-bad-at-shallow-depth')!.passed).toBe(false);
    expect(e.gates.find((g) => g.name === 'decisive')!.passed).toBe(false);
  });

  it('an obvious move (already best within the horizon) is not brilliant', () => {
    const e = evaluateBrilliance(
      base({
        shallow: shallow([
          [150, 150, 1],
          [150, 150, 1],
          [150, 150, 1],
        ]),
        trajectory: Array.from({ length: 18 }, (_, i) => ({ depth: i + 1, score: cp(150) })),
      }),
    );
    expect(e.verdict).toBe('none');
  });

  it('a deeply refuted sacrifice is not brilliant', () => {
    const e = evaluateBrilliance(
      base({ deep: { depth: 18, bestUci: 'g1f3', bestScore: cp(40), secondScore: cp(30), playedScore: cp(-600) } }),
    );
    expect(e.verdict).toBe('none');
    expect(e.gates.find((g) => g.name === 'best-at-depth')!.passed).toBe(false);
  });

  it('a move found within the horizon does not count as found beyond it', () => {
    const traj = [-600, 150, 150, 150, 150, 150, 150, 150].map((v, i) => ({ depth: i + 1, score: cp(v) }));
    const e = evaluateBrilliance(base({ trajectory: traj }));
    expect(e.gates.find((g) => g.name === 'found-beyond-horizon')!.passed).toBe(false);
    expect(e.verdict).toBe('none');
  });

  it('respects a 1-ply horizon (e.g. Qb8+ in the Opera Game)', () => {
    const m2: EngineScore = { kind: 'mate', moves: 2, winner: 'w', perspective: 'white' };
    const trajectory = [cp(-800), cp(-800), ...Array.from({ length: 11 }, () => m2)].map((score, i) => ({ depth: i + 1, score }));
    const e = evaluateBrilliance(
      base({
        shallow: shallow([[-800, 300, 35]]),
        trajectory,
        deep: { depth: 13, bestUci: 'f3e5', bestScore: m2, secondScore: cp(300), playedScore: m2 },
        recheck: { depth: 15, bestUci: 'f3e5', bestScore: m2, playedScore: m2 },
      }),
    );
    expect(e.signals.horizon).toBe(1);
    expect(e.signals.discoveryInterval).toEqual([2, 3]);
    expect(e.verdict).toBe('brilliant');
  });

  it('without an independent recheck the best possible verdict is "candidate"', () => {
    expect(evaluateBrilliance(base({ recheck: undefined })).verdict).toBe('candidate');
  });

  it('an unstable recheck rejects the move', () => {
    const e = evaluateBrilliance(base({ recheck: { depth: 20, bestUci: 'g1f3', bestScore: cp(300), playedScore: cp(-50) } }));
    expect(e.verdict).toBe('none');
  });

  it("scores Black moves from Black's perspective", () => {
    const flip = (s: EngineScore): EngineScore => (s.kind === 'cp' ? cp(-s.value) : s);
    const w = base();
    const b: BrillianceInput = {
      ...w,
      mover: 'b',
      shallow: w.shallow.map((s) => ({ ...s, bestScore: flip(s.bestScore), playedScore: flip(s.playedScore!) })),
      trajectory: w.trajectory.map((t) => ({ ...t, score: flip(t.score) })),
      deep: { ...w.deep, bestScore: flip(w.deep.bestScore), secondScore: flip(w.deep.secondScore!), playedScore: flip(w.deep.playedScore) },
      recheck: { ...w.recheck!, bestScore: flip(w.recheck!.bestScore), secondScore: flip(w.recheck!.secondScore!), playedScore: flip(w.recheck!.playedScore) },
    };
    expect(evaluateBrilliance(b).verdict).toBe('brilliant');
  });

  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 26].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '26th']);
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
