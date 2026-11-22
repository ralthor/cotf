import { getDb } from './db';
import { allPrefs, replacePrefs, type PrefKey } from './prefs';

/**
 * Everything this browser keeps for the app in one file: every IndexedDB store (repertoires,
 * training, games, analyses, saved engine and database results, settings) and the preferences.
 * The Lichess token is never written to the file, and an import never removes it.
 */

export const FULL_FORMAT = 'chess-on-the-fly/everything';
export const FULL_VERSION = 1;

/** Never exported, and kept as it is on import. */
export const KEEP_PREFS: readonly PrefKey[] = ['lichessToken'];

/** Other browser keys the app keeps outside its preferences (the language). Sign-in tokens are not among them. */
const EXTRA_KEYS = ['i18n.locale'] as const;

function readExtras(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const k of EXTRA_KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
  } catch {
    // unavailable
  }
  return out;
}
function writeExtras(extras: Record<string, string> | undefined): void {
  try {
    for (const k of EXTRA_KEYS) {
      const v = extras?.[k];
      if (v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
  } catch {
    // unavailable
  }
}

/** One stored record: its key (for stores without a key path) and value. */
type Row = { k?: unknown; v: unknown };

export type FullBackup = {
  format: typeof FULL_FORMAT;
  version: number;
  exportedAt: string;
  /** The database version it was made with. */
  dbVersion: number;
  stores: Record<string, Row[]>;
  prefs: Record<string, string>;
  /** Other browser keys (the language). */
  extras?: Record<string, string>;
};

export class FullBackupError extends Error {
  constructor(readonly code: 'json' | 'format' | 'newer' | 'invalid' | 'storage') {
    super(code);
  }
}

// JSON keeps dates, maps and sets only as tagged objects.
function replacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = this[key];
  if (raw instanceof Date) return { $date: raw.toISOString() };
  if (raw instanceof Map) return { $map: [...raw] };
  if (raw instanceof Set) return { $set: [...raw] };
  return value;
}
function reviver(_key: string, value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1) {
      if (keys[0] === '$date' && typeof o.$date === 'string') return new Date(o.$date);
      if (keys[0] === '$map' && Array.isArray(o.$map)) return new Map(o.$map as [unknown, unknown][]);
      if (keys[0] === '$set' && Array.isArray(o.$set)) return new Set(o.$set);
    }
  }
  return value;
}

export function makeFullBackup(data: Omit<FullBackup, 'format' | 'version' | 'exportedAt'>, now = new Date()): string {
  const prefs = { ...data.prefs };
  for (const k of KEEP_PREFS) delete prefs[k];
  const out: FullBackup = { format: FULL_FORMAT, version: FULL_VERSION, exportedAt: now.toISOString(), dbVersion: data.dbVersion, stores: data.stores, prefs, extras: data.extras };
  return JSON.stringify(out, replacer);
}

/** Whether a file is a full backup (as opposed to the older openings-only one). */
export function isFullBackup(text: string): boolean {
  return text.slice(0, 200).includes(`"${FULL_FORMAT}"`);
}

export function parseFullBackup(text: string): FullBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text, reviver);
  } catch {
    throw new FullBackupError('json');
  }
  const o = raw as Partial<FullBackup> | null;
  if (!o || typeof o !== 'object' || o.format !== FULL_FORMAT || typeof o.version !== 'number') throw new FullBackupError('format');
  if (o.version > FULL_VERSION) throw new FullBackupError('newer');
  if (!o.stores || typeof o.stores !== 'object' || !o.prefs || typeof o.prefs !== 'object') throw new FullBackupError('invalid');
  for (const rows of Object.values(o.stores)) if (!Array.isArray(rows)) throw new FullBackupError('invalid');
  for (const v of Object.values(o.prefs)) if (typeof v !== 'string') throw new FullBackupError('invalid');
  return o as FullBackup;
}

/** Reads every store and preference (except the token) into a backup file's text. */
export async function exportEverything(now = new Date()): Promise<{ text: string; counts: Record<string, number> }> {
  const db = await getDb();
  if (!db) throw new FullBackupError('storage');
  const idb = db as unknown as IDBDatabase & { transaction: typeof db.transaction };
  const names = [...db.objectStoreNames] as string[];
  const stores: Record<string, Row[]> = {};
  const tx = db.transaction(names as never[], 'readonly');
  for (const name of names) {
    const store = tx.objectStore(name as never);
    const inline = store.keyPath !== null;
    const rows: Row[] = [];
    let cursor = await store.openCursor();
    while (cursor) {
      rows.push(inline ? { v: cursor.value } : { k: cursor.key, v: cursor.value });
      cursor = await cursor.continue();
    }
    stores[name] = rows;
  }
  await tx.done;
  const counts = Object.fromEntries(Object.entries(stores).map(([k, v]) => [k, v.length]));
  return { text: makeFullBackup({ dbVersion: idb.version, stores, prefs: allPrefs(), extras: readExtras() }, now), counts };
}

/**
 * Replaces everything on this device with the backup: every store is emptied and filled from the
 * file (a store the file does not have is left empty), and the preferences are replaced, all but
 * the Lichess token, which stays as it is.
 */
export async function importEverything(backup: FullBackup): Promise<void> {
  const db = await getDb();
  if (!db) throw new FullBackupError('storage');
  const names = [...db.objectStoreNames] as string[];
  const tx = db.transaction(names as never[], 'readwrite');
  for (const name of names) {
    const store = tx.objectStore(name as never);
    await store.clear();
    const inline = store.keyPath !== null;
    for (const row of backup.stores[name] ?? []) {
      if (inline) await store.put(row.v as never);
      else await store.put(row.v as never, row.k as never);
    }
  }
  await tx.done;
  replacePrefs(backup.prefs, KEEP_PREFS);
  writeExtras(backup.extras);
}
