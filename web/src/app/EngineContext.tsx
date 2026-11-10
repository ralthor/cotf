import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EngineClient } from '../core/engine/EngineClient';
import { EnginePool } from '../core/engine/EnginePool';
import {
  AVAILABLE_FLAVOURS,
  createWorkerTransport,
  defaultEngineCount,
  maxEngineCount,
  type EngineFlavour,
} from '../core/engine/workerTransport';
import { PRESETS, type PresetId } from '../features/analysis/types';
import { settingsStore } from '../storage/db';

type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

type EngineContextValue = {
  /** Returns ready engines, loading the WASM on first use. */
  getEngine: () => Promise<EnginePool>;
  status: EngineStatus;
  error?: string;
  flavour: EngineFlavour;
  setFlavour: (f: EngineFlavour) => void;
  /** Single-threaded engines analysing different positions at the same time. */
  engineCount: number;
  setEngineCount: (n: number) => void;
  maxEngineCount: number;
  presetId: PresetId;
  setPresetId: (p: PresetId) => void;
};

const Ctx = createContext<EngineContextValue | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const [flavour, setFlavourState] = useState<EngineFlavour>('lite-single');
  const [presetId, setPresetState] = useState<PresetId>('standard');
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string>();
  const engineRef = useRef<EnginePool | null>(null);
  const [counts, setCounts] = useState<Partial<Record<EngineFlavour, number>>>({});
  const engineCount = Math.min(counts[flavour] ?? defaultEngineCount(flavour), maxEngineCount(flavour));

  useEffect(() => {
    settingsStore
      .get<EngineFlavour>('engineFlavour', 'lite-single')
      .then((f) => setFlavourState(AVAILABLE_FLAVOURS.includes(f) ? f : 'lite-single'));
    settingsStore.get<Partial<Record<EngineFlavour, number>>>('engineCounts', {}).then((c) => setCounts(c ?? {}));
    settingsStore.get<PresetId>('preset', 'standard').then((p) => setPresetState(p in PRESETS ? p : 'standard'));
  }, []);

  useEffect(() => () => engineRef.current?.dispose(), []);

  const setFlavour = useCallback((f: EngineFlavour) => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setStatus('idle');
    setFlavourState(f);
    void settingsStore.set('engineFlavour', f);
  }, []);

  const setEngineCount = useCallback(
    (n: number) => {
      engineRef.current?.dispose();
      engineRef.current = null;
      setStatus('idle');
      setCounts((c) => {
        const next = { ...c, [flavour]: Math.max(1, Math.min(maxEngineCount(flavour), Math.floor(n) || 1)) };
        void settingsStore.set('engineCounts', next);
        return next;
      });
    },
    [flavour],
  );

  const setPresetId = useCallback((p: PresetId) => {
    setPresetState(p);
    void settingsStore.set('preset', p);
  }, []);

  const getEngine = useCallback(async () => {
    if (!engineRef.current)
      engineRef.current = new EnginePool(() => new EngineClient(() => createWorkerTransport(flavour), flavour), engineCount);
    const engine = engineRef.current;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      await engine.init();
      setStatus('ready');
      setError(undefined);
      return engine;
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
      engineRef.current?.dispose();
      engineRef.current = null;
      throw e;
    }
  }, [flavour, engineCount]);

  const value = useMemo(
    () => ({
      getEngine,
      status,
      error,
      flavour,
      setFlavour,
      engineCount,
      setEngineCount,
      maxEngineCount: maxEngineCount(flavour),
      presetId,
      setPresetId,
    }),
    [getEngine, status, error, flavour, setFlavour, engineCount, setEngineCount, presetId, setPresetId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine(): EngineContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEngine must be used inside EngineProvider');
  return v;
}
