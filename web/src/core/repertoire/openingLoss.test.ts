import { describe, expect, it } from 'vitest';
import { parseSingleGame } from '../chess/pgn';
import type { EngineScore } from '../engine/types';
import { toOpeningGame, type OpeningGame } from './games';
import { DEFAULT_RULE } from './insights';
import { dbPliesNeeded, dbValueAt, dropLabel, engineValue, MIN_DB_GAMES, openingLoss, scoreFromWin, yourPlies, type ValueAt } from './openingLoss';

function game(moves: string, result: string, me: 'w' | 'b' = 'w'): OpeningGame {
  const [white, black] = me === 'w' ? ['Me', 'Opp'] : ['Opp', 'Me'];
  const pgn = `[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n[UTCDate "2026.11.01"]\n\n${moves} ${result}`;
  const rec = parseSingleGame(pgn, { source: 'lichess', sourceUrl: 'https://lichess.org/x' });
  return toOpeningGame({ ...rec, id: 'x' }, 'Me')!;
}

const cp = (v: number): EngineScore => ({ kind: 'cp', value: v, perspective: 'white' });
const evals = (m: Record<number, number>, pv: Record<number, string[]> = {}): ValueAt => (ply) => (ply in m ? engineValue({ score: cp(m[ply]!), pv: pv[ply] }) : undefined);

describe('opening losses', () => {
  const g = game('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5', '0-1');

  it('lists your moves', () => {
    expect(yourPlies(g, 8)).toEqual([1, 3, 5, 7]);
    expect(yourPlies(game('1. e4 e5 2. Nf3 Nc6', '1-0', 'b'), 4)).toEqual([2, 4]);
  });

  it('finds the engine move that dropped your win chances most, with the best move', () => {
    const loss = openingLoss(g, 8, evals({ 0: 20, 1: 30, 2: 30, 3: 35, 4: 30, 5: 30, 6: 30, 7: -400 }, { 6: ['f3d4', 'g5g2'] }));
    expect(loss.worst?.san).toBe('Nxe5');
    expect(loss.worst?.best).toBe('f3d4');
    expect(loss.worst?.line).toEqual(['f3d4', 'g5g2']);
    expect(dropLabel(loss.worst!.drop)).toBe('blunder');
    expect(loss.end?.ply).toBe(7);
    expect(loss.known).toBe(4);
    expect(loss.wanted).toBe(4);
  });

  it('skips a move whose position before is not known', () => {
    const loss = openingLoss(g, 8, evals({ 0: 20, 1: 30, 5: 30, 7: -400 }));
    expect(loss.known).toBe(1);
    expect(loss.worst).toBeNull();
  });

  it('turns win chances back into an evaluation for the chart', () => {
    expect(engineValue({ score: scoreFromWin(0.7) }).win).toBeCloseTo(0.7, 2);
  });
});

describe('opening losses from the database', () => {
  const g = game('1. e4 e5 2. Qh5 Nc6', '1-0');
  const res = (white: number, draws: number, black: number, moves: { san: string; uci: string; white: number; draws: number; black: number }[] = []) => ({ white, draws, black, moves });
  // Position before 2. Qh5 (after 1... e5): Nf3 is main and scores well, Qh5 scores badly.
  const before2 = res(5000, 1000, 4000, [
    { san: 'Nf3', uci: 'g1f3', white: 3000, draws: 600, black: 2000 },
    { san: 'Qh5', uci: 'd1h5', white: 300, draws: 50, black: 650 },
  ]);
  const at = (m: Record<number, ReturnType<typeof res>>) => (p: number) => m[p];

  it('uses the position before and the move\'s own results', () => {
    const loss = openingLoss(g, 4, dbValueAt(g, 4, at({ 0: res(5000, 1000, 4000, [{ san: 'e4', uci: 'e2e4', white: 2600, draws: 500, black: 2000 }]), 2: before2 }), DEFAULT_RULE));
    expect(loss.worst?.san).toBe('Qh5');
    expect(loss.worst?.beforeWin).toBeCloseTo(0.55, 2);
    expect(loss.worst?.afterWin).toBeCloseTo(0.325, 3);
    expect(loss.worst?.after.games).toBe(1000);
    expect(loss.worst?.best).toBe('g1f3');
  });

  it('asks for the position before each of your moves, then after a rare one', () => {
    const rare = res(5000, 1000, 4000, [{ san: 'Nf3', uci: 'g1f3', white: 3000, draws: 600, black: 2000 }]);
    const known = (m: Record<number, unknown>) => (p: number) => p in m;
    expect(dbPliesNeeded(g, 4, at({}), known({}))).toEqual([0, 2]);
    expect(dbPliesNeeded(g, 4, at({ 0: before2, 2: rare }), known({ 0: 1, 2: 1 }))).toEqual([1, 3]);
    expect(MIN_DB_GAMES).toBeGreaterThan(0);
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
