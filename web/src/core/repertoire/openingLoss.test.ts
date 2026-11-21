import { describe, expect, it } from 'vitest';
import { parseSingleGame } from '../chess/pgn';
import type { EngineScore } from '../engine/types';
import { toOpeningGame, type OpeningGame } from './games';
import { dropLabel, openingLoss, pgnEvals, pliesToLookUp, refinePly, type EvalAt } from './openingLoss';
import { parseCloudEval, standardLine } from '../../features/repertoire/cloudEval';

function game(moves: string, result: string, me: 'w' | 'b' = 'w', pgnExtra = ''): OpeningGame {
  const [white, black] = me === 'w' ? ['Me', 'Opp'] : ['Opp', 'Me'];
  const pgn = `[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n[UTCDate "2026.11.01"]\n\n${pgnExtra || moves} ${result}`;
  const rec = parseSingleGame(pgn, { source: 'lichess', sourceUrl: 'https://lichess.org/x' });
  return toOpeningGame({ ...rec, id: 'x' }, 'Me')!;
}

const cp = (v: number): EngineScore => ({ kind: 'cp', value: v, perspective: 'white' });
const evals = (m: Record<number, number>, pv: Record<number, string[]> = {}): EvalAt => (ply) => (ply in m ? { score: cp(m[ply]!), pv: pv[ply] } : undefined);

describe('opening losses', () => {
  const g = game('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5', '0-1');

  it('asks for the position before your first move and after each of yours', () => {
    expect(pliesToLookUp(g, 8)).toEqual([0, 1, 3, 5, 7]);
    expect(pliesToLookUp(game('1. e4 e5 2. Nf3 Nc6', '1-0', 'b'), 4)).toEqual([1, 2, 4]);
  });

  it('finds the move that dropped your win chances most, exact when the position before is known', () => {
    const loss = openingLoss(g, 8, evals({ 0: 20, 1: 30, 3: 35, 5: 30, 6: 30, 7: -400 }, { 6: ['f3d4', 'g5g2'] }));
    expect(loss.worst?.san).toBe('Nxe5');
    expect(loss.worst?.beforePly).toBe(6);
    expect(loss.worst?.best).toBe('f3d4');
    expect(dropLabel(loss.worst!.drop)).toBe('blunder');
    expect(loss.end?.ply).toBe(7);
    expect(loss.known).toBe(5);
    expect(refinePly(loss)).toBeNull();
  });

  it('measures over two plies when the position before is missing, and asks for it', () => {
    const loss = openingLoss(g, 8, evals({ 0: 20, 1: 30, 3: 35, 5: 30, 7: -400 }));
    expect(loss.worst?.beforePly).toBe(5);
    expect(loss.worst?.best).toBeUndefined();
    expect(refinePly(loss)).toBe(6);
  });

  it('reads evaluations written in a Lichess game', () => {
    const withEvals = '1. e4 { [%eval 0.3] } 1... e5 { [%eval 0.25] } 2. Qh5 { [%eval -0.5] } 2... Nc6 { [%eval #-3] }';
    const m = pgnEvals(game('', '0-1', 'w', withEvals).pgn);
    expect(m.get(1)).toEqual(cp(30));
    expect(m.get(3)).toEqual(cp(-50));
    expect(m.get(4)).toEqual({ kind: 'mate', moves: 3, winner: 'b', perspective: 'white' });
  });
});

describe('cloud evaluations', () => {
  it('reads a cloud answer and writes castling as the rest of the app does', () => {
    const fen = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const e = parseCloudEval({ depth: 40, pvs: [{ moves: 'e1h1 g8f6', cp: 25 }] }, fen);
    expect(e).toEqual({ score: cp(25), depth: 40, pv: ['e1g1', 'g8f6'] });
  });

  it('keeps a rook move from e1 to h1 as it is', () => {
    expect(standardLine('k7/8/8/8/8/8/K7/4R3 w - - 0 1', ['e1h1'])).toEqual(['e1h1']);
  });
});

describe('fix chapters', async () => {
  const { fixPgn, linePly } = await import('../../features/repertoire/fixes');
  const { parseRepertoirePgn } = await import('./parse');
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

  it('starts at the position, with the context before and the reason on the move', () => {
    const replies = linePly(fen, ['b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6']);
    const pgn = fixPgn({ colour: 'b', fen, reachedBy: ['e4', 'e5', 'Nf3'], played: 'd6', better: 'b8c6', why: 'Nc6 scores better.', context: 'You played d6 here.' }, replies, 'Instead of 2… d6');
    const ch = parseRepertoirePgn(pgn).chapters[0]!;
    expect(ch.startFen).toBe(fen);
    expect(ch.orientation).toBe('b');
    expect(ch.title).toBe('Instead of 2… d6');
    expect(ch.root.comments).toEqual(['You played d6 here.']);
    const first = ch.root.children[0]!;
    expect(first.san).toBe('Nc6');
    expect(first.comments).toEqual(['Nc6 scores better.']);
    // The engine's line after the better move, ending on your move.
    const line: string[] = [];
    for (let n = first.children[0]; n; n = n.children[0]) line.push(n.san!);
    expect(line).toEqual(['Bb5', 'a6', 'Ba4', 'Nf6']);
    expect(linePly(fen, ['b8c6', 'f1b5', 'a7a6']).length).toBe(1);
  });
});
