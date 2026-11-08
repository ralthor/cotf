import { parseSingleGame } from '../../core/chess/pgn';
import type { GameRecord } from '../../core/chess/types';
import { ImportError, isRecord, ProviderHttpClient, type FetchLike } from './http';

/** Chess.com Published-Data API (PubAPI). Public, read-only, no auth. Not affiliated with Chess.com. */
export const CHESSCOM_API = 'https://api.chess.com/pub';

export type ChessComGame = {
  url?: string;
  pgn?: string;
  tcn?: string;
  end_time?: number;
  time_class?: string;
  time_control?: string;
  rules?: string;
  white?: { username?: string; rating?: number; result?: string };
  black?: { username?: string; rating?: number; result?: string };
  accuracies?: { white?: number; black?: number };
  fen?: string;
};

export type ChessComListing = {
  username: string;
  months: string[]; // archive URLs that were fetched, newest first
  games: ChessComGame[]; // standard chess with PGN, newest first
  skipped: { reason: string; count: number }[];
  fetchedAt: string;
};

const USERNAME_RE = /^[A-Za-z0-9_-]{2,50}$/;

export function normaliseChessComUsername(input: string): string {
  const u = input.trim().replace(/^@/, '');
  if (!USERNAME_RE.test(u)) throw new ImportError('invalid-input', 'Enter a valid Chess.com username.');
  return u.toLowerCase();
}

export function monthArchiveUrl(username: string, year: number, month: number): string {
  return `${CHESSCOM_API}/player/${encodeURIComponent(username)}/games/${year}/${String(month).padStart(2, '0')}`;
}

/** Current UTC year/month for a given instant (archives are keyed by UTC month). */
export function utcYearMonth(now: Date): { year: number; month: number } {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function isChessComGameUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return /(^|\.)chess\.com$/.test(u.hostname) && /\/game\//.test(u.pathname);
  } catch {
    return false;
  }
}

function sanitiseGame(raw: unknown): ChessComGame | null {
  if (!isRecord(raw)) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const side = (v: unknown) =>
    isRecord(v) ? { username: str(v.username), rating: num(v.rating), result: str(v.result) } : undefined;
  const acc = isRecord(raw.accuracies) ? { white: num(raw.accuracies.white), black: num(raw.accuracies.black) } : undefined;
  return {
    url: str(raw.url),
    pgn: str(raw.pgn),
    tcn: str(raw.tcn),
    end_time: num(raw.end_time),
    time_class: str(raw.time_class),
    time_control: str(raw.time_control),
    rules: str(raw.rules),
    white: side(raw.white),
    black: side(raw.black),
    accuracies: acc,
    fen: str(raw.fen),
  };
}

export class ChessComClient {
  private http: ProviderHttpClient;
  constructor(opts: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; manualConditional?: boolean } = {}) {
    this.http = new ProviderHttpClient('Chess.com', {
      fetch: opts.fetch,
      sleep: opts.sleep,
      manualConditional: opts.manualConditional,
      rateLimitBackoffMs: 5_000,
      minIntervalMs: 250,
    });
  }

  async archives(username: string, signal?: AbortSignal): Promise<string[]> {
    const u = normaliseChessComUsername(username);
    const body = await this.http.getText(`${CHESSCOM_API}/player/${encodeURIComponent(u)}/games/archives`, 'application/json', signal);
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new ImportError('invalid-data', 'Chess.com returned an unreadable archive index.');
    }
    if (!isRecord(data) || !Array.isArray(data.archives)) return [];
    return data.archives.filter(
      (a): a is string => typeof a === 'string' && a.startsWith(`${CHESSCOM_API}/player/`),
    );
  }

  async month(url: string, signal?: AbortSignal): Promise<ChessComGame[]> {
    if (!url.startsWith(`${CHESSCOM_API}/player/`)) throw new ImportError('invalid-input', 'Unexpected archive URL.');
    const body = await this.http.getText(url, 'application/json', signal);
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new ImportError('invalid-data', 'Chess.com returned an unreadable month archive.');
    }
    if (!isRecord(data) || !Array.isArray(data.games)) return [];
    return data.games.map(sanitiseGame).filter((g): g is ChessComGame => g !== null);
  }

  /**
   * Lists recent published games, newest first. Fetches the archive index, then the latest
   * `monthsBack` months that actually exist (serially). The current month may be incomplete.
   */
  async recentGames(username: string, opts: { monthsBack?: number; signal?: AbortSignal } = {}): Promise<ChessComListing> {
    const u = normaliseChessComUsername(username);
    const archives = await this.archives(u, opts.signal);
    if (archives.length === 0) {
      return { username: u, months: [], games: [], skipped: [], fetchedAt: new Date().toISOString() };
    }
    const months = [...archives].sort().reverse().slice(0, Math.max(1, opts.monthsBack ?? 1));
    const all: ChessComGame[] = [];
    for (const m of months) all.push(...(await this.month(m, opts.signal)));
    let nonStandard = 0;
    let noPgn = 0;
    const games = all.filter((g) => {
      if (g.rules && g.rules !== 'chess') return nonStandard++, false;
      if (!g.pgn) return noPgn++, false;
      return true;
    });
    games.sort((a, b) => (b.end_time ?? 0) - (a.end_time ?? 0));
    const skipped = [
      { reason: 'non-standard variant', count: nonStandard },
      { reason: 'no PGN in archive', count: noPgn },
    ].filter((s) => s.count > 0);
    return { username: u, months, games, skipped, fetchedAt: new Date().toISOString() };
  }
}

export function chessComToGameRecord(g: ChessComGame): GameRecord {
  if (!g.pgn) throw new ImportError('invalid-data', 'This Chess.com game has no PGN.');
  return parseSingleGame(g.pgn, {
    source: 'chesscom',
    sourceUrl: g.url,
    providerData: { accuracies: g.accuracies, timeClass: g.time_class, endTime: g.end_time },
  });
}

export const CHESSCOM_FRESHNESS_NOTE =
  'Chess.com refreshes these archives at most every 12 hours, so a game you just finished may not appear yet. ' +
  'For instant analysis, download the PGN from the game page and paste it here.';
