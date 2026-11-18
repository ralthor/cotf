import { describe, expect, it, vi } from 'vitest';
import { addressWithoutDeepLink, importLichessGame, invalidDeepLinkReason, lichessGameRecordId, readDeepLink } from './deepLink';
import { LichessClient } from '../features/import/lichess';
import { EN_PASSANT } from '../test/fixtures/pgn';

const game = (id: string) => ({ kind: 'lichess', id });

describe('Lichess deep link', () => {
  it('reads the game id from the hash query', () => {
    expect(readDeepLink('', '#/analyse?lichess=abcdefgh')).toEqual(game('abcdefgh'));
    expect(readDeepLink('', '#/analyse?lichess=abcdefgh1234')).toEqual(game('abcdefgh')); // player-specific id
    expect(readDeepLink('', '#/analyse?lichess=https%3A%2F%2Flichess.org%2Fabcdefgh')).toEqual(game('abcdefgh'));
    expect(readDeepLink('', '#/analyse?lichess=https://lichess.org/abcdefgh/black')).toEqual(game('abcdefgh'));
    expect(readDeepLink('', '#?lichess=abcdefgh')).toEqual(game('abcdefgh'));
  });

  it('reads the game id from the real query string', () => {
    expect(readDeepLink('?lichess=abcdefgh', '')).toEqual(game('abcdefgh'));
    expect(readDeepLink('?lichess=https://lichess.org/abcdefgh', '#/analyse')).toEqual(game('abcdefgh'));
    expect(readDeepLink('?lichess=https%3A%2F%2Flichess.org%2Fabcdefgh&x=1', '')).toEqual(game('abcdefgh'));
  });

  it('prefers the hash when both are set', () => {
    expect(readDeepLink('?lichess=aaaaaaaa', '#/analyse?lichess=bbbbbbbb')).toEqual(game('bbbbbbbb'));
  });

  it('ignores a missing parameter', () => {
    expect(readDeepLink('', '#/analyse')).toBeNull();
    expect(readDeepLink('', '')).toBeNull();
    expect(readDeepLink('?lichess=', '#/analyse?lichess=')).toBeNull();
  });

  it('reports invalid values instead of dropping them', () => {
    expect(readDeepLink('', '#/analyse?lichess=short')).toEqual({ kind: 'invalid', value: 'short' });
    expect(readDeepLink('?lichess=https://evil.example/abcdefgh', '')?.kind).toBe('invalid');
    const study = readDeepLink('?lichess=https://lichess.org/study/abcdefgh/ijklmnop', '');
    expect(study?.kind).toBe('invalid');
    expect(invalidDeepLinkReason('https://lichess.org/study/abcdefgh/ijklmnop')).toMatch(/studies/);
  });

  it('removes only the deep-link parameter from the address', () => {
    expect(addressWithoutDeepLink('/cotf/', '', '#/analyse?lichess=abcdefgh')).toBe('/cotf/#/analyse');
    expect(addressWithoutDeepLink('/cotf/', '?lichess=abcdefgh', '')).toBe('/cotf/');
    expect(addressWithoutDeepLink('/', '?lichess=abcdefgh&x=1', '#/stats?lichess=a&y=2')).toBe('/?x=1#/stats?y=2');
  });

  it('imports the game under the same id as a pasted URL', async () => {
    const fetch = vi.fn(async (_url: string) =>
      new Response(JSON.stringify({ id: 'abcdefgh', status: 'mate', variant: 'standard', pgn: EN_PASSANT }), { status: 200 }),
    );
    const g = await importLichessGame('abcdefgh', new LichessClient({ fetch, sleep: () => Promise.resolve() }));
    expect(g.id).toBe(lichessGameRecordId('abcdefgh'));
    expect(String(fetch.mock.calls[0]![0])).toContain('/game/export/abcdefgh');
  });
});
