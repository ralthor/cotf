import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEngine } from '../../app/EngineContext';
import { forEachConcurrent } from '../../core/engine/EnginePool';
import type { OpeningGame } from '../../core/repertoire/games';
import { walkGame, type ImprovementRule } from '../../core/repertoire/insights';
import { dbPliesNeeded, dbValueAt, engineValue, openingLoss, type LossSource, type OpeningLoss, type ValueAt } from '../../core/repertoire/openingLoss';
import { engineEvalStore, type EngineEval } from '../../storage/db';
import { getPref, setPref } from '../../storage/prefs';
import type { Analyser } from '../explore/grade';
import type { ExplorerResult } from './explorer';
import { runPaced, type PacedProgress } from './paced';

/** Engine depths offered: quick, normal, deep. */
export const LOSS_DEPTHS = [10, 14, 18] as const;
const DEFAULT_DEPTH = 14;
/** Rounds of database lookups: the positions before your moves, then after the rare ones. */
const DB_ROUNDS = 2;

export type EvalMap = ReadonlyMap<string, EngineEval>;

/** The database side, from `useInsights`: saved answers by FEN, loading saved ones, and fetching. */
export type DbAccess = {
  cachedFen: (fen: string) => ExplorerResult | undefined;
  loadFens: (fens: readonly string[]) => Promise<void>;
  fetchFen: (fen: string, signal?: AbortSignal) => Promise<ExplorerResult>;
  rule: ImprovementRule;
  /** Changes whenever the saved answers change. */
  version: unknown;
};

const evalKey = (posKey: string, depth: number) => `${posKey}|${depth}`;

/** One engine search: the score (White's view) and line, or null for a finished game. */
async function analyse(engine: Analyser, fen: string, depth: number, signal?: AbortSignal): Promise<EngineEval | null> {
  const r = await engine.analyse({ fen, depth, multiPv: 1 }, { signal });
  const l = r.lines[0];
  return l ? { score: l.score, depth: l.depth, pv: l.pvUci.slice(0, 12) } : null;
}

function readSource(): LossSource {
  return getPref('lossSource') === 'database' ? 'database' : 'engine';
}
function readDepth(): number {
  const d = Number(getPref('lossDepth'));
  return (LOSS_DEPTHS as readonly number[]).includes(d) ? d : DEFAULT_DEPTH;
}

/**
 * Where your recent games went wrong in the opening: from Stockfish in this browser (evaluations
 * kept in IndexedDB) or from the opening database's results. `games` in any order.
 */
export function useOpeningLosses(games: readonly OpeningGame[], maxPly: number, scanGames: number, db: DbAccess) {
  const recent = useMemo(
    () => [...games].filter((g) => g.result !== '*').sort((a, b) => b.playedAt.localeCompare(a.playedAt)).slice(0, scanGames),
    [games, scanGames],
  );
  const [source, setSourceState] = useState<LossSource>(readSource);
  const [depth, setDepthState] = useState<number>(readDepth);
  const setSource = (s: LossSource) => {
    setPref('lossSource', s);
    setSourceState(s);
  };
  const setDepth = (d: number) => {
    setPref('lossDepth', String(d));
    setDepthState(d);
  };
  const { getEngine } = useEngine();
  const [evals, setEvals] = useState<EvalMap>(new Map());
  const [loadedFor, setLoadedFor] = useState<{ recent: unknown; depth: number; source: LossSource } | null>(null);
  const [scan, setScan] = useState<PacedProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Saved answers for every position of these games in the opening (both sides: the game player uses them too).
  const { loadFens } = db;
  useEffect(() => {
    let live = true;
    void (async () => {
      const keys = new Set<string>();
      const fens = new Set<string>();
      for (const g of recent) {
        const w = walkGame(g, maxPly);
        for (const k of w.keys) keys.add(k);
        if (source === 'database') for (const f of w.fens) fens.add(f);
      }
      if (source === 'database') await loadFens([...fens]);
      const got = await engineEvalStore.getMany([...keys].map((k) => evalKey(k, depth)));
      const map = new Map<string, EngineEval>();
      for (const k of keys) {
        const e = got.get(evalKey(k, depth));
        if (e) map.set(k, e);
      }
      if (live) {
        setEvals(map);
        setLoadedFor({ recent, depth, source });
      }
    })();
    return () => {
      live = false;
    };
  }, [recent, maxPly, depth, source, loadFens]);

  useEffect(() => () => abort.current?.abort(), []);

  /** The value of each ply of a game, from the chosen source. */
  const { cachedFen, rule, version } = db;
  const valueFor = useCallback(
    (game: OpeningGame): ValueAt => {
      const w = walkGame(game, maxPly);
      if (source === 'database') return dbValueAt(game, maxPly, (p) => (w.fens[p] ? cachedFen(w.fens[p]!) : undefined), rule);
      return (p) => {
        const e = w.keys[p] !== undefined ? evals.get(w.keys[p]!) : undefined;
        return e ? engineValue(e) : undefined;
      };
    },
    // `version` changes with the saved database answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, maxPly, evals, cachedFen, rule, version],
  );

  const losses = useMemo(() => recent.map((g) => openingLoss(g, maxPly, valueFor(g))), [recent, maxPly, valueFor]);

  /** Positions still to look at, without repeats. */
  const todoItems = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of recent) {
      const w = walkGame(g, maxPly);
      const last = Math.min(maxPly, w.keys.length - 1);
      if (source === 'engine') {
        for (let p = 0; p <= last; p++) if (!evals.has(w.keys[p]!)) seen.set(w.keys[p]!, w.fens[p]!);
      } else {
        const resultAt = (p: number) => cachedFen(w.fens[p]!);
        for (const p of dbPliesNeeded(g, maxPly, resultAt, (p) => !!resultAt(p))) seen.set(w.fens[p]!, w.fens[p]!);
      }
    }
    return [...seen].map(([key, fen]) => ({ key, fen }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, maxPly, source, evals, cachedFen, version]);

  // Engine results arrive fast; they are shown in batches.
  const pending = useRef(new Map<string, EngineEval>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    flushTimer.current = null;
    const add = pending.current;
    pending.current = new Map();
    if (add.size) setEvals((m) => new Map([...m, ...add]));
  }, []);
  const remember = useCallback(
    (key: string, e: EngineEval) => {
      pending.current.set(key, e);
      void engineEvalStore.put(evalKey(key, depth), e);
      flushTimer.current ??= setTimeout(flush, 400);
    },
    [depth, flush],
  );

  /** Analyses positions with the engines in this browser, each game's positions on one engine in order. */
  const analyseMany = useCallback(
    async (groups: { key: string; fen: string }[][], ctl: AbortController) => {
      const pool = await getEngine();
      const total = groups.reduce((a, g) => a + g.length, 0);
      const started = new Set<string>();
      let done = 0;
      setScan({ done, total });
      await forEachConcurrent(groups, pool.size, async (group) => {
        const mine = group.filter((it) => !started.has(it.key));
        for (const it of mine) started.add(it.key);
        if (!mine.length || ctl.signal.aborted) {
          done += group.length;
          return;
        }
        done += group.length - mine.length;
        await pool.withEngine(async (engine) => {
          for (const it of mine) {
            if (ctl.signal.aborted) return;
            const e = await analyse(engine, it.fen, depth, ctl.signal);
            if (e) remember(it.key, e);
            setScan({ done: ++done, total });
          }
        }, ctl.signal);
      });
    },
    [getEngine, depth, remember],
  );

  const run = useCallback(
    async (work: (ctl: AbortController) => Promise<string | null | void>) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setError(null);
      try {
        const err = await work(ctl);
        if (err) setError(err);
      } catch {
        if (!ctl.signal.aborted) setError('engine');
      } finally {
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flush();
        if (abort.current === ctl) abort.current = null;
        setScan(null);
      }
    },
    [flush],
  );

  /** Looks at the positions still missing. */
  const startScan = useCallback(
    () =>
      run(async (ctl) => {
        if (source === 'engine') {
          const groups = recent.map((g) => {
            const w = walkGame(g, maxPly);
            const last = Math.min(maxPly, w.keys.length - 1);
            const out: { key: string; fen: string }[] = [];
            for (let p = 0; p <= last; p++) if (!evals.has(w.keys[p]!)) out.push({ key: w.keys[p]!, fen: w.fens[p]! });
            return out;
          });
          return analyseMany(groups.filter((g) => g.length), ctl);
        }
        // Database: the positions before your moves, then the ones after moves too rare in that list.
        const got = new Map<string, ExplorerResult>();
        const resultOf = (fen: string) => got.get(fen) ?? cachedFen(fen);
        for (let round = 0; round < DB_ROUNDS && !ctl.signal.aborted; round++) {
          const need = new Set<string>();
          for (const g of recent) {
            const w = walkGame(g, maxPly);
            const at = (p: number) => resultOf(w.fens[p]!);
            for (const p of dbPliesNeeded(g, maxPly, at, (p) => !!at(p))) need.add(w.fens[p]!);
          }
          if (!need.size) break;
          const err = await runPaced([...need], async (fen, signal) => void got.set(fen, await db.fetchFen(fen, signal)), ctl.signal, setScan);
          if (err) return err;
        }
        return null;
      }),
    [run, source, recent, maxPly, evals, analyseMany, cachedFen, db],
  );

  const stopScan = useCallback(() => abort.current?.abort(), []);

  /** Engine evaluations for a list of positions (the better-moves table). */
  const analyseList = useCallback(
    (items: readonly { key: string; fen: string }[]) => run((ctl) => analyseMany(items.map((it) => [it]), ctl)),
    [run, analyseMany],
  );

  /** One position now, with the engine (the game player), unless it is known. */
  const one = useRef<AbortController | null>(null);
  const analyseOne = useCallback(
    async (key: string, fen: string) => {
      if (evals.has(key)) return;
      one.current?.abort();
      const ctl = new AbortController();
      one.current = ctl;
      try {
        const pool = await getEngine();
        const e = await analyse(pool, fen, depth, ctl.signal);
        if (e && !ctl.signal.aborted) {
          void engineEvalStore.put(evalKey(key, depth), e);
          setEvals((m) => new Map(m).set(key, e));
        }
      } catch {
        // cancelled, or the engine failed: the player shows "not analysed"
      }
    },
    [evals, getEngine, depth],
  );

  const byGame = useMemo(() => new Map<string, OpeningLoss>(losses.map((l) => [l.game.id, l])), [losses]);

  return {
    recent,
    losses,
    byGame,
    evals,
    valueFor,
    source,
    setSource,
    depth,
    setDepth,
    loaded: loadedFor?.recent === recent && loadedFor.depth === depth && loadedFor.source === source,
    todo: todoItems.length,
    scan,
    startScan,
    stopScan,
    analyseList,
    analyseOne,
    error,
  };
}
