import type { AnalyseOptions, EngineClient } from './EngineClient';
import { EngineError, type EngineInfo, type PositionAnalysis, type SearchRequest } from './types';

/**
 * Several single-threaded engines analysing different positions at the same time.
 *
 * Stockfish's own threads make a search stronger in the same time but do not reach a fixed depth
 * sooner (measured: 6 threads took longer than 1 to reach depth 16 or 20), and our labels are
 * built on fixed depths. A game is many independent positions, so running one single-threaded
 * engine per core is what actually saves time (measured: ~3x with 6 engines on 6 cores), and
 * every search stays reproducible.
 *
 * Each search runs on whichever engine is free; searches never share an engine.
 */
export class EnginePool {
  private readonly engines: EngineClient[];
  private readonly idle: EngineClient[];
  private waiting: { resolve: (e: EngineClient) => void; reject: (e: Error) => void }[] = [];
  private disposed = false;

  constructor(create: (index: number) => EngineClient, size: number) {
    this.engines = Array.from({ length: Math.max(1, Math.floor(size) || 1) }, (_, i) => create(i));
    this.idle = [...this.engines];
  }

  /** How many searches can run at once. */
  get size(): number {
    return this.engines.length;
  }

  /** Same identity as a single engine of this build, so cached results are shared. */
  get info(): EngineInfo {
    return this.engines[0]!.info;
  }

  /** Starts every engine (in parallel). */
  async init(): Promise<void> {
    if (this.disposed) throw new EngineError('not-ready', 'Engine pool has been disposed.');
    await Promise.all(this.engines.map((e) => e.init()));
  }

  async analyse(req: SearchRequest, opts: AnalyseOptions = {}): Promise<PositionAnalysis> {
    const engine = await this.acquire(opts.signal);
    try {
      return await engine.analyse(req, opts);
    } finally {
      this.release(engine);
    }
  }

  /**
   * Keeps one engine for a whole task, so consecutive searches share its hash (e.g. the
   * positions of a game in order, which is much faster than scattering them over engines).
   */
  async withEngine<T>(fn: (engine: EngineClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const engine = await this.acquire(signal);
    try {
      return await fn(engine);
    } finally {
      this.release(engine);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.engines) e.dispose();
    const waiting = this.waiting;
    this.waiting = [];
    for (const w of waiting) w.reject(new EngineError('cancelled', 'Engine pool disposed.'));
  }

  private acquire(signal?: AbortSignal): Promise<EngineClient> {
    if (this.disposed) return Promise.reject(new EngineError('cancelled', 'Engine pool disposed.'));
    if (signal?.aborted) return Promise.reject(new EngineError('cancelled', 'Search cancelled.'));
    const free = this.idle.pop();
    if (free) return Promise.resolve(free);
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: (e: EngineClient) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(e);
        },
        reject,
      };
      const onAbort = () => {
        this.waiting = this.waiting.filter((w) => w !== entry);
        reject(new EngineError('cancelled', 'Search cancelled.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  private release(engine: EngineClient): void {
    const next = this.waiting.shift();
    if (next) next.resolve(engine);
    else this.idle.push(engine);
  }
}

/** Runs `fn` over `items` with at most `limit` calls in flight; rejects on the first failure. */
export async function forEachConcurrent<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown;
  const worker = async () => {
    while (failed === undefined && next < items.length) {
      const i = next++;
      try {
        await fn(items[i]!, i);
      } catch (e) {
        failed ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed !== undefined) throw failed;
}
