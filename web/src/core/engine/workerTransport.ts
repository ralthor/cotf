import type { EngineTransport } from './EngineClient';

export type EngineFlavour = 'lite-single' | 'full-single';

export const ENGINE_BUILDS: Record<EngineFlavour, { label: string; path: string; approxSize: string }> = {
  'lite-single': {
    label: 'Stockfish 19 lite (single-threaded WASM)',
    path: 'engines/stockfish-19-lite-single.js',
    approxSize: '1.7 MB',
  },
  'full-single': {
    label: 'Stockfish 19 full (single-threaded WASM)',
    path: 'engines/stockfish-19-single.js',
    approxSize: '95 MB',
  },
};

/** Both builds are always shipped; the ~95 MB full build is only downloaded when chosen. */
export const AVAILABLE_FLAVOURS: EngineFlavour[] = ['lite-single', 'full-single'];

/**
 * Default number of parallel engines: one per core, leaving one for the page, at most 6 (no
 * measurable gain beyond the physical cores). The 95 MB full build uses ~2 because of memory.
 */
export function defaultEngineCount(flavour: EngineFlavour, cores = globalThis.navigator?.hardwareConcurrency ?? 2): number {
  return Math.max(1, Math.min(maxEngineCount(flavour, cores), Math.min(6, cores - 1)));
}

/** Upper bound offered in the UI. */
export function maxEngineCount(flavour: EngineFlavour, cores = globalThis.navigator?.hardwareConcurrency ?? 2): number {
  return Math.max(1, Math.min(flavour === 'full-single' ? 2 : 8, cores));
}

/** Runs Stockfish.js in a dedicated Web Worker; UCI lines travel over postMessage. */
export function createWorkerTransport(flavour: EngineFlavour): EngineTransport {
  const url = new URL(ENGINE_BUILDS[flavour].path, document.baseURI).toString();
  const worker = new Worker(url);
  const lineListeners: ((line: string) => void)[] = [];
  const errorListeners: ((e: Error) => void)[] = [];
  worker.onmessage = (ev: MessageEvent) => {
    const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
    for (const chunk of data.split('\n')) if (chunk) for (const l of lineListeners) l(chunk);
  };
  worker.onerror = (ev: ErrorEvent) => {
    ev.preventDefault();
    const err = new Error(ev.message || 'Engine worker failed to load.');
    for (const l of errorListeners) l(err);
  };
  return {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (l) => lineListeners.push(l),
    onError: (l) => errorListeners.push(l),
    terminate: () => worker.terminate(),
  };
}
