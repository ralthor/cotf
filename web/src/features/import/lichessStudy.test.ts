import { describe, expect, it, vi } from 'vitest';
import { ImportError } from './http';
import { chapterRefFromHeaders, LichessStudyClient, parseStudyUrl } from './lichessStudy';
import { LICHESS_STUDY } from '../../test/fixtures/repertoire';

describe('parseStudyUrl', () => {
  it('accepts study and chapter URLs in their usual forms', () => {
    expect(parseStudyUrl('https://lichess.org/study/AbCdEfGh')).toEqual({ studyId: 'AbCdEfGh' });
    expect(parseStudyUrl('lichess.org/study/AbCdEfGh/IjKlMnOp')).toEqual({ studyId: 'AbCdEfGh', chapterId: 'IjKlMnOp' });
    expect(parseStudyUrl(' https://www.lichess.org/study/AbCdEfGh/IjKlMnOp#12 ')).toEqual({ studyId: 'AbCdEfGh', chapterId: 'IjKlMnOp' });
    expect(parseStudyUrl('https://lichess.org/study/AbCdEfGh?x=1')).toEqual({ studyId: 'AbCdEfGh' });
    expect(parseStudyUrl('https://lichess.org/study/AbCdEfGh/')).toEqual({ studyId: 'AbCdEfGh' });
    expect(parseStudyUrl('AbCdEfGh')).toEqual({ studyId: 'AbCdEfGh' });
  });

  it('rejects other links', () => {
    expect(parseStudyUrl('https://lichess.org/AbCdEfGh')).toBeNull();
    expect(parseStudyUrl('https://example.com/study/AbCdEfGh')).toBeNull();
    expect(parseStudyUrl('https://lichess.org/study/short')).toBeNull();
    expect(parseStudyUrl('')).toBeNull();
  });

  it('reads the chapter from [ChapterURL]', () => {
    expect(chapterRefFromHeaders({ ChapterURL: 'https://lichess.org/study/AbCdEfGh/IjKlMnOp' })).toEqual({
      studyId: 'AbCdEfGh',
      chapterId: 'IjKlMnOp',
    });
    expect(chapterRefFromHeaders({ Site: 'https://lichess.org/study/AbCdEfGh' })).toBeNull();
  });
});

describe('LichessStudyClient', () => {
  it('fetches a study and a chapter without clocks', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(LICHESS_STUDY, { status: 200 }));
    const client = new LichessStudyClient({ fetch, sleep: () => Promise.resolve() });
    expect(await client.pgn({ studyId: 'AbCdEfGh' })).toBe(LICHESS_STUDY);
    await client.pgn({ studyId: 'AbCdEfGh', chapterId: 'IjKlMnOp' });
    const urls = fetch.mock.calls.map((c) => c[0]);
    expect(urls[0]).toMatch(/^https:\/\/lichess\.org\/api\/study\/AbCdEfGh\.pgn\?/);
    expect(urls[0]).toContain('clocks=false');
    expect(urls[0]).toContain('variations=true');
    expect(urls[1]).toMatch(/\/api\/study\/AbCdEfGh\/IjKlMnOp\.pgn\?/);
  });

  it('explains a private or missing study', async () => {
    const client = new LichessStudyClient({ fetch: async () => new Response('', { status: 404 }), sleep: () => Promise.resolve() });
    const err = await client.pgn({ studyId: 'AbCdEfGh' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).kind).toBe('not-found');
    expect((err as ImportError).message).not.toMatch(/^repertoire\./); // translated, not the key
  });

  it('gives up after a repeated 429', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const client = new LichessStudyClient({ fetch: async () => new Response('', { status: 429 }), sleep });
    const err = await client.pgn({ studyId: 'AbCdEfGh' }).catch((e: unknown) => e);
    expect((err as ImportError).kind).toBe('rate-limited');
    expect(sleep).toHaveBeenCalledWith(60_000);
  });
});
