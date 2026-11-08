import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GameRecord } from '../core/chess/types';
import type { PositionAnalysis } from '../core/engine/types';
import type { AnalysisCache } from '../features/analysis/cache';
import type { GameAnalysis } from '../features/analysis/types';

interface AnalyserDB extends DBSchema {
  games: { key: string; value: GameRecord; indexes: { importedAt: string } };
  positions: { key: string; value: PositionAnalysis };
  analyses: { key: string; value: GameAnalysis & { key: string } };
  settings: { key: string; value: unknown };
}

const DB_NAME = 'chess-analyser';
const DB_VERSION = 1;
const MAX_GAMES = 500;

let dbPromise: Promise<IDBPDatabase<AnalyserDB> | null> | null = null;

/** Opens IndexedDB; resolves to null when unavailable (private mode, blocked storage). */
export function getDb(): Promise<IDBPDatabase<AnalyserDB> | null> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') return (dbPromise = Promise.resolve(null));
    dbPromise = openDB<AnalyserDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const games = db.createObjectStore('games', { keyPath: 'id' });
        games.createIndex('importedAt', 'importedAt');
        db.createObjectStore('positions');
        db.createObjectStore('analyses', { keyPath: 'key' });
        db.createObjectStore('settings');
      },
    }).catch(() => null);
  }
  return dbPromise;
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
