import { describe, expect, it } from 'vitest';
import { classifyMove } from './classify';
import { gameAccuracy, moveAccuracy } from '../scoring/accuracy';
import { expectedScore, formatScore, moveLoss } from '../scoring/score';
import type { EngineScore } from '../engine/types';

const cp = (value: number): EngineScore => ({ kind: 'cp', value, perspective: 'white' });
const mate = (moves: number, winner: 'w' | 'b'): EngineScore => ({ kind: 'mate', moves, winner, perspective: 'white' });

describe('score perspective for both colours', () => {
  it('a strong Black move is not a blunder just because scores are white-relative', () => {
    // Black's best keeps -200 for White; Black played the same quality move.
    const c = classifyMove({ mover: 'b', playedUci: 'e7e5', bestUci: 'e7e5', best: cp(-200), played: cp(-200) });
    expect(c.category).toBe('best');
  });
  it('Black worsening their position (White eval rising) is penalised', () => {
    const c = classifyMove({ mover: 'b', playedUci: 'a7a6', bestUci: 'e7e5', best: cp(-200), played: cp(+300) });
    expect(c.category).toBe('blunder');
    expect(c.loss.centipawnLoss).toBe(500);
  });
  it('White playing a bad move gets positive CPL', () => {
    const l = moveLoss(cp(150), cp(-50), 'w');
    expect(l.centipawnLoss).toBe(200);
    expect(l.expectedLossPct).toBeGreaterThan(15);
  });
});

describe('classification tiers', () => {
  it('ties within tolerance are best', () => {
    expect(classifyMove({ mover: 'w', playedUci: 'd2d4', bestUci: 'e2e4', best: cp(30), played: cp(24) }).category).toBe('best');
  });
  it('maps loss to good / questionable / mistake / blunder', () => {
    const cat = (played: number) =>
      classifyMove({ mover: 'w', playedUci: 'x', bestUci: 'y', best: cp(0), played: cp(played) }).category;
    expect(cat(-20)).toBe('good');
    expect(cat(-60)).toBe('questionable');
    expect(cat(-150)).toBe('mistake');
    expect(cat(-400)).toBe('blunder');
  });
  it('forced moves are best', () => {
    expect(classifyMove({ mover: 'w', playedUci: 'x', bestUci: 'x', best: cp(-500), played: cp(-500), forced: true }).category).toBe('best');
  });
  it('brilliant requires the move to also be best', () => {
    expect(classifyMove({ mover: 'w', playedUci: 'x', bestUci: 'x', best: cp(400), played: cp(400), brilliant: true }).category).toBe('brilliant');
    expect(classifyMove({ mover: 'w', playedUci: 'x', bestUci: 'y', best: cp(400), played: cp(0), brilliant: true }).category).not.toBe('brilliant');
  });
});

describe('mate handling without fake centipawns', () => {
  it('allowing mate is a blunder and has no CPL', () => {
    const c = classifyMove({ mover: 'w', playedUci: 'x', bestUci: 'y', best: cp(50), played: mate(2, 'b') });
    expect(c.category).toBe('blunder');
    expect(c.loss.centipawnLoss).toBeUndefined();
  });
  it('missing mate while staying winning is a mistake, not a blunder', () => {
    const c = classifyMove({ mover: 'w', playedUci: 'x', bestUci: 'y', best: mate(3, 'w'), played: cp(900) });
    expect(c.category).toBe('mistake');
  });
  it('missing mate into equality is a blunder', () => {
    expect(classifyMove({ mover: 'b', playedUci: 'x', bestUci: 'y', best: mate(1, 'b'), played: cp(0) }).category).toBe('blunder');
  });
  it('slower mate is good', () => {
    expect(classifyMove({ mover: 'w', playedUci: 'x', bestUci: 'y', best: mate(2, 'w'), played: mate(5, 'w') }).category).toBe('good');
  });
  it('being mated anyway by every move is best', () => {
    expect(classifyMove({ mover: 'w', playedUci: 'x', bestUci: 'y', best: mate(4, 'b'), played: mate(4, 'b') }).category).toBe('best');
  });
});

describe('accuracy', () => {
  it('is 100 for zero loss and decreases monotonically', () => {
    expect(moveAccuracy(0)).toBe(100);
    expect(moveAccuracy(10)).toBeLessThan(moveAccuracy(5));
  });
  it('needs enough moves and marks partial analysis provisional', () => {
    expect(gameAccuracy([{ expectedLossPct: 0, forced: false }]).value).toBeUndefined();
    const r = gameAccuracy([
      ...Array.from({ length: 6 }, () => ({ expectedLossPct: 0, forced: false })),
      { expectedLossPct: undefined, forced: false },
    ]);
    expect(r.value).toBe(100);
    expect(r.provisional).toBe(true);
  });
  it('is reproducible and ignores forced moves', () => {
    const moves = [1, 2, 3, 30, 4, 0].map((l) => ({ expectedLossPct: l, forced: false }));
    const a = gameAccuracy([...moves, { expectedLossPct: 90, forced: true }]);
    expect(a).toEqual(gameAccuracy(moves));
  });
});

describe('formatting', () => {
  it('formats scores', () => {
    expect(formatScore(cp(124))).toBe('+1.24');
    expect(formatScore(mate(3, 'b'))).toBe('#-3');
    expect(expectedScore(cp(0), 'w')).toBeCloseTo(0.5);
  });
});
