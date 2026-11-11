import type { MoveRecord } from '../../core/chess/types';
import {
  describeThreat,
  describeThreats,
  explainBadMove,
  nullMoveFen,
  type ExplainLine,
  type PositionThreats,
  type WhyBadReport,
} from '../../core/explain/whyBad';
import type { PositionAnalysis, SearchRequest } from '../../core/engine/types';
import type { AnalysisCache } from '../analysis/cache';
import { GameAnalyser, type EngineLike } from '../analysis/orchestrator';
import type { AnalysisPreset } from '../analysis/types';

/**
 * On-demand searches for "why was this move bad?" and "what does the opponent threaten?".
 * Separate from the game analysis: nothing here changes a stored GameAnalysis. Engine results
 * go through the same cache, so asking again is instant.
 */
export class MoveExplainer {
  private readonly analyser: GameAnalyser;

  constructor(
    engine: EngineLike,
    cache: AnalysisCache,
    private readonly preset: AnalysisPreset,
  ) {
    this.analyser = new GameAnalyser(engine, cache, preset);
  }

  private search(fen: string, extra: Partial<SearchRequest>, signal?: AbortSignal): Promise<PositionAnalysis> {
    return this.analyser.search({ fen, depth: this.preset.deepPassDepth, movetimeMs: this.preset.movetimeCapMs, multiPv: 1, ...extra }, signal);
  }

  /** Up to 3 opponent lines if the side to move could pass (its threats). */
  private threatLines(nf: string, signal?: AbortSignal): Promise<ExplainLine[]> {
    return this.search(nf, { multiPv: 3 }, signal).then((r) => r.lines.map((l) => ({ uci: l.pvUci, score: l.score })));
  }

  /** The opponent's threats in `fen` (as if the side to move passed); null when in check. */
  async threats(fen: string, signal?: AbortSignal): Promise<PositionThreats | null> {
    const nf = nullMoveFen(fen);
    if (!nf) return null;
    const [root, lines] = await Promise.all([this.search(fen, {}, signal), this.threatLines(nf, signal)]);
    const best = root.lines[0];
    const main = best && lines[0] ? describeThreat(fen, best.score, lines[0]) : undefined;
    if (!best || !main) return null;
    return { main, real: describeThreats(fen, best.score, lines) };
  }

  /** Why the played move lost expected score: threat ignored, opportunity missed, tactic allowed… */
  async whyBad(mv: MoveRecord, signal?: AbortSignal): Promise<WhyBadReport> {
    const nf = nullMoveFen(mv.fenBefore);
    const [root, played, pass] = await Promise.all([
      this.search(mv.fenBefore, { multiPv: Math.min(3, mv.legalMoveCount) }, signal),
      this.search(mv.fenBefore, { searchMoves: [mv.uci] }, signal),
      nf ? this.threatLines(nf, signal) : Promise.resolve(undefined),
    ]);
    const playedLine = played.lines[0];
    if (!root.lines[0] || !playedLine) throw new Error('The engine returned no lines for this position.');
    return explainBadMove({
      fenBefore: mv.fenBefore,
      mover: mv.colour,
      playedUci: mv.uci,
      lines: root.lines.map((l) => ({ uci: l.pvUci, score: l.score })),
      played: { uci: playedLine.pvUci, score: playedLine.score },
      threats: pass,
    });
  }
}
