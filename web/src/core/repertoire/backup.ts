import type { Chapter, Repertoire, TrainCard, TrainLogEntry } from './types';

export const BACKUP_FORMAT = 'chess-on-the-fly/openings';
export const BACKUP_VERSION = 1;

export type BackupData = {
  repertoires: Repertoire[];
  chapters: Chapter[];
  trainCards: TrainCard[];
  trainLog: TrainLogEntry[];
};

export type Backup = BackupData & { format: typeof BACKUP_FORMAT; version: number; exportedAt: string };

/** Why a file could not be restored; each code has a text `repertoire.backup.error.<code>`. */
export class BackupError extends Error {
  constructor(readonly code: 'json' | 'format' | 'newer' | 'invalid') {
    super(code);
  }
}

export function makeBackup(data: BackupData, now = new Date()): string {
  const backup: Backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), ...data };
  // Dates (card due and review times) become ISO strings.
  return JSON.stringify(backup);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function date(v: unknown): Date {
  const d = new Date(v as string);
  if (!isStr(v) || Number.isNaN(d.getTime())) throw new BackupError('invalid');
  return d;
}

/** Parses and checks a backup file; card dates are turned back into Dates. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('json');
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT || typeof raw.version !== 'number') throw new BackupError('format');
  if (raw.version > BACKUP_VERSION) throw new BackupError('newer');
  const { repertoires, chapters, trainCards, trainLog } = raw;
  if (![repertoires, chapters, trainCards, trainLog].every(Array.isArray)) throw new BackupError('invalid');

  const reps = repertoires as unknown[];
  if (!reps.every((r) => isObj(r) && isStr(r.id) && isStr(r.name))) throw new BackupError('invalid');
  const repIds = new Set((reps as Repertoire[]).map((r) => r.id));
  const inFile = (v: unknown) => isObj(v) && isStr(v.repertoireId) && repIds.has(v.repertoireId);

  if (!(chapters as unknown[]).every((c) => inFile(c) && isStr((c as Chapter).id) && isObj((c as Chapter).root))) throw new BackupError('invalid');
  const cards = (trainCards as unknown[]).map((c): TrainCard => {
    if (!inFile(c) || !isObj((c as TrainCard).srs) || !isStr((c as TrainCard).posKey)) throw new BackupError('invalid');
    const card = c as TrainCard & { srs: Record<string, unknown> };
    const srs = { ...card.srs, dueAt: date(card.srs.dueAt), lastReviewAt: card.srs.lastReviewAt == null ? null : date(card.srs.lastReviewAt) };
    return { ...card, srs: srs as unknown as TrainCard['srs'] };
  });
  const log = (trainLog as unknown[]).map((e): TrainLogEntry => {
    if (!inFile(e) || !isStr((e as TrainLogEntry).posKey) || !isStr((e as TrainLogEntry).at)) throw new BackupError('invalid');
    const rest = { ...(e as TrainLogEntry) };
    delete rest.id; // the browser numbers answers itself
    return rest;
  });

  return {
    format: BACKUP_FORMAT,
    version: raw.version,
    exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : '',
    repertoires: reps as Repertoire[],
    chapters: chapters as Chapter[],
    trainCards: cards,
    trainLog: log,
  };
}

/** Same answer: the log is merged on restore without duplicates. */
export const logKey = (e: Pick<TrainLogEntry, 'repertoireId' | 'side' | 'posKey' | 'at'>) => `${e.repertoireId}|${e.side}|${e.posKey}|${e.at}`;
