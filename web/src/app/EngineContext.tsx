import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EngineClient } from '../core/engine/EngineClient';
import { AVAILABLE_FLAVOURS, createWorkerTransport, type EngineFlavour } from '../core/engine/workerTransport';
import { PRESETS, type PresetId } from '../features/analysis/types';
import { settingsStore } from '../storage/db';

type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

type EngineContextValue = {
  /** Returns a ready engine, loading the WASM on first use. */
  getEngine: () => Promise<EngineClient>;
  status: EngineStatus;
  error?: string;
  flavour: EngineFlavour;
  setFlavour: (f: EngineFlavour) => void;
  presetId: PresetId;
  setPresetId: (p: PresetId) => void;
};

const Ctx = createContext<EngineContextValue | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const [flavour, setFlavourState] = useState<EngineFlavour>('lite-single');
  const [presetId, setPresetState] = useState<PresetId>('standard');
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string>();
  const engineRef = useRef<EngineClient | null>(null);

  useEffect(() => {
    settingsStore
      .get<EngineFlavour>('engineFlavour', 'lite-single')
      .then((f) => setFlavourState(AVAILABLE_FLAVOURS.includes(f) ? f : 'lite-single'));
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

  const setPresetId = useCallback((p: PresetId) => {
    setPresetState(p);
    void settingsStore.set('preset', p);
  }, []);

  const getEngine = useCallback(async () => {
    if (!engineRef.current) engineRef.current = new EngineClient(() => createWorkerTransport(flavour), flavour);
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
  }, [flavour]);

  const value = useMemo(
    () => ({ getEngine, status, error, flavour, setFlavour, presetId, setPresetId }),
    [getEngine, status, error, flavour, setFlavour, presetId, setPresetId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine(): EngineContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEngine must be used inside EngineProvider');
  return v;
}
