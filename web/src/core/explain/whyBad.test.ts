import { describe, expect, it } from 'vitest';
import type { EngineScore } from '../engine/types';
import { describeThreat, describeThreats, explainBadMove, materialSwing, nullMoveFen } from './whyBad';

const cp = (value: number): EngineScore => ({ kind: 'cp', value, perspective: 'white' });
const mate = (moves: number, winner: 'w' | 'b'): EngineScore => ({ kind: 'mate', moves, winner, perspective: 'white' });
const kinds = (r: ReturnType<typeof explainBadMove>) => r.causes.map((c) => c.kind);

describe('nullMoveFen', () => {
  it('hands the move to the other side and clears en passant', () => {
    expect(nullMoveFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2',
    );
  });
  it('is not possible in check', () => {
    expect(nullMoveFen('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1')).toBeUndefined();
  });
});

describe('materialSwing', () => {
  it('counts material after the reply', () => {
    // Bc4?? dxc4: White loses the bishop.
    expect(materialSwing('4k3/8/8/3p4/8/8/8/4KB2 w - - 0 1', ['f1c4', 'd5c4'], 'w')).toBe(-3);
  });
});

describe('explainBadMove (why-v1)', () => {
  it('ignored threat: the knight was attacked and the move did not save it', () => {
    // Black's d5 pawn attacks the knight on e4; White plays Ke2 and loses it.
    const r = explainBadMove({
      fenBefore: '4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1',
      mover: 'w',
      playedUci: 'e1e2',
      lines: [
        { uci: ['e4c3', 'e8e7'], score: cp(250) },
        { uci: ['e4c5', 'e8e7'], score: cp(245) },
      ],
      played: { uci: ['e1e2', 'd5e4'], score: cp(-100) },
      threats: [{ uci: ['d5e4'], score: cp(-100) }],
    });
    expect(r.threat?.real).toBe(true);
    expect(r.threat?.san).toBe('dxe4');
    expect(r.threat?.effect).toBe('wins 3 pawns of material');
    expect(kinds(r)).toEqual(['ignored-threat']);
    expect(r.causes[0]).toMatchObject({ match: 'same-move' });
    expect(r.causes[0]!.text).toMatch(/Black threatened dxe4, which wins 3 pawns of material\. Ke2 did not stop it: dxe4 follows\./);
  });

  it('allowed tactic: no threat before, the move puts a piece where it can be taken', () => {
    const r = explainBadMove({
      fenBefore: '4k3/8/8/3p4/8/8/8/4KB2 w - - 0 1',
      mover: 'w',
      playedUci: 'f1c4',
      lines: [
        { uci: ['f1d3', 'e8e7'], score: cp(220) },
        { uci: ['f1e2', 'e8e7'], score: cp(215) },
      ],
      played: { uci: ['f1c4', 'd5c4'], score: cp(-100) },
      threats: [{ uci: ['e8e7'], score: cp(200) }],
    });
    expect(r.threat?.real).toBe(false);
    expect(kinds(r)).toEqual(['allowed-tactic']);
    expect(r.causes[0]!.text).toBe("Bc4 allows dxc4; in the engine's line Black wins 3 pawns of material. There was no such threat before your move.");
  });

  it('missed opportunity and only move: the queen could be taken', () => {
    const r = explainBadMove({
      fenBefore: '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1',
      mover: 'w',
      playedUci: 'e1e2',
      lines: [
        { uci: ['d1d5', 'e8e7'], score: cp(500) },
        { uci: ['e1e2', 'd5e5'], score: cp(-400) },
      ],
      played: { uci: ['e1e2', 'd5e5', 'e2f2'], score: cp(-400) },
      threats: [{ uci: ['d5d1', 'e1d1'], score: cp(-900) }],
    });
    expect(kinds(r)).toEqual(['only-move', 'missed-opportunity']);
    expect(r.causes[1]!.text).toBe('Rxd5 wins 9 pawns of material. Ke2 misses it.');
  });

  it('a capture both moves make is not a missed opportunity', () => {
    const r = explainBadMove({
      fenBefore: '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1',
      mover: 'w',
      playedUci: 'd1d5',
      lines: [
        { uci: ['d1d5', 'e8e7'], score: cp(500) },
        { uci: ['e1e2', 'd5e5'], score: cp(-400) },
      ],
      played: { uci: ['d1d5', 'e8e7'], score: cp(450) },
    });
    expect(kinds(r)).not.toContain('missed-opportunity');
  });

  it('ignored mate threat', () => {
    // Black threatens Qg2# (the rook on f2 covers g2) and White has no defence.
    const fen = '6k1/8/8/8/8/6q1/5r2/7K w - - 0 1';
    const r = explainBadMove({
      fenBefore: fen,
      mover: 'w',
      playedUci: 'h1g1',
      lines: [{ uci: ['h1g1', 'g3g2'], score: mate(1, 'b') }],
      played: { uci: ['h1g1', 'g3g2'], score: mate(1, 'b') },
      threats: [{ uci: ['g3g2'], score: mate(1, 'b') }],
    });
    // Every move gets mated: the threat cannot be stopped, so it is not "ignored".
    expect(r.threat?.real).toBe(false);
    expect(kinds(r)).not.toContain('ignored-threat');
  });

  it('positional: nothing concrete happens', () => {
    const r = explainBadMove({
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      mover: 'w',
      playedUci: 'g2g4',
      lines: [
        { uci: ['e2e4', 'e7e5'], score: cp(40) },
        { uci: ['d2d4', 'd7d5'], score: cp(35) },
      ],
      played: { uci: ['g2g4', 'd7d5'], score: cp(-60) },
      threats: [{ uci: ['e7e5'], score: cp(10) }],
    });
    expect(kinds(r)).toEqual(['positional']);
  });

  it('in check there is no separate threat', () => {
    const r = explainBadMove({
      fenBefore: '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1',
      mover: 'w',
      playedUci: 'e1f1',
      lines: [{ uci: ['e1e2'], score: cp(0) }],
      played: { uci: ['e1f1', 'e2e1'], score: cp(-50) },
    });
    expect(r.inCheck).toBe(true);
    expect(r.threat).toBeUndefined();
  });

  it('works for Black', () => {
    // Mirror of the hanging-knight case: White's d4 pawn attacks the knight on e5.
    const r = explainBadMove({
      fenBefore: '4k3/8/8/4n3/3P4/8/8/4K3 b - - 0 1',
      mover: 'b',
      playedUci: 'e8e7',
      lines: [
        { uci: ['e5c6', 'e1e2'], score: cp(-250) },
        { uci: ['e5g6', 'e1e2'], score: cp(-245) },
      ],
      played: { uci: ['e8e7', 'd4e5'], score: cp(100) },
      threats: [{ uci: ['d4e5'], score: cp(100) }],
    });
    expect(kinds(r)).toEqual(['ignored-threat']);
    expect(r.causes[0]!.text).toMatch(/^Before Ke7, White threatened dxe5/);
  });
});

describe('describeThreat', () => {
  it('flags few-piece positions as low confidence (zugzwang)', () => {
    const t = describeThreat('4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1', cp(250), { uci: ['d5e4'], score: cp(-100) });
    expect(t?.real).toBe(true);
    expect(t?.lowConfidence).toBe(true);
    expect(t?.fen.split(' ')[1]).toBe('b');
  });
});

describe('threats and material counting (why-v1 refinements)', () => {
  it('does not stop counting material in the middle of an exchange', () => {
    // Rxd5 exd5: after ply 1 White is up a queen, but Black recaptures the rook.
    const fen = '4k3/8/4p3/3q4/8/8/8/3RK3 w - - 0 1';
    expect(materialSwing(fen, ['d1d5'], 'w')).toBe(9);
    expect(materialSwing(fen, ['d1d5', 'e6d5'], 'w', 1)).toBe(4);
  });

  it('a quiet move is not a threat, even when passing costs a lot', () => {
    const t = describeThreat('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', cp(40), { uci: ['g8f6'], score: cp(-200) });
    expect(t?.sizePct).toBeGreaterThan(8);
    expect(t?.real).toBe(false);
  });

  it('a threat to win a single pawn counts', () => {
    const t = describeThreat('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', cp(60), { uci: ['d5e4', 'b1c3'], score: cp(-60) });
    expect(t?.real).toBe(true);
    expect(t?.effect).toBe('wins 1 pawn of material');
  });

  it('says when the move dealt with a real threat', () => {
    const r = explainBadMove({
      fenBefore: '4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1',
      mover: 'w',
      playedUci: 'e4c5',
      lines: [
        { uci: ['e4c3', 'e8e7'], score: cp(250) },
        { uci: ['e4c5', 'e8e7'], score: cp(200) },
      ],
      played: { uci: ['e4c5', 'e8e7'], score: cp(200) },
      threats: [{ uci: ['d5e4'], score: cp(-100) }],
    });
    expect(r.threatHandled).toBe(true);
    expect(r.causes.map((c) => c.kind)).toEqual(['positional']);
  });
});

describe('several threats and eval wording', () => {
  it('lists only real threats, strongest first, at most 3', () => {
    // Knight on e4 attacked by d5; Black also has quiet moves that are not threats.
    const fen = '4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1';
    const ts = describeThreats(fen, cp(250), [
      { uci: ['d5e4'], score: cp(-100) },
      { uci: ['e8e7'], score: cp(240) },
      { uci: ['e8d7'], score: cp(240) },
    ]);
    expect(ts.map((t) => t.san)).toEqual(['dxe4']);
    expect(ts[0]!.evalNow).toEqual(cp(250));
    expect(ts[0]!.evalIfIgnored).toEqual(cp(-100));
  });

  it('describes the only move with eval-bar numbers, not internal points', () => {
    const r = explainBadMove({
      fenBefore: '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1',
      mover: 'w',
      playedUci: 'e1e2',
      lines: [
        { uci: ['d1d5', 'e8e7'], score: cp(500) },
        { uci: ['e1e2', 'd5e5'], score: cp(-400) },
      ],
      played: { uci: ['e1e2', 'd5e5', 'e2f2'], score: cp(-400) },
    });
    expect(r.causes[0]!.text).toBe('Rxd5 was the only good move (eval +5.00). The next best, Ke2, only reaches -4.00.');
    expect(r.causes.map((c) => c.text).join(' ')).not.toMatch(/points|pts/);
  });
});
