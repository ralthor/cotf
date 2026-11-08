import { parseSingleGame } from '../../core/chess/pgn';
import type { GameRecord } from '../../core/chess/types';
import { ImportError, isRecord, ProviderHttpClient, readNdjson, type FetchLike } from './http';

/** Lichess public API. No auth for public games. Not affiliated with Lichess. */
export const LICHESS_ORIGIN = 'https://lichess.org';

export type LichessGame = {
  id: string;
  rated?: boolean;
  variant?: string;
  speed?: string;
  perf?: string;
  createdAt?: number;
  lastMoveAt?: number;
  status?: string;
  winner?: 'white' | 'black';
  white?: { name?: string; rating?: number };
  black?: { name?: string; rating?: number };
  opening?: string;
  pgn?: string;
};

/** Statuses for games that are over. `created`/`started` are in progress and must never be analysed. */
const FINISHED = new Set([
  'aborted', 'mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'noStart',
  'unknownFinish', 'insufficientMaterialClaim', 'variantEnd',
]);
const ANALYSABLE_VARIANTS = new Set(['standard', 'fromPosition']);
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const ID_RE = /^[A-Za-z0-9]{8}$/;

export function normaliseLichessUsername(input: string): string {
  const u = input.trim().replace(/^@/, '');
  if (!USERNAME_RE.test(u)) throw new ImportError('invalid-input', 'Enter a valid Lichess username.');
  return u;
}

/**
 * Extracts an 8-character Lichess game ID from a URL or bare ID.
 * Accepts lichess.org/{id}, /{id}/white, /{id}/black, /{id12} (player-specific) and #ply fragments.
 * Rejects any host other than lichess.org.
 */
export function parseLichessGameId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9]{8}([A-Za-z0-9]{4})?$/.test(s)) return s.slice(0, 8);
  let url: URL;
  try {
    url = new URL(s.includes('://') ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.hostname !== 'lichess.org' && url.hostname !== 'www.lichess.org') return null;
  const seg = url.pathname.split('/').filter(Boolean);
  const first = seg[0] === 'embed' || seg[0] === 'game' ? seg[1] : seg[0];
  if (!first || !/^[A-Za-z0-9]{8}([A-Za-z0-9]{4})?$/.test(first)) return null;
  const id = first.slice(0, 8);
  return ID_RE.test(id) ? id : null;
}

function sanitise(raw: unknown): LichessGame | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const player = (v: unknown) => {
    if (!isRecord(v)) return undefined;
    const user = isRecord(v.user) ? v.user : undefined;
    return { name: str(user?.name) ?? (v.aiLevel ? `Stockfish level ${String(v.aiLevel)}` : undefined), rating: num(v.rating) };
  };
  const players = isRecord(raw.players) ? raw.players : {};
  const opening = isRecord(raw.opening) ? str(raw.opening.name) : undefined;
  return {
    id: raw.id,
    rated: typeof raw.rated === 'boolean' ? raw.rated : undefined,
    variant: str(raw.variant),
    speed: str(raw.speed),
    perf: str(raw.perf),
    createdAt: num(raw.createdAt),
    lastMoveAt: num(raw.lastMoveAt),
    status: str(raw.status),
    winner: raw.winner === 'white' || raw.winner === 'black' ? raw.winner : undefined,
    white: player(players.white),
    black: player(players.black),
    opening,
    pgn: str(raw.pgn),
  };
}

export function isAnalysable(g: LichessGame): { ok: true } | { ok: false; reason: string } {
  if (!g.status || !FINISHED.has(g.status)) return { ok: false, reason: 'game not finished' };
  if (g.status === 'aborted' || g.status === 'noStart') return { ok: false, reason: 'aborted game' };
  if (g.variant && !ANALYSABLE_VARIANTS.has(g.variant)) return { ok: false, reason: 'non-standard variant' };
  if (!g.pgn) return { ok: false, reason: 'no PGN' };
  return { ok: true };
}

export type LichessListing = {
  username: string;
  games: LichessGame[];
  skipped: { reason: string; count: number }[];
  fetchedAt: string;
};

export class LichessClient {
  private http: ProviderHttpClient;
  constructor(opts: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}) {
    // Lichess: one request at a time; on 429 wait a full minute.
    this.http = new ProviderHttpClient('Lichess', { fetch: opts.fetch, sleep: opts.sleep, rateLimitBackoffMs: 60_000, maxRetries: 1 });
  }

  async recentGames(
    username: string,
    opts: { max?: number; since?: number; perfType?: string; signal?: AbortSignal } = {},
  ): Promise<LichessListing> {
    const u = normaliseLichessUsername(username);
    const max = Math.max(1, Math.min(opts.max ?? 20, 100));
    const params = new URLSearchParams({ max: String(max), pgnInJson: 'true', clocks: 'true', opening: 'true', finished: 'true' });
    if (opts.since) params.set('since', String(opts.since));
    if (opts.perfType) params.set('perfType', opts.perfType);
    const url = `${LICHESS_ORIGIN}/api/games/user/${encodeURIComponent(u)}?${params}`;
    const raw = await this.http.stream(
      url,
      'application/x-ndjson',
      async (res) => {
        const out: unknown[] = [];
        for await (const obj of readNdjson(res, opts.signal)) {
          out.push(obj);
          if (out.length >= max) break;
        }
        return out;
      },
      opts.signal,
    );
    const counts = new Map<string, number>();
    const games: LichessGame[] = [];
    for (const r of raw) {
      const g = sanitise(r);
      if (!g) {
        counts.set('unreadable record', (counts.get('unreadable record') ?? 0) + 1);
        continue;
      }
      const ok = isAnalysable(g);
      if (ok.ok) games.push(g);
      else counts.set(ok.reason, (counts.get(ok.reason) ?? 0) + 1);
    }
    games.sort((a, b) => (b.lastMoveAt ?? b.createdAt ?? 0) - (a.lastMoveAt ?? a.createdAt ?? 0));
    return {
      username: u,
      games,
      skipped: [...counts.entries()].map(([reason, count]) => ({ reason, count })),
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Fetches one game by ID or URL. Available immediately after the game ends. */
  async game(idOrUrl: string, signal?: AbortSignal): Promise<LichessGame> {
    const id = parseLichessGameId(idOrUrl);
    if (!id) throw new ImportError('invalid-input', 'That does not look like a Lichess game URL or ID.');
    const params = new URLSearchParams({ pgnInJson: 'true', clocks: 'true', opening: 'true' });
    const body = await this.http.getText(`${LICHESS_ORIGIN}/game/export/${id}?${params}`, 'application/json', signal);
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new ImportError('invalid-data', 'Lichess returned an unreadable game.');
    }
    const g = sanitise(data);
    if (!g) throw new ImportError('invalid-data', 'Lichess returned an unexpected game format.');
    const ok = isAnalysable(g);
    if (!ok.ok) {
      throw new ImportError(
        'unsupported',
        ok.reason === 'game not finished'
          ? 'This game is still in progress. Only finished games can be analysed.'
          : `This game cannot be analysed: ${ok.reason}.`,
      );
    }
    return g;
  }
}

export function lichessToGameRecord(g: LichessGame): GameRecord {
  if (!g.pgn) throw new ImportError('invalid-data', 'This Lichess game has no PGN.');
  return parseSingleGame(g.pgn, {
    source: 'lichess',
    sourceUrl: `${LICHESS_ORIGIN}/${g.id}`,
    providerData: { timeClass: g.speed, endTime: g.lastMoveAt ? Math.floor(g.lastMoveAt / 1000) : undefined },
  });
}
