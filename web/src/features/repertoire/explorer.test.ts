import { describe, expect, it, vi } from 'vitest';
import { ExplorerClient, ExplorerError, explorerUrl, ratingGroupsFor } from './explorer';

const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const body = { white: 10, draws: 5, black: 7, moves: [{ uci: 'c7c5', san: 'c5', white: 4, draws: 2, black: 3, averageRating: 2400 }, { bad: 1 }], opening: { eco: 'B00', name: "King's Pawn Game" } };

describe('opening explorer', () => {
  it('sends the token, parses and caches', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const c = new ExplorerClient(f);
    const r = await c.get('masters', FEN, 'tok');
    expect(r.moves).toEqual([{ uci: 'c7c5', san: 'c5', white: 4, draws: 2, black: 3, averageRating: 2400 }]);
    expect(r.opening?.eco).toBe('B00');
    await c.get('masters', FEN, 'tok');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(explorerUrl('masters', FEN));
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(explorerUrl('lichess', FEN)).toContain('speeds=blitz');
    // No token: no Authorization header (the masters database is open).
    await new ExplorerClient(f).get('masters', 'x', '');
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('Authorization');
  });

  it('reports a missing or wrong token and rate limits', async () => {
    const code = async (status: number) => {
      try {
        await new ExplorerClient(async () => new Response('', { status })).get('lichess', FEN, 'x');
        return 'ok';
      } catch (e) {
        return (e as ExplorerError).code;
      }
    };
    expect(await code(401)).toBe('token');
    expect(await code(429)).toBe('rate');
    expect(await code(500)).toBe('network');
  });

  it('compares with players near your rating, at your speeds', () => {
    expect(ratingGroupsFor(1650)).toEqual([1600, 1800]);
    expect(ratingGroupsFor(900)).toEqual([0, 1000]);
    expect(ratingGroupsFor(2700)).toEqual([2500]);
    const url = new URL(explorerUrl('lichess', FEN, { ratings: [1600, 1800], speeds: ['rapid'] }));
    expect(url.searchParams.get('ratings')).toBe('1600,1800');
    expect(url.searchParams.get('speeds')).toBe('rapid');
  });
});
