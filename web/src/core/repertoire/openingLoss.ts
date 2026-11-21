import { parseComment, parsePgn } from 'chessops/pgn';
import type { EngineScore } from '../engine/types';
import { expectedScore } from '../scoring/score';
import type { OpeningGame } from './games';
import { walkGame } from './insights';
import type { Side } from './types';

/**
 * Where your games went wrong in the opening, from evaluations (Lichess cloud evaluations, or the
 * evaluations in a Lichess game you had analysed there). No engine runs here. Win chances use the
 * same formula as Lichess, so the labels match what Lichess shows for a game.
 */

/** Drops in your win chances (0–1) that Lichess calls an inaccuracy, a mistake, a blunder. */
export const DROP = { inaccuracy: 0.1, mistake: 0.2, blunder: 0.3 } as const;
export type DropLabel = keyof typeof DROP;

export const dropLabel = (drop: number): DropLabel | null =>
  drop >= DROP.blunder ? 'blunder' : drop >= DROP.mistake ? 'mistake' : drop >= DROP.inaccuracy ? 'inaccuracy' : null;

/** Your win chances (0–1) in an evaluation (White's view). */
export const winFor = (s: EngineScore, colour: Side) => expectedScore(s, colour);

/** Evaluations written in a game's PGN ([%eval]), by ply: the position after that many moves. */
export function pgnEvals(pgn: string | undefined): Map<number, EngineScore> {
  const out = new Map<number, EngineScore>();
  if (!pgn || !pgn.includes('%eval')) return out;
  const game = parsePgn(pgn)[0];
  if (!game) return out;
  let ply = 0;
  for (const node of game.moves.mainline()) {
    ply++;
    for (const c of node.comments ?? []) {
      const e = parseComment(c).evaluation;
      if (!e) continue;
      if ('pawns' in e) out.set(ply, { kind: 'cp', value: Math.round(e.pawns * 100), perspective: 'white' });
      else out.set(ply, { kind: 'mate', moves: Math.abs(e.mate), winner: e.mate > 0 ? 'w' : 'b', perspective: 'white' });
    }
  }
  return out;
}

/**
 * The plies whose evaluations a first pass needs: the position before your first move and the
 * position after each of your moves, up to `maxPly`. The drop between two of them covers your move
 * and the opponent's reply; `refinePly` asks for the one position that makes the worst move exact.
 */
export function pliesToLookUp(game: OpeningGame, maxPly: number): number[] {
  const last = Math.min(maxPly, walkGame(game, maxPly).keys.length - 1);
  const first = game.userColour === 'w' ? 1 : 2;
  const out = [first - 1];
  for (let p = first; p <= last; p += 2) out.push(p);
  return out;
}

/** One of your moves, with your win chances before and after it. */
export type LossMove = {
  /** The ply of your move (the position after it). */
  ply: number;
  san: string;
  uci: string;
  /** The ply the "before" evaluation is from: `ply - 1` (exact), or `ply - 2` (also counts the opponent's move before). */
  beforePly: number;
  before: EngineScore;
  after: EngineScore;
  /** Your win chances, 0–1. */
  beforeWin: number;
  afterWin: number;
  drop: number;
  /** The best move in the position before yours, from the evaluation there (exact only). */
  best?: string;
  /** The engine's line from there, standard UCI. */
  line?: string[];
};

export type OpeningLoss = {
  game: OpeningGame;
  /** Your move with the biggest drop (null: no drop, or too few evaluations). */
  worst: LossMove | null;
  /** All your moves that could be measured, in order. */
  moves: LossMove[];
  /** The last evaluation in the opening: where you stood when it ended. */
  end: { ply: number; score: EngineScore; win: number } | null;
  /** Positions with an evaluation, of those looked for. */
  known: number;
  wanted: number;
};

/** An evaluation for a ply, with the engine's line when there is one. */
export type EvalAt = (ply: number) => { score: EngineScore; pv?: string[] } | undefined;

/** Your moves' drops in win chances over the first `maxPly` plies, and the worst of them. */
export function openingLoss(game: OpeningGame, maxPly: number, evalAt: EvalAt): OpeningLoss {
  const w = walkGame(game, maxPly);
  const last = Math.min(maxPly, w.keys.length - 1);
  const colour = game.userColour;
  const wanted = pliesToLookUp(game, maxPly);
  const known = wanted.filter((p) => evalAt(p)).length;
  const moves: LossMove[] = [];
  for (let p = colour === 'w' ? 1 : 2; p <= last; p += 2) {
    const after = evalAt(p);
    if (!after) continue;
    const exact = evalAt(p - 1);
    const beforePly = exact ? p - 1 : p - 2;
    const before = exact ?? (p - 2 >= 0 ? evalAt(p - 2) : undefined);
    if (!before) continue;
    const beforeWin = winFor(before.score, colour);
    const afterWin = winFor(after.score, colour);
    moves.push({
      ply: p,
      san: game.moves[p - 1]!.san,
      uci: w.ucis[p - 1]!,
      beforePly,
      before: before.score,
      after: after.score,
      beforeWin,
      afterWin,
      drop: Math.max(0, beforeWin - afterWin),
      best: exact ? before.pv?.[0] : undefined,
      line: exact ? before.pv : undefined,
    });
  }
  let worst: LossMove | null = null;
  for (const m of moves) if (m.drop > 0 && (!worst || m.drop > worst.drop)) worst = m;
  let end: OpeningLoss['end'] = null;
  for (let p = last; p >= 0 && !end; p--) {
    const e = evalAt(p);
    if (e) end = { ply: p, score: e.score, win: winFor(e.score, colour) };
  }
  return { game, worst, moves, end, known, wanted: wanted.length };
}

/**
 * The position to look up for a game's worst move: the one right before it, which makes the drop
 * exact and gives the best move there. Null when that is known already.
 */
export function refinePly(loss: OpeningLoss): number | null {
  const w = loss.worst;
  return w && !w.best ? w.ply - 1 : null;
}
