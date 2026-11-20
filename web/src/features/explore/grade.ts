import { Chess } from 'chess.js';
import { classifyMove, type MoveCategory } from '../../core/classification/classify';
import type { Colour } from '../../core/chess/types';
import type { AnalyseOptions } from '../../core/engine/EngineClient';
import type { EngineLine, EngineScore, PositionAnalysis, SearchRequest } from '../../core/engine/types';

/** Anything that can run a search: an EnginePool or a single EngineClient. */
export type Analyser = { analyse(req: SearchRequest, opts?: AnalyseOptions): Promise<PositionAnalysis> };

export type MoveGrade = {
  uci: string;
  san: string;
  category: MoveCategory;
  /** Score after the move (white-relative). */
  played: EngineScore;
  best: EngineScore;
  bestUci?: string;
};

/** Categories that count as a good answer in practice. */
export const GOOD_ENOUGH: readonly MoveCategory[] = ['brilliant', 'great', 'best', 'good'];

/** A legal move made by dragging `from` → `to` in `fen` (pawns promote to a queen), or null. */
export function legalMove(fen: string, from: string, to: string): { uci: string; san: string } | null {
  const c = new Chess(fen);
  try {
    const m = c.move({ from, to, promotion: 'q' });
    return { uci: m.from + m.to + (m.promotion ?? ''), san: m.san };
  } catch {
    return null;
  }
}

export type GradeOptions = {
  depth: number;
  movetimeMs?: number;
  /** Lines already known for this position (best first), e.g. from the game analysis. Saves searches. */
  known?: EngineLine[];
  signal?: AbortSignal;
};

/**
 * Grades `uci` in `fen` with the same classifier as the game analysis: the best line's score
 * against the score of the move itself (searched on its own when no known line starts with it).
 */
export async function gradeMove(engine: Analyser, fen: string, uci: string, opts: GradeOptions): Promise<MoveGrade> {
  const move = legalMove(fen, uci.slice(0, 2), uci.slice(2, 4));
  if (!move) throw new Error(`Illegal move ${uci}`);
  const chess = new Chess(fen);
  const mover = chess.turn() as Colour;
  const forced = chess.moves().length === 1;
  const limits = { depth: opts.depth, movetimeMs: opts.movetimeMs };

  let lines = opts.known?.filter((l) => l.pvUci.length > 0) ?? [];
  if (lines.length === 0) {
    lines = (await engine.analyse({ fen, ...limits, multiPv: 1 }, { signal: opts.signal })).lines;
  }
  const best = lines[0];
  if (!best) throw new Error('No engine result for this position.');

  let played = lines.find((l) => l.pvUci[0] === move.uci);
  if (!played) {
    const r = await engine.analyse({ fen, ...limits, multiPv: 1, searchMoves: [move.uci] }, { signal: opts.signal });
    played = r.lines[0];
  }
  if (!played) throw new Error('The move could not be scored.');

  const c = classifyMove({ mover, playedUci: move.uci, bestUci: best.pvUci[0], best: best.score, played: played.score, forced });
  return { uci: move.uci, san: move.san, category: c.category, played: played.score, best: best.score, bestUci: best.pvUci[0] };
}

export const gradeKey = (fen: string, uci: string) => `${fen}|${uci}`;
