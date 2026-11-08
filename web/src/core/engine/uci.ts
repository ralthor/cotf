import type { Colour } from '../chess/types';
import type { EngineScore, Wdl } from './types';

/** A parsed `info` line with a score. Scores are as the engine sent them: side-to-move relative. */
export type RawInfo = {
  depth: number;
  seldepth?: number;
  multipv: number;
  score: { kind: 'cp' | 'mate'; value: number };
  bound?: 'lower' | 'upper';
  nodes?: number;
  nps?: number;
  timeMs?: number;
  pv: string[];
  wdl?: Wdl;
};

/** Parses a UCI `info` line. Returns null for info lines without a score (e.g. currmove, strings). */
export function parseInfoLine(line: string): RawInfo | null {
  if (!line.startsWith('info ')) return null;
  const t = line.trim().split(/\s+/);
  let depth: number | undefined;
  let seldepth: number | undefined;
  let multipv = 1;
  let score: RawInfo['score'] | undefined;
  let bound: RawInfo['bound'];
  let nodes: number | undefined;
  let nps: number | undefined;
  let timeMs: number | undefined;
  let wdl: Wdl | undefined;
  let pv: string[] = [];

  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    switch (k) {
      case 'depth':
        depth = Number(t[++i]);
        break;
      case 'seldepth':
        seldepth = Number(t[++i]);
        break;
      case 'multipv':
        multipv = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const value = Number(t[++i]);
        if (kind === 'cp' || kind === 'mate') score = { kind, value };
        if (t[i + 1] === 'lowerbound') {
          bound = 'lower';
          i++;
        } else if (t[i + 1] === 'upperbound') {
          bound = 'upper';
          i++;
        }
        break;
      }
      case 'wdl':
        wdl = { win: Number(t[i + 1]), draw: Number(t[i + 2]), loss: Number(t[i + 3]) };
        i += 3;
        break;
      case 'nodes':
        nodes = Number(t[++i]);
        break;
      case 'nps':
        nps = Number(t[++i]);
        break;
      case 'time':
        timeMs = Number(t[++i]);
        break;
      case 'pv':
        pv = t.slice(i + 1);
        i = t.length;
        break;
      case 'string':
        return null;
      default:
        break;
    }
  }
  if (depth === undefined || !score || Number.isNaN(depth) || Number.isNaN(score.value)) return null;
  return { depth, seldepth, multipv, score, bound, nodes, nps, timeMs, pv, wdl };
}

export function parseBestMove(line: string): { best: string | null; ponder?: string } | null {
  const m = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line.trim());
  if (!m) return null;
  return { best: m[1] === '(none)' ? null : m[1]!, ponder: m[2] };
}

export function parseIdName(line: string): string | null {
  const m = /^id name\s+(.+)$/.exec(line.trim());
  return m ? m[1]! : null;
}

export function sideToMove(fen: string): Colour {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Converts a side-to-move relative UCI score into the canonical white-relative score. */
export function toWhiteScore(raw: RawInfo['score'], stm: Colour): EngineScore {
  const sign = stm === 'w' ? 1 : -1;
  if (raw.kind === 'cp') return { kind: 'cp', value: raw.value * sign, perspective: 'white' };
  // mate N > 0: side to move mates in N; mate -N: side to move is mated in N; mate 0: side to move is mated.
  const stmWins = raw.value > 0;
  const winner: Colour = stmWins ? stm : stm === 'w' ? 'b' : 'w';
  return { kind: 'mate', moves: Math.abs(raw.value), winner, perspective: 'white' };
}

export function toWhiteWdl(wdl: Wdl | undefined, stm: Colour): Wdl | undefined {
  if (!wdl) return undefined;
  return stm === 'w' ? wdl : { win: wdl.loss, draw: wdl.draw, loss: wdl.win };
}

export function buildGoCommand(opts: {
  depth?: number;
  nodes?: number;
  movetimeMs?: number;
  searchMoves?: string[];
}): string {
  const parts = ['go'];
  if (opts.depth !== undefined) parts.push('depth', String(opts.depth));
  if (opts.nodes !== undefined) parts.push('nodes', String(opts.nodes));
  if (opts.movetimeMs !== undefined) parts.push('movetime', String(opts.movetimeMs));
  if (parts.length === 1) parts.push('depth', '16');
  if (opts.searchMoves && opts.searchMoves.length > 0) parts.push('searchmoves', ...opts.searchMoves);
  return parts.join(' ');
}
