import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from '../../app/EngineContext';
import type { MoveRecord } from '../../core/chess/types';
import type { PositionThreats, WhyBadReport } from '../../core/explain/whyBad';
import { IdbAnalysisCache } from '../../storage/db';
import { PRESETS } from '../analysis/types';
import { MoveExplainer } from './explainer';

const cache = new IdbAnalysisCache();

/** Key for a why-bad result: the same move in the same position gives the same answer. */
export const whyBadKey = (mv: MoveRecord) => `${mv.fenBefore}|${mv.uci}`;

export type Pending<T> = { status: 'running' } | { status: 'done'; value: T } | { status: 'error'; error: string };

/** Per-session results of the on-demand explainers, keyed by position + move (why-bad) and FEN (threats). */
export function useMoveExplainer() {
  const { getEngine, presetId } = useEngine();
  const [whyBad, setWhyBad] = useState<Record<string, Pending<WhyBadReport>>>({});
  const [threats, setThreats] = useState<Record<string, Pending<PositionThreats | null>>>({});
  // Created in the effect (not the ref initialiser) so StrictMode's mount → unmount → mount
  // does not leave an already-aborted controller behind.
  const abort = useRef(new AbortController());
  useEffect(() => {
    const ac = new AbortController();
    abort.current = ac;
    return () => ac.abort();
  }, []);

  const run = useCallback(
    async <T,>(key: string, set: React.Dispatch<React.SetStateAction<Record<string, Pending<T>>>>, fn: (e: MoveExplainer) => Promise<T>) => {
      set((s) => ({ ...s, [key]: { status: 'running' } }));
      try {
        const explainer = new MoveExplainer(await getEngine(), cache, PRESETS[presetId]);
        const value = await fn(explainer);
        set((s) => ({ ...s, [key]: { status: 'done', value } }));
      } catch (e) {
        if (abort.current.signal.aborted) return;
        set((s) => ({ ...s, [key]: { status: 'error', error: (e as Error).message } }));
      }
    },
    [getEngine, presetId],
  );

  const explainMove = useCallback(
    (mv: MoveRecord) => run(whyBadKey(mv), setWhyBad, (e) => e.whyBad(mv, abort.current.signal)),
    [run],
  );
  const findThreat = useCallback((fen: string) => run(fen, setThreats, (e) => e.threats(fen, abort.current.signal)), [run]);

  return { whyBad, threats, explainMove, findThreat };
}
