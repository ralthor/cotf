import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GameRecord } from '../core/chess/types';
import type { PositionAnalysis } from '../core/engine/types';
import type { AnalysisCache } from '../features/analysis/cache';
import type { GameAnalysis } from '../features/analysis/types';
import type { Chapter, PosKey, RepMove, Repertoire, Side, TrainCard, TrainLogEntry } from '../core/repertoire/types';
import { buildMoves } from '../core/repertoire/graph';
import { logKey, type BackupData } from '../core/repertoire/backup';
import type { OpeningGame } from '../core/repertoire/games';
import type { MoveGrade } from '../features/explore/grade';
import type { ExplorerResult } from '../features/repertoire/explorer';
import type { EngineScore } from '../core/engine/types';

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
  // Version 4: your games against your repertoire.
  openingGames: { key: string; value: OpeningGame; indexes: { playedAt: string } };
  moveGrades: { key: string; value: MoveGrade };
  /** Opening explorer answers by request URL, with when they were fetched. */
  explorer: { key: string; value: { result: ExplorerResult; at: string } };
  // Version 7: evaluations by this browser's engine, by `positionKey|depth` (version 6's Lichess cloud evaluations are dropped).
  engineEvals: { key: string; value: EngineEval };
}

export const DB_NAME = 'chess-analyser';
const DB_VERSION = 7;

/** One engine evaluation of a position: the score (White's view), its depth and the engine's line. */
export type EngineEval = { score: EngineScore; depth: number; pv: string[] };
/** Games kept for the repertoire comparison; the oldest are dropped. */
export const MAX_OPENING_GAMES = 2000;
const MAX_GAMES = 500;

let dbPromise: Promise<IDBPDatabase<AnalyserDB> | null> | null = null;

/** Opens IndexedDB; resolves to null when unavailable (private mode, blocked storage). */
export function getDb(): Promise<IDBPDatabase<AnalyserDB> | null> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') return (dbPromise = Promise.resolve(null));
    // Opening normally takes milliseconds; a long wait means another tab holds an older version
    // (browsers do not always send "blocked", e.g. to a page in a background tab).
    const slow = setTimeout(() => {
      dbBlocked = true;
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(DB_BLOCKED_EVENT));
    }, BLOCKED_AFTER_MS);
    dbPromise = openDB<AnalyserDB>(DB_NAME, DB_VERSION, {
      // Each version adds stores (version 7 also drops version 6's cloudEvals), so other data is kept.
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
        if (oldVersion < 4) {
          db.createObjectStore('openingGames', { keyPath: 'id' }).createIndex('playedAt', 'playedAt');
          db.createObjectStore('moveGrades');
        }
        if (oldVersion < 5) {
          db.createObjectStore('explorer');
        }
        if (oldVersion >= 6 && oldVersion < 7) {
          (db as unknown as IDBPDatabase).deleteObjectStore('cloudEvals');
        }
        if (oldVersion < 7) {
          db.createObjectStore('engineEvals');
        }
      },
      // An older copy of the app (another tab) keeps the old version open: say so, the upgrade waits.
      blocked() {
        dbBlocked = true;
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(DB_BLOCKED_EVENT));
      },
      // A newer copy of the app wants to upgrade: let it, and load the new copy here too.
      blocking(_current, _next, event) {
        (event.target as IDBDatabase).close();
        dbPromise = null;
        if (typeof location !== 'undefined') location.reload();
      },
    })
      .then((db) => {
        clearTimeout(slow);
        // The other tab closed: the upgrade went through.
        if (dbBlocked) {
          dbBlocked = false;
          window.dispatchEvent(new Event(DB_BLOCKED_EVENT));
        }
        return db;
      })
      .catch((e: unknown) => {
        clearTimeout(slow);
        // The stored version is newer than this copy of the app (a newer copy ran here before).
        // Versions only add stores, so open it as it is rather than losing access to the data.
        if ((e as Error)?.name !== 'VersionError') return null;
        return openDB<AnalyserDB>(DB_NAME, undefined, {
          blocking(_current, _next, event) {
            (event.target as IDBDatabase).close();
            dbPromise = null;
            if (typeof location !== 'undefined') location.reload();
          },
        }).catch(() => null);
      });
  }
  return dbPromise;
}

/** Sent when the database upgrade waits for another tab of the app to close. */
export const DB_BLOCKED_EVENT = 'chess-analyser:db-blocked';
let dbBlocked = false;
const BLOCKED_AFTER_MS = 3000;
/** Whether the upgrade waited for another tab (it can happen before the page is drawn). */
export const isDbBlocked = () => dbBlocked;

// Development: a hot update loads this module again; close the old connection so an upgrade is not blocked by this very page.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void dbPromise?.then((db) => db?.close());
    dbPromise = null;
  });
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
  /** Training cards in all repertoires. */
  async count(): Promise<number> {
    const db = await getDb();
    return db ? db.count('trainCards') : 0;
  },
  /**
   * Logs mistakes found in games (mode `game`), skipping games already logged for the same
   * repertoire, side and position. Returns how many were added.
   */
  async addGameMistakes(entries: readonly TrainLogEntry[]): Promise<number> {
    const db = await getDb();
    if (!db || !entries.length) return 0;
    const tx = db.transaction('trainLog', 'readwrite');
    const seen = new Set<string>();
    for (const id of new Set(entries.map((e) => e.repertoireId))) {
      for (const e of await tx.store.index('repertoireId').getAll(id)) if (e.gameId) seen.add(`${e.repertoireId}|${e.side}|${e.posKey}|${e.gameId}`);
    }
    let added = 0;
    for (const e of entries) {
      const k = `${e.repertoireId}|${e.side}|${e.posKey}|${e.gameId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      await tx.store.add(e);
      added++;
    }
    await tx.done;
    return added;
  },
  async log(repertoireId: string): Promise<TrainLogEntry[]> {
    const db = await getDb();
    return db ? db.getAllFromIndex('trainLog', 'repertoireId', repertoireId) : [];
  },
};

export const backupStore = {
  /** Every repertoire with its chapters, training cards and answers. */
  async read(): Promise<BackupData> {
    const db = await getDb();
    if (!db) return { repertoires: [], chapters: [], trainCards: [], trainLog: [] };
    const [repertoires, chapters, trainCards, trainLog] = await Promise.all([
      db.getAll('repertoires'),
      db.getAll('chapters'),
      db.getAll('trainCards'),
      db.getAll('trainLog'),
    ]);
    return { repertoires, chapters, trainCards, trainLog: trainLog.map(({ id: _id, ...e }) => e) };
  },
  /**
   * Restores a backup in one transaction: repertoires in it replace those with the same id (chapters
   * and move graph included), cards in it replace the browser's, answers not yet logged are added.
   */
  async restore(data: BackupData): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error('Storage is not available in this browser.');
    const tx = db.transaction(['repertoires', 'chapters', 'repMoves', 'trainCards', 'trainLog'], 'readwrite');
    const ids = new Set(data.repertoires.map((r) => r.id));
    for (const store of ['chapters', 'repMoves'] as const) {
      for (const id of ids) {
        let cursor = await tx.objectStore(store).index('repertoireId').openCursor(id);
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
      }
    }
    for (const r of data.repertoires) await tx.objectStore('repertoires').put(r);
    for (const c of data.chapters) await tx.objectStore('chapters').put(c);
    for (const id of ids) {
      const chapters = data.chapters.filter((c) => c.repertoireId === id);
      for (const m of buildMoves(id, chapters)) await tx.objectStore('repMoves').put(m);
    }
    for (const c of data.trainCards) await tx.objectStore('trainCards').put(c);
    const logged = new Set<string>();
    for (const id of ids) for (const e of await tx.objectStore('trainLog').index('repertoireId').getAll(id)) logged.add(logKey(e));
    for (const e of data.trainLog) {
      if (logged.has(logKey(e))) continue;
      logged.add(logKey(e));
      await tx.objectStore('trainLog').add(e);
    }
    await tx.done;
  },
};

export const openingGameStore = {
  /** Newest first. */
  async list(): Promise<OpeningGame[]> {
    const db = await getDb();
    return db ? (await db.getAllFromIndex('openingGames', 'playedAt')).reverse() : [];
  },
  /** Adds or replaces games, then drops the oldest beyond MAX_OPENING_GAMES. */
  async putMany(games: readonly OpeningGame[]): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const tx = db.transaction('openingGames', 'readwrite');
    for (const g of games) await tx.store.put(g);
    let extra = (await tx.store.count()) - MAX_OPENING_GAMES;
    let cursor = extra > 0 ? await tx.store.index('playedAt').openCursor() : null;
    while (cursor && extra-- > 0) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
  async clear(): Promise<void> {
    const db = await getDb();
    await db?.clear('openingGames');
  },
};

export const moveGradeStore = {
  async getAll(keys: readonly string[]): Promise<Map<string, MoveGrade>> {
    const db = await getDb();
    const out = new Map<string, MoveGrade>();
    if (!db) return out;
    const tx = db.transaction('moveGrades');
    for (const k of keys) {
      const v = await tx.store.get(k);
      if (v) out.set(k, v);
    }
    return out;
  },
  async put(key: string, grade: MoveGrade): Promise<void> {
    const db = await getDb();
    await db?.put('moveGrades', grade, key);
  },
};

/** Explorer answers kept so a scan of your positions asks Lichess once per position. */
export const explorerStore = {
  async get(url: string): Promise<{ result: ExplorerResult; at: string } | undefined> {
    const db = await getDb();
    return db ? db.get('explorer', url) : undefined;
  },
  async getMany(urls: readonly string[]): Promise<Map<string, { result: ExplorerResult; at: string }>> {
    const out = new Map<string, { result: ExplorerResult; at: string }>();
    const db = await getDb();
    if (!db || !urls.length) return out;
    const tx = db.transaction('explorer');
    const got = await Promise.all(urls.map((u) => tx.store.get(u)));
    urls.forEach((u, i) => got[i] && out.set(u, got[i]!));
    return out;
  },
  async put(url: string, result: ExplorerResult): Promise<string> {
    const at = new Date().toISOString();
    const db = await getDb();
    await db?.put('explorer', { result, at }, url);
    return at;
  },
  async clear(): Promise<void> {
    const db = await getDb();
    await db?.clear('explorer');
  },
};

/** This browser's engine evaluations, by `positionKey|depth`. */
export const engineEvalStore = {
  async getMany(keys: readonly string[]): Promise<Map<string, EngineEval>> {
    const out = new Map<string, EngineEval>();
    const db = await getDb();
    if (!db || !keys.length) return out;
    const tx = db.transaction('engineEvals');
    const got = await Promise.all(keys.map((k) => tx.store.get(k)));
    keys.forEach((k, i) => got[i] && out.set(k, got[i]!));
    return out;
  },
  async put(key: string, value: EngineEval): Promise<void> {
    const db = await getDb();
    await db?.put('engineEvals', value, key);
  },
};
