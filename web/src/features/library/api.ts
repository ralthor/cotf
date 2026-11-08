import type { GameAnalysis } from '../analysis/types';

/** Backend base URL (Phase 2). When unset, the app runs browser-only and hides account features. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const backendEnabled = API_URL !== '';

const TOKEN_KEY = 'chess-analyser-token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable: session-only login
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === 'string') return b.detail;
    const first = Object.entries(b)[0];
    if (first) return `${first[0]}: ${Array.isArray(first[1]) ? first[1].join(' ') : String(first[1])}`;
  }
  return `Request failed (HTTP ${status}).`;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/${path.replace(/^\//, '')}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch {
    throw new ApiError('Could not reach the server.', 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(messageFrom(body, res.status), res.status, body);
  }
  return body as T;
}

export type ExternalAccount = {
  id: number;
  provider: 'chesscom' | 'lichess';
  username: string;
  last_synced_at: string | null;
  last_sync_status: string;
  last_sync_error: string;
};

export type Me = { id: number; username: string; email: string; external_accounts: ExternalAccount[] };

export type ServerGame = {
  id: number;
  provider: 'chesscom' | 'lichess' | 'pgn';
  source_url: string;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string;
  user_colour: 'w' | 'b' | '';
  user_result: 'win' | 'loss' | 'draw' | '';
  opponent: string;
  opponent_rating: number | null;
  time_class: string;
  opening: string;
  eco: string;
  played_at: string | null;
  ply_count: number;
  provider_accuracy: { white?: number; black?: number } | null;
  latest_accuracy: { white?: { value?: number }; black?: { value?: number } } | null;
};

export type ServerGameDetail = ServerGame & { pgn: string; headers: Record<string, string> };

export type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type ServerAnalysis = GameAnalysis & { id: number; source: 'browser' | 'cloud'; profile: string; stats: Record<string, unknown> };

export type CloudJob = {
  id: number;
  game: number;
  profile: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress_done: number;
  progress_total: number;
  progress_label: string;
  error: string;
  analysis?: ServerAnalysis;
};

export type Stats = {
  games: number;
  analysed_games: number;
  results: { win: number; loss: number; draw: number };
  average_accuracy: number | null;
  accuracy_trend: { game: number; played_at: string | null; accuracy: number; time_class: string; result: string; opponent: string }[];
  by_time_class: Record<string, { games: number; accuracy: number | null }>;
  categories: Record<string, number>;
  by_phase: Record<string, Record<string, number>>;
  openings: { opening: string; games: number; score_pct: number; accuracy: number | null }[];
  notes: string;
};

export type GameFilters = Partial<Record<'colour' | 'time_class' | 'result' | 'opponent' | 'provider' | 'date_from' | 'date_to', string>>;

export function query(filters: GameFilters & { page?: number }): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
