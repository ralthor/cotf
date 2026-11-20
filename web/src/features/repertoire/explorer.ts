/**
 * Lichess opening explorer (popularity and results per move). Optional and online only. The masters
 * database is open; the Lichess players database needs a personal API token (no permissions), which
 * stays in this browser. Verified 20 Nov 2026: masters 200 without a token, lichess 401.
 */
export const EXPLORER = 'https://explorer.lichess.ovh';

export type ExplorerDb = 'masters' | 'lichess';

export type ExplorerMove = { uci: string; san: string; white: number; draws: number; black: number; averageRating?: number };

export type ExplorerResult = {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
};

/** Why the explorer gave nothing; each has a text `explorer.error.<code>`. */
export class ExplorerError extends Error {
  constructor(readonly code: 'token' | 'rate' | 'network' | 'data') {
    super(code);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function explorerUrl(db: ExplorerDb, fen: string): string {
  const p = new URLSearchParams({ variant: 'standard', fen, moves: '12', topGames: '0', recentGames: '0' });
  if (db === 'lichess') {
    p.set('speeds', 'blitz,rapid,classical');
    p.set('ratings', '1600,1800,2000,2200,2500');
  }
  return `${EXPLORER}/${db}?${p}`;
}

export function parseExplorer(data: unknown): ExplorerResult {
  if (typeof data !== 'object' || data === null) throw new ExplorerError('data');
  const d = data as Record<string, unknown>;
  const moves = Array.isArray(d.moves) ? d.moves : [];
  const o = d.opening as Record<string, unknown> | null | undefined;
  return {
    white: num(d.white),
    draws: num(d.draws),
    black: num(d.black),
    moves: moves.flatMap((m): ExplorerMove[] => {
      const x = m as Record<string, unknown>;
      if (typeof x.uci !== 'string' || typeof x.san !== 'string') return [];
      return [{ uci: x.uci, san: x.san, white: num(x.white), draws: num(x.draws), black: num(x.black), averageRating: num(x.averageRating) || undefined }];
    }),
    opening: o && typeof o.eco === 'string' && typeof o.name === 'string' ? { eco: o.eco, name: o.name } : null,
  };
}

export class ExplorerClient {
  private cache = new Map<string, ExplorerResult>();
  constructor(private readonly fetchFn: FetchLike = (i, init) => fetch(i, init)) {}

  /** `token` is required for the Lichess players database, ignored when empty. */
  async get(db: ExplorerDb, fen: string, token: string, signal?: AbortSignal): Promise<ExplorerResult> {
    const url = explorerUrl(db, fen);
    const hit = this.cache.get(url);
    if (hit) return hit;
    let res: Response;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      res = await this.fetchFn(url, { headers, signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ExplorerError('network');
    }
    if (res.status === 401 || res.status === 403) throw new ExplorerError('token');
    if (res.status === 429) throw new ExplorerError('rate');
    if (!res.ok) throw new ExplorerError('network');
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ExplorerError('data');
    }
    const result = parseExplorer(data);
    this.cache.set(url, result);
    return result;
  }
}

export const needsToken = (db: ExplorerDb) => db === 'lichess';

export const explorer = new ExplorerClient();
