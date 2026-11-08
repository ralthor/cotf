import { describe, expect, it, vi } from 'vitest';
import {
  ChessComClient,
  chessComToGameRecord,
  isChessComGameUrl,
  monthArchiveUrl,
  normaliseChessComUsername,
  utcYearMonth,
} from './chesscom';
import { LichessClient, lichessToGameRecord, parseLichessGameId } from './lichess';
import { ImportError, readNdjson } from './http';
import { EN_PASSANT, ITALIAN_CASTLING } from '../../test/fixtures/pgn';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const noSleep = () => Promise.resolve();

describe('Chess.com', () => {
  it('builds YYYY/MM archive URLs and UTC months', () => {
    expect(monthArchiveUrl('example_player', 2026, 11)).toBe('https://api.chess.com/pub/player/example_player/games/2026/11');
    expect(monthArchiveUrl('example_player', 2026, 3)).toMatch(/2026\/03$/);
    expect(utcYearMonth(new Date('2026-11-30T23:30:00-05:00'))).toEqual({ year: 2026, month: 12 });
  });

  it('validates usernames', () => {
    expect(normaliseChessComUsername(' Example_Player ')).toBe('example_player');
    expect(() => normaliseChessComUsername('bad name!')).toThrow(ImportError);
  });

  it('recognises game URLs (unsupported for direct import)', () => {
    expect(isChessComGameUrl('https://www.chess.com/game/live/123456')).toBe(true);
    expect(isChessComGameUrl('https://lichess.org/abcdefgh')).toBe(false);
  });

  it('lists latest games first, skips variants, tolerates missing fields and tcn', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/archives'))
        return json({ archives: ['https://api.chess.com/pub/player/example_player/games/2026/10', 'https://api.chess.com/pub/player/example_player/games/2026/11'] });
      if (url.endsWith('/2026/11'))
        return json({
          games: [
            { url: 'https://www.chess.com/game/live/1', pgn: ITALIAN_CASTLING, end_time: 100, rules: 'chess', tcn: 'mC0K' },
            { url: 'https://www.chess.com/game/live/2', pgn: EN_PASSANT, end_time: 200, rules: 'chess', accuracies: { white: 88.1 } },
            { url: 'https://www.chess.com/game/live/3', pgn: EN_PASSANT, end_time: 300, rules: 'chess960' },
            { end_time: 50 },
            'garbage',
          ],
        });
      throw new Error('unexpected ' + url);
    });
    const c = new ChessComClient({ fetch, sleep: noSleep });
    const r = await c.recentGames('example_player');
    expect(r.months).toEqual(['https://api.chess.com/pub/player/example_player/games/2026/11']);
    expect(r.games.map((g) => g.end_time)).toEqual([200, 100]);
    expect(r.skipped).toEqual([
      { reason: 'non-standard variant', count: 1 },
      { reason: 'no PGN in archive', count: 1 },
    ]);
    const rec = chessComToGameRecord(r.games[0]!);
    expect(rec.source).toBe('chesscom');
    expect(rec.providerData?.accuracies?.white).toBe(88.1);
    expect(rec.id).toBe('url:https://www.chess.com/game/live/2');
  });

  it('handles empty archives', async () => {
    const c = new ChessComClient({ fetch: async () => json({ archives: [] }), sleep: noSleep });
    expect((await c.recentGames('nobody')).games).toEqual([]);
  });

  it('retries after 429 and reuses cached body on 304', async () => {
    let calls = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 1) return new Response('', { status: 429 });
      if ((init?.headers as Record<string, string>)['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
      return json({ archives: [] }, { headers: { ETag: '"v1"' } });
    });
    const c = new ChessComClient({ fetch, sleep: noSleep, manualConditional: true });
    expect(await c.archives('example_player')).toEqual([]);
    expect(await c.archives('example_player')).toEqual([]);
    expect(calls).toBe(3);
  });

  it('reports network/CORS failures with a PGN fallback hint', async () => {
    const c = new ChessComClient({ fetch: async () => { throw new TypeError('Failed to fetch'); }, sleep: noSleep });
    await expect(c.archives('example_player')).rejects.toMatchObject({ kind: 'network', message: expect.stringMatching(/CORS/) });
  });
});

describe('Lichess', () => {
  it('parses game URLs and IDs', () => {
    expect(parseLichessGameId('https://lichess.org/AbCd1234')).toBe('AbCd1234');
    expect(parseLichessGameId('https://lichess.org/AbCd1234/black')).toBe('AbCd1234');
    expect(parseLichessGameId('https://lichess.org/AbCd1234wxyz')).toBe('AbCd1234');
    expect(parseLichessGameId('lichess.org/AbCd1234#32')).toBe('AbCd1234');
    expect(parseLichessGameId('AbCd1234')).toBe('AbCd1234');
    expect(parseLichessGameId('https://evil.example/AbCd1234')).toBeNull();
    expect(parseLichessGameId('https://lichess.org.evil.example/AbCd1234')).toBeNull();
    expect(parseLichessGameId('https://lichess.org/@/someone')).toBeNull();
  });

  it('streams NDJSON, skipping unfinished and variant games', async () => {
    const lines = [
      { id: 'aaaaaaaa', status: 'resign', variant: 'standard', lastMoveAt: 1000, pgn: ITALIAN_CASTLING, players: { white: { user: { name: 'A' } } } },
      { id: 'bbbbbbbb', status: 'started', variant: 'standard', lastMoveAt: 3000, pgn: EN_PASSANT },
      { id: 'cccccccc', status: 'mate', variant: 'chess960', lastMoveAt: 2000, pgn: EN_PASSANT },
      { id: 'dddddddd', status: 'outoftime', variant: 'standard', lastMoveAt: 4000, pgn: EN_PASSANT },
    ];
    const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n{"id":"trunc';
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/api/games/user/someone?');
      expect(url).toContain('pgnInJson=true');
      expect((init?.headers as Record<string, string>).Accept).toBe('application/x-ndjson');
      return new Response(body, { status: 200 });
    });
    const r = await new LichessClient({ fetch, sleep: noSleep }).recentGames('someone', { max: 10 });
    expect(r.games.map((g) => g.id)).toEqual(['dddddddd', 'aaaaaaaa']);
    expect(r.skipped).toEqual(expect.arrayContaining([{ reason: 'game not finished', count: 1 }, { reason: 'non-standard variant', count: 1 }]));
    const rec = lichessToGameRecord(r.games[1]!);
    expect(rec.source).toBe('lichess');
    expect(rec.sourceUrl).toBe('https://lichess.org/aaaaaaaa');
  });

  it('refuses games in progress', async () => {
    const fetch = async () => json({ id: 'bbbbbbbb', status: 'started', variant: 'standard', pgn: EN_PASSANT });
    await expect(new LichessClient({ fetch, sleep: noSleep }).game('bbbbbbbb')).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('backs off at least 60 s on 429', async () => {
    const sleep = vi.fn(noSleep);
    let n = 0;
    const fetch = async () => (n++ === 0 ? new Response('', { status: 429 }) : json({ id: 'aaaaaaaa', status: 'mate', variant: 'standard', pgn: EN_PASSANT }));
    await new LichessClient({ fetch, sleep }).game('aaaaaaaa');
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('serialises requests (one at a time)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetch = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json({ id: 'aaaaaaaa', status: 'mate', variant: 'standard', pgn: EN_PASSANT });
    };
    const c = new LichessClient({ fetch, sleep: noSleep });
    await Promise.all([c.game('aaaaaaaa'), c.game('aaaaaaab'), c.game('aaaaaaac')]);
    expect(maxInFlight).toBe(1);
  });
});

describe('readNdjson', () => {
  it('handles chunk boundaries inside a line', async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('{"a":1}\n{"b"'));
        c.enqueue(enc.encode(':2}\n'));
        c.close();
      },
    });
    const out: unknown[] = [];
    for await (const o of readNdjson(new Response(stream))) out.push(o);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
