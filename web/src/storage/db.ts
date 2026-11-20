import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GameRecord } from '../core/chess/types';
import type { PositionAnalysis } from '../core/engine/types';
import type { AnalysisCache } from '../features/analysis/cache';
import type { GameAnalysis } from '../features/analysis/types';
import type { Chapter, PosKey, RepMove, Repertoire, Side, TrainCard, TrainLogEntry } from '../core/repertoire/types';
import { buildMoves } from '../core/repertoire/graph';

interface AnalyserDB extends DBSchema {
  games: { key: string; value: GameRecord; indexes: { importedAt: string } };
  positions: { key: string; value: PositionAnalysis };
  analyses: { key: string; value: GameAnalysis & { key: string } };
  settings: { key: string; value: unknown };
  // Version 2: opening repertoires.
  repertoires: { key: string; value: Repertoire };
  chapters: { key: string; value: Chapter; indexes: { repertoireId: string } };
  repMoves: {
    key: [string, Side, PosKey, string];
    value: RepMove;
    indexes: { repertoireId: string; from: [string, Side, PosKey] };
  };
  // Version 3: training.
  trainCards: { key: [string, Side, PosKey]; value: TrainCard; indexes: { repertoireId: string } };
  trainLog: { key: number; value: TrainLogEntry; indexes: { repertoireId: string } };
}

export const DB_NAME = 'chess-analyser';
const DB_VERSION = 3;
const MAX_GAMES = 500;

let dbPromise: Promise<IDBPDatabase<AnalyserDB> | null> | null = null;

/** Opens IndexedDB; resolves to null when unavailable (private mode, blocked storage). */
export function getDb(): Promise<IDBPDatabase<AnalyserDB> | null> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') return (dbPromise = Promise.resolve(null));
    dbPromise = openDB<AnalyserDB>(DB_NAME, DB_VERSION, {
      // Each version only adds stores, so data from earlier versions is kept.
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const games = db.createObjectStore('games', { keyPath: 'id' });
          games.createIndex('importedAt', 'importedAt');
          db.createObjectStore('positions');
          db.createObjectStore('analyses', { keyPath: 'key' });
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          db.createObjectStore('repertoires', { keyPath: 'id' });
          db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('repertoireId', 'repertoireId');
          const moves = db.createObjectStore('repMoves', { keyPath: ['repertoireId', 'side', 'from', 'uci'] });
          moves.createIndex('repertoireId', 'repertoireId');
          moves.createIndex('from', ['repertoireId', 'side', 'from']);
        }
        if (oldVersion < 3) {
          db.createObjectStore('trainCards', { keyPath: ['repertoireId', 'side', 'posKey'] }).createIndex('repertoireId', 'repertoireId');
          db.createObjectStore('trainLog', { keyPath: 'id', autoIncrement: true }).createIndex('repertoireId', 'repertoireId');
        }
      },
    }).catch(() => null);
  }
  return dbPromise;
}

/** Tests only: forget the open connection so the next getDb() opens (and upgrades) again. */
export async function closeDbForTests(): Promise<void> {
  const db = await dbPromise;
  db?.close();
  dbPromise = null;
}

export function analysisKey(gameId: string, presetId: string, policyVersion: string): string {
  return `${gameId}|${presetId}|${policyVersion}`;
}

export const gameStore = {
  async put(game: GameRecord): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.put('games', game);
    const count = await db.count('games');
    if (count > MAX_GAMES) {
      // Evict the oldest imports to cap storage.
      const tx = db.transaction('games', 'readwrite');
      let cursor = await tx.store.index('importedAt').openCursor();
      let toDelete = count - MAX_GAMES;
      while (cursor && toDelete-- > 0) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    }
  },
  async list(): Promise<GameRecord[]> {
    const db = await getDb();
    if (!db) return [];
    const all = await db.getAllFromIndex('games', 'importedAt');
    return all.reverse();
  },
  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db?.delete('games', id);
  },
};

export const analysisStore = {
  async get(key: string): Promise<GameAnalysis | undefined> {
    const db = await getDb();
    return db ? db.get('analyses', key) : undefined;
  },
  async put(key: string, value: GameAnalysis): Promise<void> {
    const db = await getDb();
    await db?.put('analyses', { ...value, key });
  },
};

export const settingsStore = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const db = await getDb();
    const v = db ? await db.get('settings', key) : undefined;
    return (v as T | undefined) ?? fallback;
  },
  async set(key: string, value: unknown): Promise<void> {
    const db = await getDb();
    await db?.put('settings', value, key);
  },
};

/** Engine-result cache in IndexedDB, with an in-memory layer in front. */
export class IdbAnalysisCache implements AnalysisCache {
  private memory = new Map<string, PositionAnalysis>();
  async get(key: string) {
    const m = this.memory.get(key);
    if (m) return m;
    const db = await getDb();
    const v = db ? await db.get('positions', key) : undefined;
    if (v) this.memory.set(key, v);
    return v;
  }
  async set(key: string, value: PositionAnalysis) {
    this.memory.set(key, value);
    const db = await getDb();
    await db?.put('positions', value, key).catch(() => undefined);
  }
}

/** Opening repertoires, their chapters, and the move graph derived from the chapters. */
export const repertoireStore = {
  async list(): Promise<Repertoire[]> {
    const db = await getDb();
    if (!db) return [];
    const all = await db.getAll('repertoires');
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async put(rep: Repertoire): Promise<void> {
    const db = await getDb();
    await db?.put('repertoires', rep);
  },
  /** Deletes a repertoire with its chapters, moves and training data. */
  async remove(id: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const tx = db.transaction(['repertoires', 'chapters', 'repMoves', 'trainCards', 'trainLog'], 'readwrite');
    await tx.objectStore('repertoires').delete(id);
    for (const store of ['chapters', 'repMoves', 'trainCards', 'trainLog'] as const) {
      let cursor = await tx.objectStore(store).index('repertoireId').openCursor(id);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    await tx.done;
  },
  async chapters(repertoireId: string): Promise<Chapter[]> {
    const db = await getDb();
    if (!db) return [];
    const all = await db.getAllFromIndex('chapters', 'repertoireId', repertoireId);
    return all.sort((a, b) => a.order - b.order);
  },
  /**
   * Replaces the repertoire's chapters with `chapters` (adding, updating and deleting) and
   * rebuilds its move graph, in one transaction.
   */
  async saveChapters(repertoireId: string, chapters: readonly Chapter[]): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const tx = db.transaction(['repertoires', 'chapters', 'repMoves'], 'readwrite');
    const chapterStore = tx.objectStore('chapters');
    const keep = new Set(chapters.map((c) => c.id));
    let cursor = await chapterStore.index('repertoireId').openCursor(repertoireId);
    while (cursor) {
      if (!keep.has(cursor.value.id)) await cursor.delete();
      cursor = await cursor.continue();
    }
    for (const c of chapters) await chapterStore.put(c);
    const moveStore = tx.objectStore('repMoves');
    let mc = await moveStore.index('repertoireId').openCursor(repertoireId);
    while (mc) {
      await mc.delete();
      mc = await mc.continue();
    }
    for (const m of buildMoves(repertoireId, chapters)) await moveStore.put(m);
    const rep = await tx.objectStore('repertoires').get(repertoireId);
    if (rep) await tx.objectStore('repertoires').put({ ...rep, updatedAt: new Date().toISOString() });
    await tx.done;
  },
  async movesFrom(repertoireId: string, side: Side, from: PosKey): Promise<RepMove[]> {
    const db = await getDb();
    return db ? db.getAllFromIndex('repMoves', 'from', [repertoireId, side, from]) : [];
  },
  async moves(repertoireId: string): Promise<RepMove[]> {
    const db = await getDb();
    return db ? db.getAllFromIndex('repMoves', 'repertoireId', repertoireId) : [];
  },
};

export const trainStore = {
  async cards(repertoireId: string, side: Side): Promise<TrainCard[]> {
    const db = await getDb();
    if (!db) return [];
    return (await db.getAllFromIndex('trainCards', 'repertoireId', repertoireId)).filter((c) => c.side === side);
  },
  /** Saves a card's new state and the answer that led to it, together. */
  async answer(card: TrainCard | null, entry: TrainLogEntry): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const tx = db.transaction(['trainCards', 'trainLog'], 'readwrite');
    if (card) await tx.objectStore('trainCards').put(card);
    await tx.objectStore('trainLog').add(entry);
    await tx.done;
  },
  async log(repertoireId: string): Promise<TrainLogEntry[]> {
    const db = await getDb();
    return db ? db.getAllFromIndex('trainLog', 'repertoireId', repertoireId) : [];
  },
};
