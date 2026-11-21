import { describe, expect, it } from 'vitest';
import { parseSingleGame } from '../chess/pgn';
import { discoverRepertoire } from './discover';
import { compareGame, sanLine, summariseGames, toOpeningGame, userScore, type OpeningGame } from './games';
import { parseRepertoirePgn } from './parse';
import { buildTrainGraph } from './trainer';
import type { Chapter } from './types';

/** White repertoire: 1. e4 e5 2. Nf3 Nc6 3. Bb5, and 1... c5 2. Nf3; Black: 1. d4 d5. */
const REP = `[Event "Ruy"]
[Orientation "white"]

1. e4 e5 ( 1... c5 2. Nf3 ) 2. Nf3 Nc6 3. Bb5 *

[Event "QGD"]
[Orientation "black"]

1. d4 d5 2. c4 e6 *`;

const chapters: Chapter[] = parseRepertoirePgn(REP).chapters.map((p, i) => ({
  id: `c${i}`,
  repertoireId: 'r',
  title: p.title ?? '',
  side: p.orientation ?? 'w',
  source: { kind: 'pgn-paste' },
  importedAt: '',
  headers: p.headers,
  startFen: p.startFen,
  root: p.root,
  order: i,
}));
const graphs = { w: buildTrainGraph(chapters, 'w'), b: buildTrainGraph(chapters, 'b') };

function game(id: string, white: string, black: string, moves: string, result = '1-0'): OpeningGame {
  const rec = parseSingleGame(`[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n[UTCDate "2026.11.01"]\n[UTCTime "10:00:00"]\n\n${moves} ${result}`, {
    source: 'lichess',
    sourceUrl: `https://lichess.org/${id}`,
  });
  return toOpeningGame({ ...rec, id }, 'Me')!;
}

describe('games against the repertoire', () => {
  it('trims games and finds the user', () => {
    const g = game('g1', 'me', 'Opp', '1. e4 e5 2. Nf3');
    expect(g).toMatchObject({ id: 'g1', userColour: 'w', result: '1-0', playedAt: '2026-11-01T10:00:00.000Z' });
    expect(g.moves.map((m) => m.uci)).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(userScore(g)).toBe(1);
    const rated = toOpeningGame(parseSingleGame('[White "Opp"]\n[Black "me"]\n[WhiteElo "1810"]\n[BlackElo "1750"]\n[Result "0-1"]\n\n1. e4 e5 0-1', { source: 'lichess' }), 'Me')!;
    expect(rated).toMatchObject({ userColour: 'b', userRating: 1750, opponentRating: 1810 });
    expect(rated.pgn).toContain('1. e4 e5');
    expect(userScore({ ...g, userColour: 'b' })).toBe(0);
    const rec = parseSingleGame('[White "a"]\n[Black "b"]\n\n1. e4 *', { source: 'lichess' });
    expect(toOpeningGame(rec, 'me')).toBeNull();
  });

  it('finds who left the repertoire', () => {
    const yours = compareGame(graphs, game('g1', 'Me', 'X', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5'));
    expect(yours).toMatchObject({ kind: 'you', ply: 4, inBook: 4, played: { san: 'Bc4' }, expected: ['Bb5'], chapters: ['c0'] });
    const theirs = compareGame(graphs, game('g2', 'Me', 'X', '1. e4 e6 2. d4'));
    expect(theirs).toMatchObject({ kind: 'opponent', ply: 1, played: { san: 'e6' } });
    expect(theirs.expected?.sort()).toEqual(['c5', 'e5']);
    expect(compareGame(graphs, game('g3', 'Me', 'X', '1. e4 c5 2. Nf3 d6 3. d4'))).toMatchObject({ kind: 'followed', inBook: 3 });
    // As Black after 1. e4: the Black repertoire only has 1. d4.
    expect(compareGame(graphs, game('g4', 'X', 'Me', '1. e4 e5'))).toMatchObject({ kind: 'opponent', ply: 0 });
    // Transposition: 1. d4 e6 2. c4 d5 reaches the QGD position.
    expect(compareGame(graphs, game('g5', 'X', 'Me', '1. d4 d5 2. c4 e6 3. Nc3', '0-1'))).toMatchObject({ kind: 'followed', inBook: 4 });
  });

  it('groups deviations and results per chapter', () => {
    const games = [
      game('a', 'Me', 'X', '1. e4 e5 2. Nf3 Nc6 3. Bc4'),
      game('b', 'Me', 'Y', '1. e4 e5 2. Nf3 Nc6 3. Bc4', '0-1'),
      game('c', 'Me', 'Z', '1. e4 e6'),
      game('d', 'X', 'Me', '1. d4 d5 2. c4 e6', '1/2-1/2'),
    ];
    const s = summariseGames(graphs, games);
    expect(s).toMatchObject({ checked: 4, inRepertoire: 4, followed: 1 });
    expect(s.you).toHaveLength(1);
    expect(s.you[0]).toMatchObject({ line: '1. e4 e5 2. Nf3 Nc6 3. Bc4', expected: ['Bb5'] });
    expect(s.you[0]!.games.map((g) => g.id)).toEqual(['a', 'b']);
    expect(s.opponent[0]!.played.san).toBe('e6');
    // Game c left at 1... e6: too early to count in the Ruy chapter's results.
    expect(s.chapters.find((c) => c.chapterId === 'c0')).toMatchObject({ games: 2, wins: 1, losses: 1 });
    expect(s.chapters.find((c) => c.chapterId === 'c1')).toMatchObject({ games: 1, draws: 1 });
    expect(sanLine(games[0]!.moves, 3)).toBe('1. e4 e5 2. Nf3');
  });
});

describe('discovery', () => {
  it('builds a repertoire from the moves you play most', () => {
    const games = [
      game('1', 'Me', 'A', '1. e4 e5 2. Nf3 Nc6 3. Bb5'),
      game('2', 'Me', 'B', '1. e4 e5 2. Nf3 Nc6 3. Bc4', '0-1'),
      game('3', 'Me', 'C', '1. e4 c5 2. Nf3 d6'),
      game('4', 'Me', 'D', '1. e4 c5 2. Nc3'),
      game('5', 'Me', 'E', '1. d4 d5'),
      game('6', 'X', 'Me', '1. e4 c5'),
    ];
    const d = discoverRepertoire(games, { side: 'w', comment: (n) => `${n} games`, title: 'Mine' })!;
    expect(d.games).toBe(5);
    // 1. e4 (4 games); after 1... e5, 2. Nf3 (2 games); after 1... c5, Nf3 and Nc3 once each: below the minimum.
    const parsed = parseRepertoirePgn(d.pgn).chapters[0]!;
    expect(parsed.orientation).toBe('w');
    expect(parsed.root.children.map((c) => c.san)).toEqual(['e4']);
    const e4 = parsed.root.children[0]!;
    expect(e4.comments).toEqual(['4 games']);
    expect(e4.children.map((c) => c.san).sort()).toEqual(['c5', 'e5']);
    const e5 = e4.children.find((c) => c.san === 'e5')!;
    expect(e5.children.map((c) => c.san)).toEqual(['Nf3']);
    expect(e4.children.find((c) => c.san === 'c5')!.children).toEqual([]);
    expect(d.positions).toBe(2); // 1. e4 and 2. Nf3; after 2... Nc6, Bb5 and Bc4 were played once each
  });

  it('returns null without enough games', () => {
    expect(discoverRepertoire([game('1', 'Me', 'A', '1. e4')], { side: 'w', comment: () => '', title: 'x' })).toBeNull();
  });
});

describe('openings in your games', () => {
  it('groups games by the opening they reached', async () => {
    const { loadOpenings, openingOf, family } = await import('../openings/names');
    const t = await loadOpenings();
    const games = [
      game('1', 'Me', 'A', '1. e4 c6 2. d4 d5 3. e5 Bf5'),
      game('2', 'Me', 'B', '1. e4 c6 2. d4 d5 3. e5 c5', '0-1'),
      game('3', 'X', 'Me', '1. d4 d5 2. c4 e6 3. Nc3', '1/2-1/2'),
    ];
    const rows = (await import('./games')).openingResults(games, (keys) => {
      const o = openingOf(t, keys);
      return o ? { eco: o.eco, name: family(o.name) } : null;
    });
    expect(rows[0]).toMatchObject({ name: 'Caro-Kann Defense', side: 'w', games: 2, wins: 1, losses: 1 });
    expect(rows[1]).toMatchObject({ name: "Queen's Gambit Declined", side: 'b', games: 1, draws: 1 });
  });
});
