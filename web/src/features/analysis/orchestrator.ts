import {
  evaluateBrilliance,
  BRILLIANCY_VERSION,
  type BrillianceEvidence,
  type BrillianceInput,
  type ShallowSample,
  BRILLIANCY_POLICY,
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
import { forEachConcurrent } from '../../core/engine/EnginePool';
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

/**
 * The subset of EngineClient the orchestrator needs (eases testing). An EnginePool also fits:
 * `size` is how many searches it can run at once (1 for a single engine).
 */
export type EngineLike = Pick<EngineClient, 'analyse' | 'init' | 'info'> & {
  readonly size?: number;
  /** Runs `fn` with one engine reserved for it (EnginePool); a single engine is simply passed. */
  withEngine?: <T>(fn: (engine: Pick<EngineClient, 'analyse'>) => Promise<T>, signal?: AbortSignal) => Promise<T>;
};

export class GameAnalyser {
  constructor(
    private readonly engine: EngineLike,
    private readonly cache: AnalysisCache,
    private readonly preset: AnalysisPreset,
    private readonly policy: ClassifierPolicy = DEFAULT_POLICY,
  ) {}

  /** Searches that can run at once: one per engine in a pool. */
  private get parallel(): number {
    return Math.max(1, this.engine.size ?? 1);
  }

  /**
   * Runs a cached search: identical requests on the same engine build are never repeated.
   * `on` pins it to a reserved engine (see `withEngine`).
   */
  async search(req: SearchRequest, signal?: AbortSignal, on?: Pick<EngineClient, 'analyse'>): Promise<PositionAnalysis> {
    const key = analysisCacheKey(this.engine.info.id, req);
    const hit = await this.cache.get(key);
    if (hit && !hit.stopped) return hit;
    const res = await (on ?? this.engine).analyse(req, { signal });
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
      // Positions are independent, but consecutive positions share most of their search tree, so
      // each engine takes a run of consecutive positions and keeps its hash between them.
      state.phase = 'first-pass';
      const roots: (PositionAnalysis | undefined)[] = new Array(n + 1).fill(undefined);
      let done = 0;
      state.progress = { done: 0, total: n + 1, label: `Position 0/${n}` };
      await forEachConcurrent(consecutiveChunks(n + 1, this.parallel), this.parallel, (chunk) =>
        this.withEngine(async (on) => {
          for (const i of chunk) {
            throwIfAborted(signal);
            const fen = i === 0 ? game.initialFen : game.moves[i - 1]!.fenAfter;
            roots[i] = await this.search(this.rootRequest(fen, this.preset.firstPassDepth), signal, on);
            state.positionEvals[i] = roots[i]!.lines[0]?.score;
            if (i < n) state.moves[i] = await this.scoreMove(game.moves[i]!, roots[i]!, 'first', signal, on);
            done++;
            state.progress = { done, total: n + 1, label: `Position ${done}/${n + 1}` };
            emit();
          }
        }, signal),
      );

      // ---- Pass 2: deeper look at interesting positions ----
      state.phase = 'deep-pass';
      const interesting = state.moves
        .map((m, idx) => ({ m, idx }))
        .filter(({ m }) => m && this.isInteresting(m))
        .slice(0, this.preset.maxDeepPositions);
      done = 0;
      state.progress = { done: 0, total: interesting.length, label: `Deep check 0/${interesting.length}` };
      emit();
      await forEachConcurrent(interesting, this.parallel, async ({ idx }) => {
        throwIfAborted(signal);
        const mv = game.moves[idx]!;
        const deeper = await this.withEngine(async (on) => {
          const root = await this.search(this.rootRequest(mv.fenBefore, this.preset.deepPassDepth), signal, on);
          return { root, analysis: await this.scoreMove(mv, root, 'deep', signal, on) };
        }, signal);
        const root = deeper.root;
        deeper.analysis.passes = [...(state.moves[idx]?.passes ?? []), 'deep'];
        state.moves[idx] = deeper.analysis;
        state.positionEvals[idx] = root.lines[0]?.score ?? state.positionEvals[idx];
        done++;
        state.progress = { done, total: interesting.length, label: `Deep check ${done}/${interesting.length}` };
        emit();
      });

      // ---- Pass 3: experimental brilliancy detector on a few candidates ----
      if (!opts.skipBrilliancy) {
        state.phase = 'brilliancy';
        const candidates = this.brilliancyCandidates(game, state, roots);
        done = 0;
        state.progress = { done: 0, total: candidates.length, label: `Brilliancy check 0/${candidates.length}` };
        emit();
        // Each check's own searches also run in parallel, so one candidate at a time per ~4 engines.
        await forEachConcurrent(candidates, Math.max(1, Math.ceil(this.parallel / 4)), async (idx) => {
          throwIfAborted(signal);
          let result;
          try {
            result = await this.checkBrilliance(game.moves[idx]!, signal);
          } catch (e) {
            if (e instanceof EngineError && e.code === 'cancelled') throw e;
            return; // a failed research check never blocks the review
          } finally {
            done++;
            state.progress = { done, total: candidates.length, label: `Brilliancy check ${done}/${candidates.length}` };
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
          emit();
        });
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

  /** Reserves one engine for `fn` when the engine is a pool; otherwise uses the single engine. */
  private withEngine<T>(fn: (on: Pick<EngineClient, 'analyse'>) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.engine.withEngine ? this.engine.withEngine(fn, signal) : fn(this.engine);
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
    on?: Pick<EngineClient, 'analyse'>,
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
        on,
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
      playedPv: played.pvUci,
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
      // Within the shallow horizon, did the first pass prefer another move?
      const horizon = this.preset.brilliancyShallowDepth;
      const shallowMiss = (root?.byDepth ?? []).some((d) => d.depth <= horizon && d.lines[0] && d.lines[0].pvUci[0] !== mv.uci);
      const line = m.lines.find((l) => l.pvUci[0] === mv.uci)?.pvUci ?? [mv.uci];
      const sac = detectSacrifice(mv.fenBefore, line).isSacrifice;
      const gap =
        m.secondScore !== undefined
          ? (expectedScore(m.bestScore, m.colour) - expectedScore(m.secondScore, m.colour)) * 100
          : 0;
      // Need two of: missed at shallow depth, decisive (clearly better than the 2nd move), sacrifice.
      const decisive = m.secondScore === undefined || gap >= BRILLIANCY_POLICY.minUniquenessPct;
      const weight = (shallowMiss ? 2 : 0) + (sac ? 2 : 0) + (decisive ? 2 : 0);
      if (weight >= 4) scored.push({ idx, weight: weight + gap / 100 });
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
    // The four searches are independent (each clears its own engine's hash), so with an engine
    // pool they run at the same time.
    // - Full-width search to the shallow horizon (default 3 plies): every legal move is scored at
    //   every depth 1..horizon, so the played move's shallow score and rank are exact.
    // - The same played move at every depth (restricted root search).
    // - Full depth, and a deeper recheck.
    const [shallowRun, trajRun, deepRoot, recheckRoot] = await Promise.all([
      this.search({ fen: mv.fenBefore, depth: p.brilliancyShallowDepth, multiPv: mv.legalMoveCount, clearHash: true }, signal),
      this.search({ fen: mv.fenBefore, depth: p.brilliancyDeepDepth, multiPv: 1, searchMoves: [mv.uci], clearHash: true }, signal),
      this.search({ fen: mv.fenBefore, depth: p.brilliancyDeepDepth, multiPv: 2, clearHash: true }, signal),
      this.search({ fen: mv.fenBefore, depth: p.recheckDepth, multiPv: 2, clearHash: true }, signal),
    ]);
    const shallow: ShallowSample[] = shallowRun.byDepth
      .filter((d) => d.depth <= p.brilliancyShallowDepth && d.lines[0])
      .map((d) => {
        const idx = d.lines.findIndex((l) => l.pvUci[0] === mv.uci);
        return {
          depth: d.depth,
          playedRank: idx >= 0 ? d.lines[idx]!.rank : null,
          sampledLines: d.lines.length,
          legalMoves: mv.legalMoveCount,
          bestUci: d.lines[0]!.pvUci[0] ?? '',
          bestScore: d.lines[0]!.score,
          playedScore: idx >= 0 ? d.lines[idx]!.score : undefined,
        };
      });
    const trajectory = trajRun.byDepth.filter((d) => d.lines[0]).map((d) => ({ depth: d.depth, score: d.lines[0]!.score }));
    const playedDeep = trajRun.lines[0]?.score ?? deepRoot.lines[0]!.score;
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

/**
 * Splits 0..count-1 into runs of consecutive indices: about two runs per engine, so engines that
 * finish early can pick up another run while keeping most of the hash reuse.
 */
export function consecutiveChunks(count: number, engines: number): number[][] {
  const runs = Math.max(1, Math.min(count, engines === 1 ? 1 : engines * 2));
  const size = Math.ceil(count / runs);
  const out: number[][] = [];
  for (let start = 0; start < count; start += size) out.push(Array.from({ length: Math.min(size, count - start) }, (_, k) => start + k));
  return out;
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
