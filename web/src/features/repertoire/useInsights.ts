import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OpeningGame } from '../../core/repertoire/games';
import {
  DEFAULT_RULE,
  buildGamesTree,
  decisionPoints,
  improvementsAt,
  weakSpots,
  type Improvement,
  type ImprovementRule,
  type PositionNode,
} from '../../core/repertoire/insights';
import type { DropLabel } from '../../core/repertoire/openingLoss';
import type { Side } from '../../core/repertoire/types';
import { explorerStore } from '../../storage/db';
import { getPref, setPref } from '../../storage/prefs';
import { explorer, ExplorerError, explorerUrl, ratingGroupsFor, DEFAULT_FILTER, type ExplorerDb, type ExplorerResult, type LichessFilter } from './explorer';

export type InsightFilters = {
  colour: '' | Side;
  /** Time controls to include; empty: all. */
  timeClasses: string[];
  /** Last move number looked at. */
  maxMove: number;
  minGames: number;
  /** Opening losses: how many of your most recent games to look at. */
  scanGames: number;
  /** Opening losses: the smallest drop listed. */
  minDrop: DropLabel | 'small';
  /** Opening losses: only games you did not win. */
  notWon: boolean;
};

const DEFAULT_FILTERS: InsightFilters = { colour: '', timeClasses: [], maxMove: 15, minGames: 3, scanGames: 100, minDrop: 'inaccuracy', notWon: false };
/** Positions looked up in one scan, most played first. */
export const MAX_LOOKUPS = 300;
/** Time between two requests to the explorer, to stay well inside Lichess's limits. */
const PACE_MS = 1100;
/** Wait after Lichess says "too many requests". */
const RATE_WAIT_MS = 61_000;

/** Database rules: the masters database has far fewer games per move. */
export const RULES: Record<ExplorerDb, ImprovementRule> = { lichess: DEFAULT_RULE, masters: { ...DEFAULT_RULE, minDbGames: 50 } };

const SPEED_OF: Record<string, string> = { ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', daily: 'correspondence', correspondence: 'correspondence' };

/** A game's time control as the filter names it (Lichess's ultra bullet is bullet, correspondence is daily). */
export const timeClassOf = (tc: string | undefined) => (tc === 'ultraBullet' ? 'bullet' : tc === 'correspondence' ? 'daily' : tc ?? '');

function readFilters(): InsightFilters {
  try {
    const saved = JSON.parse(getPref('insightsFilters') ?? '{}') as Partial<InsightFilters> & { timeClass?: string };
    // Before: one time control, '' for all.
    if (!saved.timeClasses && saved.timeClass) saved.timeClasses = [saved.timeClass];
    delete saved.timeClass;
    return { ...DEFAULT_FILTERS, ...saved };
  } catch {
    return DEFAULT_FILTERS;
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** The Lichess players to compare with: your rating group and the next, at the speeds you play. */
export function lichessFilterFor(games: readonly OpeningGame[]): LichessFilter & { rating: number | null } {
  const rating = median(games.flatMap((g) => (g.userRating ? [g.userRating] : [])));
  const speeds = [...new Set(games.flatMap((g) => (g.timeClass && SPEED_OF[g.timeClass] ? [SPEED_OF[g.timeClass]!] : [])))];
  return {
    rating,
    ratings: rating === null ? DEFAULT_FILTER.ratings : ratingGroupsFor(rating),
    speeds: speeds.length ? speeds : DEFAULT_FILTER.speeds,
  };
}

export type Lookup = { result: ExplorerResult; at: string };
export type ScanState = { done: number; total: number; waiting?: boolean } | null;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    });
  });

/** Weak spots and improvements from your games, with database lookups kept in IndexedDB. */
export function useInsights(games: readonly OpeningGame[]) {
  const [filters, setFiltersState] = useState<InsightFilters>(readFilters);
  const setFilters = useCallback((f: Partial<InsightFilters>) => {
    setFiltersState((old) => {
      const next = { ...old, ...f };
      setPref('insightsFilters', JSON.stringify(next));
      return next;
    });
  }, []);
  const token = getPref('lichessToken') ?? '';
  const [dbChoice, setDbChoice] = useState<ExplorerDb>(() => (getPref('insightsDb') === 'masters' ? 'masters' : 'lichess'));
  const db: ExplorerDb = dbChoice === 'lichess' && !token ? 'masters' : dbChoice;
  const chooseDb = (d: ExplorerDb) => {
    setPref('insightsDb', d);
    setDbChoice(d);
  };

  const filtered = useMemo(
    () =>
      games.filter(
        (g) => (!filters.colour || g.userColour === filters.colour) && (!filters.timeClasses.length || filters.timeClasses.includes(timeClassOf(g.timeClass))),
      ),
    [games, filters.colour, filters.timeClasses],
  );
  const tree = useMemo(() => buildGamesTree(filtered, filters.maxMove * 2), [filtered, filters.maxMove]);
  const spots = useMemo(() => weakSpots(tree, { minGames: filters.minGames }), [tree, filters.minGames]);
  const points = useMemo(() => decisionPoints(tree, { minGames: filters.minGames }).slice(0, MAX_LOOKUPS), [tree, filters.minGames]);
  const lichessFilter = useMemo(() => lichessFilterFor(filtered), [filtered]);
  const urlOf = useCallback((n: PositionNode) => explorerUrl(db, n.fen, lichessFilter), [db, lichessFilter]);

  const rule = RULES[db];
  const [lookups, setLookups] = useState<ReadonlyMap<string, Lookup>>(new Map());
  const [scan, setScan] = useState<ScanState>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Lookups already saved for these positions.
  useEffect(() => {
    let live = true;
    void (async () => {
      const found = new Map<string, Lookup>();
      for (const n of points) {
        const url = urlOf(n);
        const hit = await explorerStore.get(url);
        if (hit) found.set(url, hit);
      }
      if (live) setLookups((m) => new Map([...m, ...found]));
    })();
    return () => {
      live = false;
    };
  }, [points, urlOf]);

  useEffect(() => () => abort.current?.abort(), []);

  /** Looks up the positions not looked up yet, one at a time. */
  const startScan = useCallback(async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    const todo = points.filter((n) => !lookups.has(urlOf(n)));
    setScan({ done: 0, total: todo.length });
    try {
      for (let i = 0; i < todo.length && !ctl.signal.aborted; ) {
        const n = todo[i]!;
        const url = urlOf(n);
        try {
          const result = await explorer.get(db, n.fen, token, ctl.signal, lichessFilter);
          const at = await explorerStore.put(url, result);
          setLookups((m) => new Map(m).set(url, { result, at }));
          i++;
          setScan({ done: i, total: todo.length });
          await sleep(PACE_MS, ctl.signal);
        } catch (e) {
          if (ctl.signal.aborted) break;
          if (e instanceof ExplorerError && e.code === 'rate') {
            setScan({ done: i, total: todo.length, waiting: true });
            await sleep(RATE_WAIT_MS, ctl.signal);
            setScan({ done: i, total: todo.length });
            continue;
          }
          setError(e instanceof ExplorerError ? e.code : 'network');
          break;
        }
      }
    } finally {
      if (abort.current === ctl) abort.current = null;
      setScan(null);
    }
  }, [points, lookups, urlOf, db, token, lichessFilter]);

  const stopScan = useCallback(() => abort.current?.abort(), []);

  /** Looks up one position now (from its detail view). */
  const lookupOne = useCallback(
    async (n: PositionNode) => {
      setError(null);
      try {
        const result = await explorer.get(db, n.fen, token, undefined, lichessFilter);
        const at = await explorerStore.put(urlOf(n), result);
        setLookups((m) => new Map(m).set(urlOf(n), { result, at }));
      } catch (e) {
        setError(e instanceof ExplorerError ? e.code : 'network');
      }
    },
    [db, token, lichessFilter, urlOf],
  );

  const improvements = useMemo(() => {
    const out: Improvement[] = [];
    for (const n of points) {
      const l = lookups.get(urlOf(n));
      if (l) out.push(...improvementsAt(tree, n, l.result, rule));
    }
    return out.sort((a, b) => b.pointsToGain - a.pointsToGain || a.node.ply - b.node.ply);
  }, [points, lookups, urlOf, tree, rule]);

  const lookupOf = useCallback((n: PositionNode) => lookups.get(urlOf(n)), [lookups, urlOf]);
  /** Improvements at one position, once it is looked up. */
  const improvementsOf = useCallback(
    (n: PositionNode) => {
      const l = lookups.get(urlOf(n));
      return l ? improvementsAt(tree, n, l.result, rule) : [];
    },
    [lookups, urlOf, tree, rule],
  );
  const looked = points.filter((n) => lookups.has(urlOf(n))).length;

  /** The database for any position: saved answer, else fetched now. `fetched` says whether Lichess was asked (for pacing). */
  const lookupFen = useCallback(
    async (fen: string): Promise<{ result: ExplorerResult; fetched: boolean } | null> => {
      const url = explorerUrl(db, fen, lichessFilter);
      const hit = lookups.get(url) ?? (await explorerStore.get(url));
      if (hit) return { result: hit.result, fetched: false };
      try {
        const result = await explorer.get(db, fen, token, undefined, lichessFilter);
        const at = await explorerStore.put(url, result);
        setLookups((m) => new Map(m).set(url, { result, at }));
        return { result, fetched: true };
      } catch (e) {
        setError(e instanceof ExplorerError ? e.code : 'network');
        return null;
      }
    },
    [db, lichessFilter, lookups, token],
  );
  /** Loads saved database answers for these positions (opening losses). */
  const loadFens = useCallback(
    async (fens: readonly string[]) => {
      const urls = fens.map((f) => explorerUrl(db, f, lichessFilter));
      const got = await explorerStore.getMany(urls);
      if (got.size) setLookups((m) => new Map([...m, ...got]));
    },
    [db, lichessFilter],
  );
  /** Fetches and saves one position's database answer; throws `ExplorerError` (paced by the caller). */
  const fetchFen = useCallback(
    async (fen: string, signal?: AbortSignal) => {
      const url = explorerUrl(db, fen, lichessFilter);
      const result = await explorer.get(db, fen, token, signal, lichessFilter);
      const at = await explorerStore.put(url, result);
      setLookups((m) => new Map(m).set(url, { result, at }));
      return result;
    },
    [db, lichessFilter, token],
  );
  /** The saved database answer for any position, if any. */
  const cachedFen = useCallback((fen: string) => lookups.get(explorerUrl(db, fen, lichessFilter))?.result, [db, lichessFilter, lookups]);

  return { filters, setFilters, filtered, tree, spots, points, looked, improvements, lookupOf, lookupOne, lookupFen, cachedFen, loadFens, fetchFen, lookups, improvementsOf, scan, startScan, stopScan, error, db, chooseDb, hasToken: !!token, lichessFilter, rule };
}
