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
