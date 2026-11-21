import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OpeningGame } from '../../core/repertoire/games';
import { walkGame } from '../../core/repertoire/insights';
import { openingLoss, pgnEvals, pliesToLookUp, refinePly, type EvalAt, type OpeningLoss } from '../../core/repertoire/openingLoss';
import { cloudEvalStore } from '../../storage/db';
import { cloudEval, type CloudEval } from './cloudEval';
import { runPaced, type PacedProgress } from './paced';

/** A position Lichess had no evaluation for is asked again after this long. */
const RETRY_MISS_MS = 30 * 24 * 3600 * 1000;
/** Rounds of "make the worst move exact": each can move the worst move to another one. */
const REFINE_ROUNDS = 3;

export type CloudMap = ReadonlyMap<string, CloudEval | null>;

const pgnEvalCache = new WeakMap<OpeningGame, ReturnType<typeof pgnEvals>>();
const pgnEvalsOf = (g: OpeningGame) => {
  let m = pgnEvalCache.get(g);
  if (!m) pgnEvalCache.set(g, (m = pgnEvals(g.pgn)));
  return m;
};

/** Evaluations for a game's plies: the game's own (analysed on Lichess) first, then cloud ones. */
export function evalAtFor(game: OpeningGame, maxPly: number, cloud: CloudMap): EvalAt {
  const own = pgnEvalsOf(game);
  const keys = walkGame(game, maxPly).keys;
  return (ply) => {
    const c = keys[ply] !== undefined ? cloud.get(keys[ply]!) : undefined;
    const o = own.get(ply);
    if (c) return { score: o ?? c.score, pv: c.pv };
    return o ? { score: o } : undefined;
  };
}

/** Position keys and FENs a game still needs from the cloud for its first pass. */
function missing(game: OpeningGame, maxPly: number, plies: readonly number[], cloud: CloudMap): { key: string; fen: string }[] {
  const own = pgnEvalsOf(game);
  const w = walkGame(game, maxPly);
  return plies.flatMap((p) => (own.has(p) && p !== 0 ? [] : w.keys[p] !== undefined && !cloud.has(w.keys[p]!) ? [{ key: w.keys[p]!, fen: w.fens[p]! }] : []));
}

/**
 * Where your recent games went wrong in the opening, from Lichess cloud evaluations (kept in
 * IndexedDB) and the evaluations of games you had analysed on Lichess. `games` newest first.
 */
export function useOpeningLosses(games: readonly OpeningGame[], maxPly: number, scanGames: number) {
  const recent = useMemo(
    () => [...games].filter((g) => g.result !== '*').sort((a, b) => b.playedAt.localeCompare(a.playedAt)).slice(0, scanGames),
    [games, scanGames],
  );
  const [cloud, setCloud] = useState<CloudMap>(new Map());
  const [loadedFor, setLoadedFor] = useState<unknown>(null);
  const [scan, setScan] = useState<PacedProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Cached evaluations for every position of these games in the opening (both sides: the game player uses them too).
  useEffect(() => {
    let live = true;
    void (async () => {
      const keys = new Set<string>();
      for (const g of recent) for (const k of walkGame(g, maxPly).keys) keys.add(k);
      const got = await cloudEvalStore.getMany([...keys]);
      const now = Date.now();
      const map = new Map<string, CloudEval | null>();
      for (const [k, v] of got) if (v.eval || now - Date.parse(v.at) < RETRY_MISS_MS) map.set(k, v.eval);
      if (live) {
        setCloud((old) => new Map([...map, ...old]));
        setLoadedFor(recent);
      }
    })();
    return () => {
      live = false;
    };
  }, [recent, maxPly]);

  useEffect(() => () => abort.current?.abort(), []);

  const losses = useMemo(() => recent.map((g) => openingLoss(g, maxPly, evalAtFor(g, maxPly, cloud))), [recent, maxPly, cloud]);

  /** Positions still to look up: the first pass, and the position before each game's worst move; without repeats. */
  const todo = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of recent) for (const m of missing(g, maxPly, pliesToLookUp(g, maxPly), cloud)) if (!seen.has(m.key)) seen.set(m.key, m.fen);
    for (const l of losses) {
      const p = refinePly(l);
      const w = walkGame(l.game, maxPly);
      if (p !== null && !cloud.has(w.keys[p]!)) seen.set(w.keys[p]!, w.fens[p]!);
    }
    return [...seen].map(([key, fen]) => ({ key, fen }));
  }, [recent, maxPly, cloud, losses]);

  const fetchOne = useCallback(async (key: string, fen: string, signal?: AbortSignal) => {
    const e = await cloudEval.get(fen, signal);
    await cloudEvalStore.put(key, e);
    setCloud((m) => new Map(m).set(key, e));
    return e;
  }, []);

  /** Looks up the positions still missing, then the ones that make each game's worst move exact. */
  const startScan = useCallback(async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    // The scan keeps its own copy, so each round sees what the last one found.
    let known = new Map(cloud);
    const put = async (it: { key: string; fen: string }, signal: AbortSignal) => {
      const e = await fetchOne(it.key, it.fen, signal);
      known = new Map(known).set(it.key, e);
    };
    try {
      let err = await runPaced(todo, put, ctl.signal, setScan);
      for (let round = 0; round < REFINE_ROUNDS && !err && !ctl.signal.aborted; round++) {
        const more = new Map<string, string>();
        for (const g of recent) {
          const p = refinePly(openingLoss(g, maxPly, evalAtFor(g, maxPly, known)));
          const w = walkGame(g, maxPly);
          if (p !== null && !known.has(w.keys[p]!)) more.set(w.keys[p]!, w.fens[p]!);
        }
        if (!more.size) break;
        err = await runPaced([...more].map(([key, fen]) => ({ key, fen })), put, ctl.signal, setScan);
      }
      if (err) setError(err);
    } finally {
      if (abort.current === ctl) abort.current = null;
      setScan(null);
    }
  }, [cloud, todo, recent, maxPly, fetchOne]);

  const stopScan = useCallback(() => abort.current?.abort(), []);

  /** Looks up a list of positions, paced (the engine column of the better-moves table). */
  const lookupMany = useCallback(
    async (items: readonly { key: string; fen: string }[]) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setError(null);
      try {
        const err = await runPaced(items, async (it, signal) => void (await fetchOne(it.key, it.fen, signal)), ctl.signal, setScan);
        if (err) setError(err);
      } finally {
        if (abort.current === ctl) abort.current = null;
        setScan(null);
      }
    },
    [fetchOne],
  );

  /** One position now (the game player), unless it is known. */
  const lookupOne = useCallback(
    async (key: string, fen: string) => {
      if (cloud.has(key)) return cloud.get(key) ?? null;
      try {
        return await fetchOne(key, fen);
      } catch {
        return null;
      }
    },
    [cloud, fetchOne],
  );

  const byGame = useMemo(() => new Map<string, OpeningLoss>(losses.map((l) => [l.game.id, l])), [losses]);

  return { recent, losses, byGame, cloud, loaded: loadedFor === recent, todo: todo.length, scan, startScan, stopScan, lookupMany, error, lookupOne };
}
