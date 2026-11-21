import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import type { EngineScore } from '../../core/engine/types';
import { standardUci } from '../../core/repertoire/parse';
import { ExplorerError } from './explorer';

/**
 * Lichess cloud evaluations: positions someone already analysed on Lichess, deep, with no engine
 * running here. Open, no token. Verified 21 Nov 2026: answers with CORS, 404 for positions not
 * analysed; two typical 11- and 12-move lines were found at 24 of 24 and 20 of 22 positions.
 */
export const CLOUD_EVAL = 'https://lichess.org/api/cloud-eval';

/** One cloud evaluation: the score (White's view), its depth, and the engine's line in standard UCI. */
export type CloudEval = { score: EngineScore; depth: number; pv: string[] };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Lichess writes castling as king-takes-rook (e1h1); the rest of the app uses e1g1. Stops at an illegal move. */
export function standardLine(fen: string, ucis: readonly string[]): string[] {
  const setup = parseFen(fen);
  if (setup.isErr) return [];
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return [];
  const p = pos.value;
  const out: string[] = [];
  for (const u of ucis) {
    const m = parseUci(u);
    if (!m) break;
    const move = normalizeMove(p, m);
    if (!p.isLegal(move)) break;
    out.push(standardUci(p, move));
    p.play(move);
  }
  return out;
}

export function parseCloudEval(data: unknown, fen: string): CloudEval | null {
  if (typeof data !== 'object' || data === null) throw new ExplorerError('data');
  const d = data as Record<string, unknown>;
  const pv = Array.isArray(d.pvs) ? (d.pvs[0] as Record<string, unknown> | undefined) : undefined;
  if (!pv) return null;
  const moves = typeof pv.moves === 'string' ? pv.moves.split(' ').filter(Boolean) : [];
  const fixed = standardLine(fen, moves.slice(0, 12));
  const depth = typeof d.depth === 'number' ? d.depth : 0;
  let score: EngineScore;
  if (typeof pv.cp === 'number') score = { kind: 'cp', value: pv.cp, perspective: 'white' };
  else if (typeof pv.mate === 'number') score = { kind: 'mate', moves: Math.abs(pv.mate), winner: pv.mate > 0 ? 'w' : 'b', perspective: 'white' };
  else return null;
  return { score, depth, pv: fixed };
}

export class CloudEvalClient {
  constructor(private readonly fetchFn: FetchLike = (i, init) => fetch(i, init)) {}

  /** The cloud evaluation of `fen`, or null when nobody analysed it. Errors use the explorer's codes. */
  async get(fen: string, signal?: AbortSignal): Promise<CloudEval | null> {
    let res: Response;
    try {
      res = await this.fetchFn(`${CLOUD_EVAL}?${new URLSearchParams({ fen })}`, { headers: { Accept: 'application/json' }, signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ExplorerError('network');
    }
    if (res.status === 404) return null;
    if (res.status === 429) throw new ExplorerError('rate');
    if (!res.ok) throw new ExplorerError('network');
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ExplorerError('data');
    }
    return parseCloudEval(data, fen);
  }
}

export const cloudEval = new CloudEvalClient();
