import { describe, expect, it } from 'vitest';
import type { BrillianceInput, ShallowSample } from './detector';
import { evaluateGreat } from './great';
import type { EngineScore } from '../engine/types';

const cp = (value: number): EngineScore => ({ kind: 'cp', value, perspective: 'white' });

/** Shallow samples (depths 1..n) for White: [played, best other move, played rank]. */
function shallow(rows: [played: number, other: number, rank: number][], legal = 30): ShallowSample[] {
  return rows.map(([played, other, rank], i) => ({
    depth: i + 1,
    playedRank: rank,
    sampledLines: legal,
    legalMoves: legal,
    bestUci: rank === 1 ? 'd2d4' : 'g1f3',
    bestScore: cp(Math.max(played, other)),
    playedScore: cp(played),
    bestOtherUci: 'g1f3',
    bestOtherScore: cp(other),
  }));
}

/**
 * Hypothetical Nd5!: at 1–3 plies it looks like several other moves (all about +0.3), but at
 * depth only Nd5 keeps the advantage (+1.8); the next move is level (0.0).
 */
function base(overrides: Partial<BrillianceInput> = {}): BrillianceInput {
  return {
    mover: 'w',
    playedUci: 'd2d4',
    shallow: shallow([
      [30, 40, 2],
      [35, 30, 1],
      [30, 25, 1],
    ]),
    trajectory: [30, 35, 30, 60, 120, 180].map((v, i) => ({ depth: i + 1, score: cp(v) })),
    deep: { depth: 18, bestUci: 'd2d4', bestScore: cp(180), secondScore: cp(0), secondUci: 'g1f3', playedScore: cp(180) },
    recheck: { depth: 20, bestUci: 'd2d4', bestScore: cp(175), secondScore: cp(5), secondUci: 'g1f3', playedScore: cp(175) },
    ...overrides,
  };
}

const gate = (e: ReturnType<typeof evaluateGreat>, name: string) => e.gates.find((g) => g.name === name)!.passed;

describe('evaluateGreat (great-v1)', () => {
  it('a move that only stands out at depth is great', () => {
    const e = evaluateGreat(base());
    expect(e.verdict).toBe('great');
    expect(e.signals.horizon).toBe(3);
    expect(e.signals.shallowLeadPct).toBeLessThan(4);
    expect(e.signals.deepGapPct).toBeGreaterThan(12);
    expect(e.signals.deepRivalUci).toBe('g1f3');
    expect(e.reasons.join(' ')).toMatch(/cannot tell it apart/);
  });

  it('an obvious recapture (far better even at 1 ply) is not great', () => {
    // Recapturing the queen: +0.2 against -8.5 for anything else, at every depth.
    const e = evaluateGreat(
      base({
        shallow: shallow([
          [20, -850, 1],
          [20, -850, 1],
          [20, -850, 1],
        ]),
        deep: { depth: 18, bestUci: 'd2d4', bestScore: cp(20), secondScore: cp(-850), secondUci: 'g1f3', playedScore: cp(20) },
        recheck: { depth: 20, bestUci: 'd2d4', bestScore: cp(20), secondScore: cp(-850), secondUci: 'g1f3', playedScore: cp(20) },
      }),
    );
    expect(gate(e, 'far-better-at-depth')).toBe(true);
    expect(gate(e, 'ambiguous-at-shallow-depth')).toBe(false);
    expect(e.verdict).toBe('none');
  });

  it('a move only slightly better than the next one at depth is not great', () => {
    const e = evaluateGreat(
      base({
        deep: { depth: 18, bestUci: 'd2d4', bestScore: cp(60), secondScore: cp(40), secondUci: 'g1f3', playedScore: cp(60) },
      }),
    );
    expect(gate(e, 'far-better-at-depth')).toBe(false);
    expect(e.verdict).toBe('none');
  });

  it('a move that is not best at depth is not great', () => {
    const e = evaluateGreat(
      base({
        deep: { depth: 18, bestUci: 'g1f3', bestScore: cp(180), secondScore: cp(0), secondUci: 'd2d4', playedScore: cp(0) },
      }),
    );
    expect(gate(e, 'best-at-depth')).toBe(false);
    expect(e.verdict).toBe('none');
  });

  it('a big lead in an already-won position does not count (expected score saturates)', () => {
    const e = evaluateGreat(
      base({
        deep: { depth: 18, bestUci: 'd2d4', bestScore: cp(900), secondScore: cp(500), secondUci: 'g1f3', playedScore: cp(900) },
      }),
    );
    expect(gate(e, 'far-better-at-depth')).toBe(false);
  });

  it('the only defence that keeps a draw while everything else loses is great', () => {
    const e = evaluateGreat(
      base({
        deep: { depth: 18, bestUci: 'd2d4', bestScore: cp(0), secondScore: cp(-400), secondUci: 'g1f3', playedScore: cp(0) },
        recheck: { depth: 20, bestUci: 'd2d4', bestScore: cp(0), secondScore: cp(-420), secondUci: 'g1f3', playedScore: cp(0) },
      }),
    );
    expect(e.verdict).toBe('great');
  });

  it('the best move in a lost position is not great', () => {
    const e = evaluateGreat(
      base({
        deep: { depth: 18, bestUci: 'd2d4', bestScore: cp(-450), secondScore: cp(-1200), secondUci: 'g1f3', playedScore: cp(-450) },
        recheck: { depth: 20, bestUci: 'd2d4', bestScore: cp(-450), secondScore: cp(-1200), secondUci: 'g1f3', playedScore: cp(-450) },
      }),
    );
    expect(gate(e, 'best-at-depth')).toBe(false);
    expect(e.verdict).toBe('none');
  });

  it('needs the deeper recheck to agree', () => {
    expect(evaluateGreat(base({ recheck: undefined })).verdict).toBe('none');
    const e = evaluateGreat(
      base({
        recheck: { depth: 20, bestUci: 'd2d4', bestScore: cp(60), secondScore: cp(50), secondUci: 'g1f3', playedScore: cp(60) },
      }),
    );
    expect(gate(e, 'stable-on-recheck')).toBe(false);
  });

  it('works for Black (scores are White-relative)', () => {
    const e = evaluateGreat(
      base({
        mover: 'b',
        shallow: shallow([
          [-30, -40, 1],
          [-30, -28, 2],
          [-30, -25, 2],
        ]),
        deep: { depth: 18, bestUci: 'd2d4', bestScore: cp(-180), secondScore: cp(0), secondUci: 'g1f3', playedScore: cp(-180) },
        recheck: { depth: 20, bestUci: 'd2d4', bestScore: cp(-175), secondScore: cp(0), secondUci: 'g1f3', playedScore: cp(-175) },
      }),
    );
    expect(e.verdict).toBe('great');
  });

  it('a forced move (one legal move) is not great', () => {
    const e = evaluateGreat(base({ shallow: shallow([[30, 30, 1]], 1) }));
    expect(gate(e, 'has-alternatives')).toBe(false);
  });
});
