import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from '../../app/EngineContext';
import type { GameRecord } from '../../core/chess/types';
import { toOpeningGame, type Deviation, type OpeningGame } from '../../core/repertoire/games';
import type { TrainLogEntry } from '../../core/repertoire/types';
import { moveGradeStore, openingGameStore, trainStore } from '../../storage/db';
import { GOOD_ENOUGH, gradeKey, gradeMove, type MoveGrade } from '../explore/grade';
import { ChessComClient, chessComToGameRecord } from '../import/chesscom';
import { LichessClient, lichessToGameRecord } from '../import/lichess';

const chesscom = new ChessComClient();
const lichess = new LichessClient();

/** Depth for checking deviations: enough to tell a playable move from a mistake in the opening. */
export const GRADE_DEPTH = 14;

export type FetchRequest = { chesscom?: { username: string; months: number }; lichess?: { username: string; max: number } };
export type FetchResult = { added: number; skipped: number; errors: string[] };

/** Whether the engine found the deviation playable (within the classifier's `good` threshold). */
export const isPlayable = (g: MoveGrade | undefined): boolean => !!g && GOOD_ENOUGH.includes(g.category);

const devGradeKey = (d: Deviation) => gradeKey(d.fen, d.played.uci);

/** The user's games for the repertoire comparison: fetching, engine grades of deviations, review. */
export function useOpeningGames() {
  const [games, setGames] = useState<OpeningGame[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [grades, setGrades] = useState<ReadonlyMap<string, MoveGrade>>(new Map());
  const [grading, setGrading] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const { getEngine } = useEngine();

  useEffect(() => {
    void openingGameStore.list().then((g) => {
      setGames(g);
      setLoaded(true);
    });
    return () => abort.current?.abort();
  }, []);

  /** Fetches from the providers asked for; each one's failure is reported without stopping the other. */
  const fetchGames = useCallback(async (req: FetchRequest, signal?: AbortSignal): Promise<FetchResult> => {
    const out: OpeningGame[] = [];
    let skipped = 0;
    const errors: string[] = [];
    const keep = (rec: () => GameRecord, username: string) => {
      try {
        const g = toOpeningGame(rec(), username);
        if (g) out.push(g);
        else skipped++;
      } catch {
        skipped++;
      }
    };
    if (req.chesscom) {
      try {
        const r = await chesscom.recentGames(req.chesscom.username, { monthsBack: req.chesscom.months, signal });
        for (const g of r.games) keep(() => chessComToGameRecord(g), r.username);
      } catch (e) {
        errors.push(`Chess.com: ${(e as Error).message}`);
      }
    }
    if (req.lichess) {
      try {
        const r = await lichess.recentGames(req.lichess.username, { max: req.lichess.max, signal });
        for (const g of r.games) keep(() => lichessToGameRecord(g), r.username);
      } catch (e) {
        errors.push(`Lichess: ${(e as Error).message}`);
      }
    }
    await openingGameStore.putMany(out);
    setGames(await openingGameStore.list());
    return { added: out.length, skipped, errors };
  }, []);

  const clear = useCallback(async () => {
    await openingGameStore.clear();
    setGames([]);
  }, []);

  /** Loads grades already computed for these deviations. */
  const loadGrades = useCallback(async (devs: readonly Deviation[]) => {
    const found = await moveGradeStore.getAll(devs.map(devGradeKey));
    if (found.size) setGrades((g) => new Map([...g, ...found]));
  }, []);

  /** Grades the deviations not graded yet with the engine, one after another. */
  const grade = useCallback(
    async (devs: readonly Deviation[]) => {
      const todo = devs.filter((d) => !grades.has(devGradeKey(d)));
      if (!todo.length) return;
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setGrading({ done: 0, total: todo.length });
      try {
        const engine = await getEngine();
        for (let i = 0; i < todo.length; i++) {
          if (ctl.signal.aborted) break;
          const d = todo[i]!;
          const g = await gradeMove(engine, d.fen, d.played.uci, { depth: GRADE_DEPTH, signal: ctl.signal });
          await moveGradeStore.put(devGradeKey(d), g);
          setGrades((m) => new Map(m).set(devGradeKey(d), g));
          setGrading({ done: i + 1, total: todo.length });
        }
      } finally {
        setGrading(null);
      }
    },
    [grades, getEngine],
  );

  const stopGrading = useCallback(() => abort.current?.abort(), []);

  /** Logs your deviations as mistakes to review (one per game), leaving out playable ones. */
  const addToReview = useCallback(
    async (repertoireId: string, devs: readonly Deviation[]): Promise<number> => {
      const entries: TrainLogEntry[] = [];
      for (const d of devs) {
        if (isPlayable(grades.get(devGradeKey(d)))) continue;
        for (const g of d.games) {
          entries.push({
            repertoireId,
            side: d.side,
            posKey: d.posKey,
            at: g.playedAt,
            mode: 'game',
            result: 'wrong',
            wrong: [d.played.san],
            expected: d.expected,
            ms: 0,
            gameId: g.id,
          });
        }
      }
      return trainStore.addGameMistakes(entries);
    },
    [grades],
  );

  return { games, loaded, fetchGames, clear, grades, gradeOf: (d: Deviation) => grades.get(devGradeKey(d)), loadGrades, grade, grading, stopGrading, addToReview };
}
