import {
  evaluateBrilliance,
  BRILLIANCY_VERSION,
  type BrillianceEvidence,
  type BrillianceInput,
  type ShallowRankSample,
} from '../../core/brilliancy/detector';
import { detectSacrifice } from '../../core/brilliancy/sacrifice';
import {
  classifyMove,
  DEFAULT_POLICY,
  CATEGORY_ORDER,
  type ClassifierPolicy,
  type MoveCategory,
} from '../../core/classification/classify';
import type { GameRecord, MoveRecord } from '../../core/chess/types';
import type { EngineClient } from '../../core/engine/EngineClient';
import { EngineError, type EngineLine, type PositionAnalysis, type SearchRequest } from '../../core/engine/types';
import { ACCURACY_VERSION, gameAccuracy } from '../../core/scoring/accuracy';
import { cpFor, expectedScore } from '../../core/scoring/score';
import { analysisCacheKey, type AnalysisCache } from './cache';
import type { AnalysisPreset, ColourSummary, GameAnalysis, MoveAnalysis } from './types';

export type RunOptions = {
  signal?: AbortSignal;
  onUpdate?: (state: GameAnalysis) => void;
  /** Resume from a previous (partial) analysis of the same game. */
  previous?: GameAnalysis;
  skipBrilliancy?: boolean;
};

/** The subset of EngineClient the orchestrator needs (eases testing). */
export type EngineLike = Pick<EngineClient, 'analyse' | 'init' | 'info'>;

export class GameAnalyser {
  constructor(
    private readonly engine: EngineLike,
    private readonly cache: AnalysisCache,
    private readonly preset: AnalysisPreset,
    private readonly policy: ClassifierPolicy = DEFAULT_POLICY,
  ) {}

  /** Runs a cached search: identical requests on the same engine build are never repeated. */
  async search(req: SearchRequest, signal?: AbortSignal): Promise<PositionAnalysis> {
    const key = analysisCacheKey(this.engine.info.id, req);
    const hit = await this.cache.get(key);
    if (hit && !hit.stopped) return hit;
    const res = await this.engine.analyse(req, { signal });
    if (!res.stopped) await this.cache.set(key, res);
    return res;
  }

  async run(game: GameRecord, opts: RunOptions = {}): Promise<GameAnalysis> {
    const { signal } = opts;
    const n = game.moves.length;
    const now = () => new Date().toISOString();
    const state: GameAnalysis = {
      gameId: game.id,
      presetId: this.preset.id,
      engineId: this.engine.info.id,
      policyVersion: this.policy.version,
      accuracyVersion: ACCURACY_VERSION,
      brilliancyVersion: BRILLIANCY_VERSION,
      moves: new Array(n).fill(undefined),
      positionEvals: new Array(n + 1).fill(undefined),
      phase: 'loading-engine',
      progress: { done: 0, total: n + 1, label: 'Loading engine…' },
      startedAt: now(),
      updatedAt: now(),
    };
    const emit = () => {
      state.updatedAt = now();
      state.summary = summarise(game, state);
      opts.onUpdate?.({ ...state, moves: [...state.moves], positionEvals: [...state.positionEvals] });
    };

    try {
      emit();
      await this.engine.init();
      state.engineId = this.engine.info.id;

      // ---- Pass 1: every pre-move position at a fast depth, MultiPV 2 ----
      state.phase = 'first-pass';
      const roots: (PositionAnalysis | undefined)[] = new Array(n + 1).fill(undefined);
      for (let i = 0; i <= n; i++) {
        throwIfAborted(signal);
        const fen = i === 0 ? game.initialFen : game.moves[i - 1]!.fenAfter;
        state.progress = { done: i, total: n + 1, label: `Position ${i}/${n}` };
        roots[i] = await this.search(this.rootRequest(fen, this.preset.firstPassDepth), signal);
        state.positionEvals[i] = roots[i]!.lines[0]?.score;
        if (i > 0) state.moves[i - 1] = await this.scoreMove(game.moves[i - 1]!, roots[i - 1]!, 'first', signal);
        emit();
      }

      // ---- Pass 2: deeper look at interesting positions ----
      state.phase = 'deep-pass';
      const interesting = state.moves
        .map((m, idx) => ({ m, idx }))
        .filter(({ m }) => m && this.isInteresting(m))
        .slice(0, this.preset.maxDeepPositions);
      for (let k = 0; k < interesting.length; k++) {
        throwIfAborted(signal);
        const { idx } = interesting[k]!;
        const mv = game.moves[idx]!;
        state.progress = { done: k, total: interesting.length, label: `Deep check ${k + 1}/${interesting.length}` };
        emit();
        const root = await this.search(this.rootRequest(mv.fenBefore, this.preset.deepPassDepth), signal);
        const deeper = await this.scoreMove(mv, root, 'deep', signal);
        deeper.passes = [...(state.moves[idx]?.passes ?? []), 'deep'];
        state.moves[idx] = deeper;
        state.positionEvals[idx] = root.lines[0]?.score ?? state.positionEvals[idx];
      }

      // ---- Pass 3: experimental brilliancy detector on a few candidates ----
      if (!opts.skipBrilliancy) {
        state.phase = 'brilliancy';
        const candidates = this.brilliancyCandidates(game, state, roots);
        for (let k = 0; k < candidates.length; k++) {
          throwIfAborted(signal);
          const idx = candidates[k]!;
          state.progress = { done: k, total: candidates.length, label: `Brilliancy check ${k + 1}/${candidates.length}` };
          emit();
          let result;
          try {
            result = await this.checkBrilliance(game.moves[idx]!, signal);
          } catch (e) {
            if (e instanceof EngineError && e.code === 'cancelled') throw e;
            continue; // a failed research check never blocks the review
          }
          const current = state.moves[idx]!;
          const reclass = classifyMove(
            {
              mover: current.colour,
              playedUci: current.uci,
              bestUci: current.bestMoveUci,
              best: current.bestScore!,
              played: current.playedScore!,
              forced: current.forced,
              brilliant: result.verdict === 'brilliant',
            },
            this.policy,
          );
          state.moves[idx] = {
            ...current,
            brilliance: result,
            category: reclass.category,
            reasons: result.verdict !== 'none' ? [...reclass.reasons, ...result.reasons] : reclass.reasons,
            passes: [...current.passes, 'brilliancy'],
          };
        }
      }

      for (const m of state.moves) if (m) m.provisional = false;
      state.phase = 'done';
      state.progress = { done: 1, total: 1, label: 'Complete' };
      emit();
      return state;
    } catch (e) {
      const cancelled = (e instanceof EngineError && e.code === 'cancelled') || (e as Error).name === 'AbortError';
      state.phase = cancelled ? 'cancelled' : 'error';
      state.error = cancelled ? undefined : (e as Error).message;
      state.progress = { ...state.progress, label: cancelled ? 'Cancelled' : 'Failed' };
      emit();
      return state;
    }
  }

  rootRequest(fen: string, depth: number): SearchRequest {
    return { fen, depth, multiPv: 2, movetimeMs: this.preset.movetimeCapMs };
  }

  /**
   * Method B from the handoff: compare the root search with a restricted-root search
   * (`searchmoves <played>`) of the same position at the same depth, unless the played move
   * is already one of the root MultiPV lines.
   */
  private async scoreMove(
    mv: MoveRecord,
    root: PositionAnalysis,
    pass: 'first' | 'deep',
    signal?: AbortSignal,
  ): Promise<MoveAnalysis> {
    const best = root.lines[0];
    const forced = mv.legalMoveCount <= 1;
    const base: MoveAnalysis = {
      ply: mv.ply,
      colour: mv.colour,
      san: mv.san,
      uci: mv.uci,
      depth: root.completedDepth,
      lines: root.lines,
      reasons: [],
      forced,
      provisional: true,
      passes: [pass],
    };
    if (!best) return { ...base, reasons: ['No engine result for this position.'] };

    let played: EngineLine | undefined = root.lines.find((l) => l.pvUci[0] === mv.uci);
    let method: MoveAnalysis['playedScoreMethod'] = 'root-multipv';
    if (!played) {
      const restricted = await this.search(
        { fen: mv.fenBefore, depth: root.requestedDepth, multiPv: 1, searchMoves: [mv.uci], movetimeMs: this.preset.movetimeCapMs },
        signal,
      );
      played = restricted.lines[0];
      method = 'searchmoves';
    }
    if (!played) return { ...base, bestMoveUci: best.pvUci[0], bestScore: best.score, reasons: ['Played move could not be scored.'] };

    const c = classifyMove(
      { mover: mv.colour, playedUci: mv.uci, bestUci: best.pvUci[0], best: best.score, played: played.score, forced },
      this.policy,
    );
    return {
      ...base,
      bestMoveUci: best.pvUci[0],
      bestScore: best.score,
      playedScore: played.score,
      secondScore: root.lines[1]?.score,
      playedScoreMethod: method,
      loss: c.loss,
      category: c.category,
      reasons: c.reasons,
    };
  }

  private isInteresting(m: MoveAnalysis): boolean {
    if (!m.category || m.forced) return false;
    if (m.category === 'questionable' || m.category === 'mistake' || m.category === 'blunder') return true;
    if (m.bestScore?.kind === 'mate' || m.playedScore?.kind === 'mate') return true;
    const l = m.loss?.expectedLossPct ?? 0;
    // Near a threshold: re-check so labels are not decided by search noise.
    return Math.abs(l - this.policy.goodMaxLossPct) < 1.5;
  }

  private brilliancyCandidates(game: GameRecord, state: GameAnalysis, roots: (PositionAnalysis | undefined)[]): number[] {
    const scored: { idx: number; weight: number }[] = [];
    state.moves.forEach((m, idx) => {
      if (!m || m.forced || m.category !== 'best' || !m.bestScore || !m.playedScore) return;
      const mv = game.moves[idx]!;
      if (mv.legalMoveCount < 3) return;
      const root = roots[idx];
      // Was the played move NOT the top choice at some shallow iteration of the first pass?
      const shallowMiss = (root?.byDepth ?? []).some((d) => d.depth <= 6 && d.lines[0] && d.lines[0].pvUci[0] !== mv.uci);
      const line = m.lines.find((l) => l.pvUci[0] === mv.uci)?.pvUci ?? [mv.uci];
      const sac = detectSacrifice(mv.fenBefore, line).isSacrifice;
      const gap =
        m.secondScore !== undefined
          ? (expectedScore(m.bestScore, m.colour) - expectedScore(m.secondScore, m.colour)) * 100
          : 0;
      const weight = (shallowMiss ? 2 : 0) + (sac ? 2 : 0) + (gap >= 15 ? 1 : 0);
      if (weight >= 2) scored.push({ idx, weight: weight + gap / 100 });
    });
    return scored
      .sort((a, b) => b.weight - a.weight)
      .slice(0, this.preset.maxBrilliancyCandidates)
      .map((s) => s.idx)
      .sort((a, b) => a - b);
  }

  /** Collects depth-by-depth evidence for one move and runs the detector. */
  async checkBrilliance(mv: MoveRecord, signal?: AbortSignal): Promise<BrillianceEvidence> {
    return evaluateBrilliance(await this.collectBrillianceInput(mv, signal));
  }

  /** Runs the searches the detector needs (all with a cleared hash for reproducibility). */
  async collectBrillianceInput(mv: MoveRecord, signal?: AbortSignal): Promise<BrillianceInput> {
    const p = this.preset;
    const multiPv = Math.min(mv.legalMoveCount, 64);
    // Full-width shallow root search: exact rank of the played move at each depth 1..N.
    const shallowRun = await this.search({ fen: mv.fenBefore, depth: p.brilliancyShallowDepth, multiPv, clearHash: true }, signal);
    const shallow: ShallowRankSample[] = shallowRun.byDepth.map((d) => {
      const idx = d.lines.findIndex((l) => l.pvUci[0] === mv.uci);
      return {
        depth: d.depth,
        playedRank: idx >= 0 ? d.lines[idx]!.rank : null,
        sampledLines: d.lines.length,
        legalMoves: mv.legalMoveCount,
        bestScore: d.lines[0]!.score,
        playedScore: idx >= 0 ? d.lines[idx]!.score : undefined,
      };
    });
    // Same played move, every depth (restricted root search, fresh hash).
    const trajRun = await this.search(
      { fen: mv.fenBefore, depth: p.brilliancyDeepDepth, multiPv: 1, searchMoves: [mv.uci], clearHash: true },
      signal,
    );
    const trajectory = trajRun.byDepth.filter((d) => d.lines[0]).map((d) => ({ depth: d.depth, score: d.lines[0]!.score }));
    const deepRoot = await this.search({ fen: mv.fenBefore, depth: p.brilliancyDeepDepth, multiPv: 2, clearHash: true }, signal);
    const playedDeep = trajRun.lines[0]?.score ?? deepRoot.lines[0]!.score;
    const recheckRoot = await this.search({ fen: mv.fenBefore, depth: p.recheckDepth, multiPv: 2, clearHash: true }, signal);
    let recheckPlayed = recheckRoot.lines.find((l) => l.pvUci[0] === mv.uci)?.score;
    if (!recheckPlayed) {
      const r = await this.search({ fen: mv.fenBefore, depth: p.recheckDepth, multiPv: 1, searchMoves: [mv.uci], clearHash: true }, signal);
      recheckPlayed = r.lines[0]?.score;
    }
    const line = trajRun.lines[0]?.pvUci ?? [mv.uci];
    return {
      mover: mv.colour,
      playedUci: mv.uci,
      shallow,
      trajectory,
      deep: {
        depth: deepRoot.completedDepth,
        bestUci: deepRoot.lines[0]?.pvUci[0] ?? '',
        bestScore: deepRoot.lines[0]!.score,
        secondScore: deepRoot.lines[1]?.score,
        playedScore: playedDeep,
      },
      recheck:
        recheckRoot.lines[0] && recheckPlayed
          ? {
              depth: recheckRoot.completedDepth,
              bestUci: recheckRoot.lines[0].pvUci[0] ?? '',
              bestScore: recheckRoot.lines[0].score,
              secondScore: recheckRoot.lines[1]?.score,
              playedScore: recheckPlayed,
            }
          : undefined,
      sacrifice: detectSacrifice(mv.fenBefore, line),
    };
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new EngineError('cancelled', 'Analysis cancelled.');
}

function emptyCounts(): Record<MoveCategory, number> {
  return Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<MoveCategory, number>;
}

export function summarise(game: GameRecord, state: Pick<GameAnalysis, 'moves'>): { white: ColourSummary; black: ColourSummary } {
  const make = (colour: 'w' | 'b'): ColourSummary => {
    const own = game.moves.map((mv, i) => ({ mv, a: state.moves[i] })).filter(({ mv }) => mv.colour === colour);
    const counts = emptyCounts();
    const cpl: number[] = [];
    for (const { a } of own) {
      if (a?.category) counts[a.category]++;
      if (a?.loss?.centipawnLoss !== undefined && !a.forced) cpl.push(Math.min(a.loss.centipawnLoss, 1000));
    }
    const accuracy = gameAccuracy(own.map(({ mv, a }) => ({ expectedLossPct: a?.loss?.expectedLossPct, forced: mv.legalMoveCount <= 1 })));
    const provider = colour === 'w' ? game.providerData?.accuracies?.white : game.providerData?.accuracies?.black;
    return {
      accuracy,
      averageCpLoss: cpl.length ? Math.round(cpl.reduce((s, x) => s + x, 0) / cpl.length) : undefined,
      counts,
      providerAccuracy: provider,
    };
  };
  return { white: make('w'), black: make('b') };
}

/** Exposed for UI: mover-relative centipawns of a white-relative score (undefined for mates). */
export const moverCp = cpFor;
