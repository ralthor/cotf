import { describe, expect, it } from 'vitest';
import { EngineClient } from './EngineClient';
import { EnginePool, forEachConcurrent } from './EnginePool';
import { fakeTransport } from '../../test/fakeEngine';
import { defaultEngineCount, maxEngineCount } from './workerTransport';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Fake engine that answers after `ms`, counting how many searches run at once across engines. */
function slowEngines(ms: number) {
  const stats = { running: 0, peak: 0, used: new Set<number>() };
  const create = (id: number) =>
    new EngineClient(
      () =>
        fakeTransport(({ emit }) => {
          stats.running++;
          stats.peak = Math.max(stats.peak, stats.running);
          stats.used.add(id);
          setTimeout(() => {
            stats.running--;
            emit('info depth 1 multipv 1 score cp 10 pv e2e4');
            emit('bestmove e2e4');
          }, ms);
        }),
      'fake',
    );
  return { stats, create };
}

describe('EnginePool', () => {
  it('runs up to `size` searches at once, one per engine', async () => {
    const { stats, create } = slowEngines(20);
    const pool = new EnginePool(create, 3);
    await pool.init();
    const results = await Promise.all(Array.from({ length: 7 }, () => pool.analyse({ fen: START, depth: 1 })));
    expect(results).toHaveLength(7);
    expect(stats.peak).toBe(3);
    expect(stats.used.size).toBe(3);
    expect(pool.size).toBe(3);
  });

  it('shares the engine identity of a single engine (same cache keys)', async () => {
    const { create } = slowEngines(1);
    const pool = new EnginePool(create, 2);
    await pool.init();
    expect(pool.info.id).toBe(create(9).info.id.replace('unknown', pool.info.name));
    expect(pool.info.flavour).toBe('fake');
  });

  it('a cancelled search waiting for a free engine is rejected and does not take one', async () => {
    const { create } = slowEngines(30);
    const pool = new EnginePool(create, 1);
    const first = pool.analyse({ fen: START, depth: 1 });
    const ac = new AbortController();
    const waiting = pool.analyse({ fen: START, depth: 1 }, { signal: ac.signal });
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'cancelled' });
    await expect(first).resolves.toBeDefined();
    await expect(pool.analyse({ fen: START, depth: 1 })).resolves.toBeDefined();
  });
});

describe('forEachConcurrent', () => {
  it('keeps at most `limit` calls in flight and visits every item once', async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachConcurrent([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(x);
      running--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects with the first failure and starts no new items after it', async () => {
    const started: number[] = [];
    await expect(
      forEachConcurrent([1, 2, 3, 4], 1, async (x) => {
        started.push(x);
        if (x === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});

describe('engine counts', () => {
  it('defaults to cores - 1, at most 6; full build at most 2', () => {
    expect(defaultEngineCount('lite-single', 1)).toBe(1);
    expect(defaultEngineCount('lite-single', 4)).toBe(3);
    expect(defaultEngineCount('lite-single', 12)).toBe(6);
    expect(defaultEngineCount('full-single', 12)).toBe(2);
    expect(maxEngineCount('lite-single', 12)).toBe(8);
    expect(maxEngineCount('full-single', 12)).toBe(2);
  });
});
