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

/**
 * Builds actually shipped with this deployment. The ~95 MB full build is only copied when
 * installing with COPY_FULL_ENGINE=1, so it is offered only when built with VITE_FULL_ENGINE=1.
 */
export const AVAILABLE_FLAVOURS: EngineFlavour[] =
  import.meta.env.VITE_FULL_ENGINE === '1' ? ['lite-single', 'full-single'] : ['lite-single'];

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
