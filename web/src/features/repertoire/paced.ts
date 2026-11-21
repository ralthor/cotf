import { ExplorerError } from './explorer';

/** Time between two requests to Lichess, to stay well inside its limits. */
export const PACE_MS = 1100;
/** Wait after Lichess says "too many requests". */
export const RATE_WAIT_MS = 61_000;

export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    });
  });

export type PacedProgress = { done: number; total: number; waiting?: boolean };

/**
 * Runs `fn` on each item, one at a time with a pause between, waiting a minute when Lichess says
 * "too many requests" and then going on. Stops on abort or on any other error (returned as its code).
 */
export async function runPaced<T>(
  items: readonly T[],
  fn: (item: T, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
  onProgress: (p: PacedProgress) => void,
): Promise<string | null> {
  for (let i = 0; i < items.length && !signal.aborted; ) {
    try {
      await fn(items[i]!, signal);
      i++;
      onProgress({ done: i, total: items.length });
      if (i < items.length) await sleep(PACE_MS, signal);
    } catch (e) {
      if (signal.aborted) break;
      if (e instanceof ExplorerError && e.code === 'rate') {
        onProgress({ done: i, total: items.length, waiting: true });
        await sleep(RATE_WAIT_MS, signal);
        onProgress({ done: i, total: items.length });
        continue;
      }
      return e instanceof ExplorerError ? e.code : 'network';
    }
  }
  return null;
}
