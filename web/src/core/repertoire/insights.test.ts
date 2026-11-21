import { describe, expect, it } from 'vitest';
import { parseSingleGame } from '../chess/pgn';
import { toOpeningGame, type OpeningGame } from './games';
import { buildGamesTree, decisionPoints, improvementsAt, moveLabel, nodeId, orderLine, shrunkScore, walkGame, weakSpots, type DbPosition } from './insights';
import { posKey } from './posKey';
import { parseFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';

function game(id: string, moves: string, result: string, white = 'Me', black = 'Opp'): OpeningGame {
  const rec = parseSingleGame(`[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n[UTCDate "2026.11.01"]\n\n${moves} ${result}`, {
    source: 'lichess',
    sourceUrl: `https://lichess.org/${id}`,
  });
  return toOpeningGame({ ...rec, id }, 'Me')!;
}

const keyOf = (fen: string) => posKey(Chess.fromSetup(parseFen(fen).unwrap()).unwrap());

describe('positions from your games', () => {
  // As White: 4 games with 2. Nf3 (2 wins, 2 losses... ) and transpositions into the same position.
  const games = [
    game('a', '1. e4 e5 2. Nf3 Nc6 3. Bc4', '1-0'),
    game('b', '1. e4 e5 2. Nf3 Nc6 3. Bb5', '1-0'),
    game('c', '1. Nf3 Nc6 2. e4 e5 3. Bc4', '0-1'),
    game('d', '1. e4 e5 2. Nf3 Nc6 3. Bc4', '0-1'),
    game('e', '1. e4 e5 2. Nf3 Nc6 3. Bc4', '0-1'),
    game('f', '1. d4 d5', '1/2-1/2'),
    game('g', '1. e4 e5', '1-0', 'Opp', 'Me'),
    game('u', '1. e4', '*'),
  ];
  const tree = buildGamesTree(games, 10);

  it('counts finished games per colour and keeps colours apart', () => {
    expect(tree.totals).toEqual({ w: 6, b: 1 });
    const start = [...tree.nodes.values()].filter((n) => n.ply === 0);
    expect(start.map((n) => n.colour).sort()).toEqual(['b', 'w']);
  });

  it('groups move orders that reach the same position', () => {
    const after = tree.nodes.get(nodeId('w', keyOf('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')))!;
    expect(after.outcome).toMatchObject({ games: 5, wins: 2, losses: 3 });
    expect(after.orders.map((o) => [orderLine(o.sans), o.gameIds.length])).toEqual([
      ['1. e4 e5 2. Nf3 Nc6', 4],
      ['1. Nf3 Nc6 2. e4 e5', 1],
    ]);
    expect(after.toMove).toBe('you');
    expect(after.next.map((m) => [m.san, m.outcome.games, m.outcome.points])).toEqual([
      ['Bc4', 4, 1],
      ['Bb5', 1, 1],
    ]);
  });

  it('compares each position with one move earlier', () => {
    const bc4 = tree.nodes.get(tree.nodes.get(nodeId('w', keyOf('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')))!.next[0]!.childId)!;
    expect(bc4.before).toBeCloseTo(2 / 5);
    expect(bc4.outcome.points / bc4.outcome.games).toBeCloseTo(1 / 4);
    const spots = weakSpots(tree, { minGames: 3 });
    const spot = spots.find((s) => s.node.id === bc4.id)!;
    expect(spot.movedBy).toBe('you');
    expect(spot.reached).toBeCloseTo(4 / 6);
    expect(spot.lost).toBeCloseTo(3 / 4);
    expect(spot.shrunk).toBeCloseTo(shrunkScore(bc4.outcome, 0.4));
    expect(spot.pointsLost).toBeCloseTo(4 * (0.4 - (1 + 5 * 0.4) / 9));
    expect(spots.every((s, i) => i === 0 || spots[i - 1]!.pointsLost >= s.pointsLost)).toBe(true);
  });

  it('suggests a better move from the database', () => {
    const at = tree.nodes.get(nodeId('w', keyOf('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')))!;
    expect(decisionPoints(tree, { minGames: 3 })).toContain(at);
    const db: DbPosition = {
      white: 520,
      draws: 200,
      black: 480,
      moves: [
        { uci: 'f1c4', san: 'Bc4', white: 200, draws: 100, black: 300 },
        { uci: 'f1b5', san: 'Bb5', white: 300, draws: 100, black: 100 },
        { uci: 'd2d4', san: 'd4', white: 20, draws: 0, black: 0 },
      ],
    };
    const imp = improvementsAt(tree, at, db);
    expect(imp).toHaveLength(1);
    expect(imp[0]).toMatchObject({ basis: 'database', better: { san: 'Bb5' }, yours: { san: 'Bc4' } });
    expect(imp[0]!.gain).toBeCloseTo(0.7 - 250 / 600);
    expect(imp[0]!.pointsToGain).toBeCloseTo(4 * imp[0]!.gain);
    expect(imp[0]!.lost).toBeCloseTo(3 / 4);
  });

  it('labels moves', () => {
    expect(moveLabel(7, 'Nf3')).toBe('4. Nf3');
    expect(moveLabel(6, 'Bf5')).toBe('3… Bf5');
  });

  const at = () => tree.nodes.get(nodeId('w', keyOf('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')))!;

  it('links a position to the ones one move earlier', () => {
    const n = at();
    expect(n.parents.map((id) => tree.nodes.get(id)!.orders[0]!.sans.join(' '))).toEqual(['e4 e5 Nf3', 'Nf3 Nc6 e4']);
  });

  it('does not suggest a rare move with a lucky score', () => {
    const db: DbPosition = {
      white: 5000,
      draws: 2000,
      black: 5000,
      moves: [
        { uci: 'f1c4', san: 'Bc4', white: 5000, draws: 2000, black: 4700 },
        { uci: 'a2a3', san: 'a3', white: 250, draws: 0, black: 50 },
      ],
    };
    expect(improvementsAt(tree, at(), db)).toEqual([]);
  });

  it('compares a move rare in the database with your own results', () => {
    const db: DbPosition = {
      white: 6000,
      draws: 2000,
      black: 4000,
      moves: [
        { uci: 'f1b5', san: 'Bb5', white: 6000, draws: 2000, black: 4000 },
        { uci: 'f1c4', san: 'Bc4', white: 10, draws: 0, black: 10 },
      ],
    };
    const imp = improvementsAt(tree, at(), db).find((i) => i.yours.san === 'Bc4')!;
    expect(imp.basis).toBe('yours');
    const prior = (6000 + 1000) / 12000;
    expect(imp.gain).toBeCloseTo(prior - (1 + 5 * prior) / 9);
  });

  it('walks a game only as far as asked, and further when asked again', () => {
    const g = game('w', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5', '1-0');
    expect(walkGame(g, 2).keys).toHaveLength(3);
    expect(walkGame(g, 4).keys).toHaveLength(5);
    expect(walkGame(g, 2).keys).toHaveLength(5);
    expect(walkGame(g).fens[6]).toBe('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  });
});
