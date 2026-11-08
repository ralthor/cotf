import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameRecord } from '../../core/chess/types';
import { DEFAULT_POLICY } from '../../core/classification/classify';
import { useEngine } from '../../app/EngineContext';
import { analysisKey, analysisStore, IdbAnalysisCache } from '../../storage/db';
import { GameAnalyser } from './orchestrator';
import { PRESETS, type GameAnalysis } from './types';

const sharedCache = new IdbAnalysisCache();

/** Loads any stored analysis for a game and runs/cancels new analyses with throttled UI updates. */
export function useGameAnalysis(game: GameRecord | null) {
  const { getEngine, presetId } = useEngine();
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setAnalysis(null);
    setRunning(false);
    if (!game) return;
    let live = true;
    void (async () => {
      // Prefer a stored analysis for the current preset, else any finished preset.
      for (const p of [presetId, 'deep', 'standard', 'fast', 'cloud'] as const) {
        const stored = await analysisStore.get(analysisKey(game.id, p, DEFAULT_POLICY.version));
        if (stored && live) {
          setAnalysis(stored);
          return;
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [game, presetId]);

  const start = useCallback(async () => {
    if (!game) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    const key = analysisKey(game.id, presetId, DEFAULT_POLICY.version);
    let lastUi = 0;
    let lastSave = 0;
    try {
      const engine = await getEngine();
      const analyser = new GameAnalyser(engine, sharedCache, PRESETS[presetId]);
      const result = await analyser.run(game, {
        signal: ac.signal,
        onUpdate: (s) => {
          const now = performance.now();
          const final = s.phase === 'done' || s.phase === 'cancelled' || s.phase === 'error';
          if (final || now - lastUi > 200) {
            lastUi = now;
            setAnalysis(s);
          }
          if (final || now - lastSave > 3000) {
            lastSave = now;
            void analysisStore.put(key, s);
          }
        },
      });
      setAnalysis(result);
      await analysisStore.put(key, result);
    } catch (e) {
      setAnalysis((a) => (a ? { ...a, phase: 'error', error: (e as Error).message } : a));
    } finally {
      if (abortRef.current === ac) setRunning(false);
    }
  }, [game, getEngine, presetId]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { analysis, setAnalysis, running, start, cancel };
}
