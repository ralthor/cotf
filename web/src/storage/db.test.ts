import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseRepertoirePgn } from '../core/repertoire/parse';
import { posKeyFromFen } from '../core/repertoire/posKey';
import type { Chapter } from '../core/repertoire/types';
import { ANNOTATED, TRANSPOSITION } from '../test/fixtures/repertoire';
import { closeDbForTests, DB_NAME, gameStore, repertoireStore } from './db';

const now = '2026-11-20T00:00:00Z';

function chapters(pgn: string, repertoireId: string): Chapter[] {
  return parseRepertoirePgn(pgn).chapters.map((p, i) => ({
    id: `${repertoireId}-c${i}`,
    repertoireId,
    title: p.title ?? 'x',
    side: p.orientation ?? 'w',
    source: { kind: 'pgn-paste' },
    importedAt: now,
    headers: p.headers,
    startFen: p.startFen,
    root: p.root,
    order: i,
  }));
}

beforeEach(async () => {
  await closeDbForTests();
  indexedDB.deleteDatabase(DB_NAME);
});

describe('IndexedDB upgrade', () => {
  it('keeps games from a version 1 database', async () => {
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('games', { keyPath: 'id' }).createIndex('importedAt', 'importedAt');
        db.createObjectStore('positions');
        db.createObjectStore('analyses', { keyPath: 'key' });
        db.createObjectStore('settings');
      },
    });
    await v1.put('games', { id: 'g1', importedAt: now });
    v1.close();

    const games = await gameStore.list();
    expect(games.map((g) => g.id)).toEqual(['g1']);
    expect(await repertoireStore.list()).toEqual([]);
  });
});

describe('repertoireStore', () => {
  it('saves chapters, derives moves, and deletes only its own data', async () => {
    await repertoireStore.put({ id: 'r1', name: 'Italian', createdAt: now, updatedAt: now });
    await repertoireStore.put({ id: 'r2', name: 'QGD', createdAt: '2026-11-21T00:00:00Z', updatedAt: now });
    await repertoireStore.saveChapters('r1', chapters(ANNOTATED, 'r1'));
    await repertoireStore.saveChapters('r2', chapters(TRANSPOSITION, 'r2'));

    expect((await repertoireStore.list()).map((r) => r.name)).toEqual(['Italian', 'QGD']);
    const start = posKeyFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')!;
    expect((await repertoireStore.movesFrom('r1', 'w', start)).map((m) => m.san)).toEqual(['e4']);
    expect((await repertoireStore.movesFrom('r2', 'b', start)).map((m) => m.san).sort()).toEqual(['c4', 'd4']);

    // Replacing the chapters rebuilds the moves.
    await repertoireStore.saveChapters('r1', chapters('1. d4 *', 'r1'));
    expect((await repertoireStore.movesFrom('r1', 'w', start)).map((m) => m.san)).toEqual(['d4']);
    expect(await repertoireStore.moves('r1')).toHaveLength(1);

    await repertoireStore.remove('r1');
    expect((await repertoireStore.list()).map((r) => r.id)).toEqual(['r2']);
    expect(await repertoireStore.chapters('r1')).toEqual([]);
    expect(await repertoireStore.moves('r1')).toEqual([]);
    expect(await repertoireStore.chapters('r2')).toHaveLength(2);
  });
});

describe('trainStore', () => {
  it('saves cards with their answers and deletes them with the repertoire', async () => {
    const { trainStore } = await import('./db');
    const { review } = await import('../core/repertoire/srs');
    await repertoireStore.put({ id: 'r1', name: 'Italian', createdAt: now, updatedAt: now });
    const srs = await review(undefined, 'good', new Date(now));
    const entry = { repertoireId: 'r1', side: 'w' as const, posKey: 'k', at: now, mode: 'learn' as const, result: 'good' as const, wrong: [], expected: ['e4'], ms: 900 };
    await trainStore.answer({ repertoireId: 'r1', side: 'w', posKey: 'k', srs }, entry);
    await trainStore.answer(null, { ...entry, result: 'wrong', wrong: ['d4'] });

    const cards = await trainStore.cards('r1', 'w');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.srs.dueAt).toBeInstanceOf(Date);
    expect(await trainStore.cards('r1', 'b')).toEqual([]);
    expect((await trainStore.log('r1')).map((e) => e.result)).toEqual(['good', 'wrong']);

    await repertoireStore.remove('r1');
    expect(await trainStore.cards('r1', 'w')).toEqual([]);
    expect(await trainStore.log('r1')).toEqual([]);
  });
});

describe('backupStore', () => {
  it('restores repertoires, rebuilds moves and merges the log without duplicates', async () => {
    const { backupStore, trainStore } = await import('./db');
    const { makeBackup, parseBackup } = await import('../core/repertoire/backup');
    const { review } = await import('../core/repertoire/srs');
    await repertoireStore.put({ id: 'r1', name: 'Italian', createdAt: now, updatedAt: now });
    await repertoireStore.saveChapters('r1', chapters(ANNOTATED, 'r1'));
    const srs = await review(undefined, 'good', new Date(now));
    const entry = { repertoireId: 'r1', side: 'w' as const, posKey: 'k', at: now, mode: 'learn' as const, result: 'good' as const, wrong: [], expected: ['e4'], ms: 900 };
    await trainStore.answer({ repertoireId: 'r1', side: 'w', posKey: 'k', srs }, entry);
    const backup = parseBackup(makeBackup(await backupStore.read()));

    // Change things after the backup, then restore.
    await repertoireStore.saveChapters('r1', chapters('1. d4 *', 'r1'));
    await repertoireStore.put({ id: 'r2', name: 'Other', createdAt: now, updatedAt: now });
    await backupStore.restore(backup);
    await backupStore.restore(backup);

    expect((await repertoireStore.list()).map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(await repertoireStore.chapters('r1')).toHaveLength(1);
    const start = posKeyFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')!;
    expect((await repertoireStore.movesFrom('r1', 'w', start)).map((m) => m.san)).toEqual(['e4']);
    expect((await trainStore.cards('r1', 'w'))[0]!.srs.dueAt).toBeInstanceOf(Date);
    expect(await trainStore.log('r1')).toHaveLength(1);
  });
});

describe('openingGameStore and game mistakes', () => {
  it('keeps the newest games and logs each game mistake once', async () => {
    const { openingGameStore, trainStore, MAX_OPENING_GAMES } = await import('./db');
    const game = (i: number) => ({
      id: `g${i}`,
      source: 'lichess' as const,
      white: 'me',
      black: 'x',
      userColour: 'w' as const,
      result: '1-0' as const,
      playedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      moves: [],
    });
    await openingGameStore.putMany(Array.from({ length: MAX_OPENING_GAMES + 3 }, (_, i) => game(i)));
    const list = await openingGameStore.list();
    expect(list).toHaveLength(MAX_OPENING_GAMES);
    expect(list[0]!.id).toBe(`g${MAX_OPENING_GAMES + 2}`);
    expect(list.some((g) => g.id === 'g0')).toBe(false);

    const entry = { repertoireId: 'r1', side: 'w' as const, posKey: 'k', at: now, mode: 'game' as const, result: 'wrong' as const, wrong: ['Bc4'], expected: ['Bb5'], ms: 0, gameId: 'g5' };
    expect(await trainStore.addGameMistakes([entry, { ...entry, gameId: 'g6' }])).toBe(2);
    expect(await trainStore.addGameMistakes([entry])).toBe(0);
    expect(await trainStore.log('r1')).toHaveLength(2);
  });
});
