import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from '../../app/EngineContext';
import type { EngineLine } from '../../core/engine/types';
import { PRESETS } from '../analysis/types';
import type { Pending } from '../explain/useMoveExplainer';
import { gradeKey, gradeMove, type MoveGrade } from './grade';

/** Grades of moves the user tried on the board, keyed by position + move. */
export function useMoveGrader() {
  const { getEngine, presetId } = useEngine();
  const [grades, setGrades] = useState<Record<string, Pending<MoveGrade>>>({});
  const abort = useRef(new AbortController());
  useEffect(() => {
    const ac = new AbortController();
    abort.current = ac;
    return () => ac.abort();
  }, []);

  const grade = useCallback(
    async (fen: string, uci: string, known?: EngineLine[]) => {
      const key = gradeKey(fen, uci);
      setGrades((s) => (s[key]?.status === 'done' || s[key]?.status === 'running' ? s : { ...s, [key]: { status: 'running' } }));
      try {
        const preset = PRESETS[presetId];
        const value = await gradeMove(await getEngine(), fen, uci, {
          depth: preset.deepPassDepth,
          movetimeMs: preset.movetimeCapMs,
          known,
          signal: abort.current.signal,
        });
        setGrades((s) => ({ ...s, [key]: { status: 'done', value } }));
      } catch (e) {
        if (abort.current.signal.aborted) return;
        setGrades((s) => ({ ...s, [key]: { status: 'error', error: (e as Error).message } }));
      }
    },
    [getEngine, presetId],
  );

  return { grades, grade };
}

export type LiveEval = { fen: string; depth: number; line?: EngineLine; done: boolean };

/** Deepest depth the live engine searches before it stops on its own. */
const LIVE_DEPTH = 22;
const LIVE_MAX_MS = 15_000;

/**
 * Continuous engine evaluation of `fen` while `enabled`: reports each depth as it completes and
 * stops when the position changes, the switch is turned off, or the depth limit is reached.
 */
export function useLiveEngine(fen: string, enabled: boolean): LiveEval | null {
  const { getEngine } = useEngine();
  const [result, setResult] = useState<LiveEval | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const pool = await getEngine();
        const r = await pool.analyse(
          { fen, depth: LIVE_DEPTH, movetimeMs: LIVE_MAX_MS, multiPv: 1 },
          {
            signal: ac.signal,
            progressIntervalMs: 250,
            onProgress: (p) => {
              if (!ac.signal.aborted && p.lines[0]) setResult({ fen, depth: p.depth, line: p.lines[0], done: false });
            },
          },
        );
        if (!ac.signal.aborted) setResult({ fen, depth: r.completedDepth, line: r.lines[0], done: true });
      } catch {
        // cancelled because the position changed, or the engine failed: nothing to show
      }
    })();
    return () => ac.abort();
  }, [fen, enabled, getEngine]);
  // A result for another position is stale; while the new search starts, nothing is shown.
  return enabled && result?.fen === fen ? result : null;
}
