import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import type { EngineScore } from '../engine/types';
import { CP_LOGISTIC_K, expectedScore } from '../scoring/score';
import type { OpeningGame } from './games';
import { dbMoves, isMainMove, walkGame, type DbPosition, type ImprovementRule } from './insights';
import { standardUci } from './parse';
import type { Side } from './types';

/**
 * Where your games went wrong in the opening. Each position gets White's win chances from one of two
 * sources, both without Lichess's analysis servers:
 * - `engine`: Stockfish running in this browser; win chances from its evaluation (the Lichess formula).
 * - `database`: the opening database's results from that position (how players actually scored).
 */

export type LossSource = 'engine' | 'database';

/** Drops in your win chances (0–1) that Lichess calls an inaccuracy, a mistake, a blunder. */
export const DROP = { inaccuracy: 0.1, mistake: 0.2, blunder: 0.3 } as const;
export type DropLabel = keyof typeof DROP;

export const dropLabel = (drop: number): DropLabel | null =>
  drop >= DROP.blunder ? 'blunder' : drop >= DROP.mistake ? 'mistake' : drop >= DROP.inaccuracy ? 'inaccuracy' : null;

/** Your win chances (0–1) in an evaluation (White's view). */
export const winFor = (s: EngineScore, colour: Side) => expectedScore(s, colour);

/** Fewest database games for a position's results to count as its win chances. */
export const MIN_DB_GAMES = 50;

/** What is known about one position: White's win chances, and where they come from. */
export type PlyValue = {
  /** White's win chances, 0–1. */
  win: number;
  /** The engine's evaluation (engine source). */
  score?: EngineScore;
  /** The engine's line, or the database's best-scoring main move, standard UCI. */
  pv?: string[];
  /** Database games behind the win chances (database source). */
  games?: number;
  depth?: number;
};

/** What is known after `ply` plies of a game (undefined: nothing yet). */
export type ValueAt = (ply: number) => PlyValue | undefined;

const sideWin = (white: number, colour: Side) => (colour === 'w' ? white : 1 - white);

/** An engine evaluation as a position value. */
export const engineValue = (e: { score: EngineScore; pv?: string[]; depth?: number }): PlyValue => ({
  win: expectedScore(e.score, 'w'),
  score: e.score,
  pv: e.pv,
  depth: e.depth,
});

/** An evaluation with these win chances for White (for drawing database results on the evaluation chart). */
export function scoreFromWin(white: number): EngineScore {
  const w = Math.min(0.99, Math.max(0.01, white));
  return { kind: 'cp', value: Math.round(Math.log(w / (1 - w)) / CP_LOGISTIC_K), perspective: 'white' };
}

/** The plies of your moves (the position after each), up to `maxPly`. */
export function yourPlies(game: OpeningGame, maxPly: number): number[] {
  const last = Math.min(maxPly, walkGame(game, maxPly).keys.length - 1);
  const out: number[] = [];
  for (let p = game.userColour === 'w' ? 1 : 2; p <= last; p += 2) out.push(p);
  return out;
}

/** One of your moves, with your win chances before and after it. */
export type LossMove = {
  /** The ply of your move (the position after it). */
  ply: number;
  san: string;
  uci: string;
  before: PlyValue;
  after: PlyValue;
  /** Your win chances, 0–1. */
  beforeWin: number;
  afterWin: number;
  drop: number;
  /** The best move in the position before yours (engine's, or the database's best-scoring main move). */
  best?: string;
  /** The engine's line from there, standard UCI. */
  line?: string[];
};

export type OpeningLoss = {
  game: OpeningGame;
  /** Your move with the biggest drop (null: no drop, or nothing measured). */
  worst: LossMove | null;
  /** All your moves that could be measured, in order. */
  moves: LossMove[];
  /** Where you stood when the opening ended: the last position known. */
  end: { ply: number; win: number } | null;
  /** Your moves measured, of your moves in the opening. */
  known: number;
  wanted: number;
};

/** Your moves' drops in win chances over the first `maxPly` plies, and the worst of them. */
export function openingLoss(game: OpeningGame, maxPly: number, valueAt: ValueAt): OpeningLoss {
  const w = walkGame(game, maxPly);
  const last = Math.min(maxPly, w.keys.length - 1);
  const colour = game.userColour;
  const plies = yourPlies(game, maxPly);
  const moves: LossMove[] = [];
  for (const p of plies) {
    const before = valueAt(p - 1);
    const after = valueAt(p);
    if (!before || !after) continue;
    const beforeWin = sideWin(before.win, colour);
    const afterWin = sideWin(after.win, colour);
    moves.push({
      ply: p,
      san: game.moves[p - 1]!.san,
      uci: w.ucis[p - 1]!,
      before,
      after,
      beforeWin,
      afterWin,
      drop: Math.max(0, beforeWin - afterWin),
      best: before.pv?.[0],
      line: before.score ? before.pv : undefined,
    });
  }
  let worst: LossMove | null = null;
  for (const m of moves) if (m.drop > 0 && (!worst || m.drop > worst.drop)) worst = m;
  let end: OpeningLoss['end'] = null;
  for (let p = last; p >= 0 && !end; p--) {
    const v = valueAt(p);
    if (v) end = { ply: p, win: sideWin(v.win, colour) };
  }
  return { game, worst, moves, end, known: moves.length, wanted: plies.length };
}

/** The standard UCI of a SAN move in `fen`, or null. */
function uciOfSan(fen: string, san: string): string | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return null;
  const m = parseSan(pos.value, san);
  return m ? standardUci(pos.value, m) : null;
}

/**
 * Win chances from the opening database: a position's own results when it has enough games, else
 * the results of the move that reached it, as listed in the position before. `resultAt(ply)` is the
 * database answer for the position after `ply` plies, when looked up.
 */
export function dbValueAt(game: OpeningGame, maxPly: number, resultAt: (ply: number) => DbPosition | undefined, rule: ImprovementRule): ValueAt {
  const w = walkGame(game, maxPly);
  const ownValue = (ply: number): PlyValue | undefined => {
    const own = resultAt(ply);
    const total = own ? own.white + own.draws + own.black : 0;
    if (!own || total < MIN_DB_GAMES) return undefined;
    const mover: Side = ply % 2 === 0 ? 'w' : 'b';
    const main = dbMoves(own, mover).filter((m) => isMainMove(m, total, rule));
    const best = main.length ? main.reduce((a, b) => (b.score > a.score ? b : a)) : undefined;
    const uci = best ? uciOfSan(w.fens[ply]!, best.san) : null;
    return { win: (own.white + own.draws / 2) / total, games: total, pv: uci ? [uci] : undefined };
  };
  const moveValue = (ply: number): PlyValue | undefined => {
    const entry = resultAt(ply - 1)?.moves.find((m) => m.san === game.moves[ply - 1]!.san);
    const games = entry ? entry.white + entry.draws + entry.black : 0;
    return entry && games >= MIN_DB_GAMES ? { win: (entry.white + entry.draws / 2) / games, games } : undefined;
  };
  return (ply) => {
    if (ply >= w.keys.length) return undefined;
    // Before your move: the position's own results. After it: the games where your move was played
    // there (so the value does not depend on which positions were looked up), else the position's own.
    const yourTurn = (ply % 2 === 0 ? 'w' : 'b') === game.userColour;
    return yourTurn || ply < 1 ? ownValue(ply) : (moveValue(ply) ?? ownValue(ply));
  };
}

/**
 * Database positions a game needs: the position before each of your moves, and the position after
 * it when the move is missing (or rare) in the list of the position before. `known(ply)` says
 * whether a ply's position was looked up already.
 */
export function dbPliesNeeded(game: OpeningGame, maxPly: number, resultAt: (ply: number) => DbPosition | undefined, known: (ply: number) => boolean): number[] {
  const out: number[] = [];
  for (const p of yourPlies(game, maxPly)) {
    if (!known(p - 1)) {
      out.push(p - 1);
      continue;
    }
    const parent = resultAt(p - 1);
    const total = parent ? parent.white + parent.draws + parent.black : 0;
    if (total < MIN_DB_GAMES) continue; // too few games before: nothing to compare with
    const entry = parent!.moves.find((m) => m.san === game.moves[p - 1]!.san);
    const games = entry ? entry.white + entry.draws + entry.black : 0;
    if (games < MIN_DB_GAMES && !known(p)) out.push(p);
  }
  return out;
}
