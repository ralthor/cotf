import { describe, expect, it } from 'vitest';
import { BackupError, makeBackup, parseBackup } from './backup';
import { review } from './srs';

const rep = { id: 'r1', name: 'Italian', createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z' };

describe('backup file', () => {
  it('round-trips cards with their dates', async () => {
    const srs = await review(undefined, 'good', new Date('2026-11-20T10:00:00Z'));
    const text = makeBackup({
      repertoires: [rep],
      chapters: [],
      trainCards: [{ repertoireId: 'r1', side: 'w', posKey: 'k', srs }],
      trainLog: [{ id: 7, repertoireId: 'r1', side: 'w', posKey: 'k', at: '2026-11-20T10:00:00Z', mode: 'learn', result: 'good', wrong: [], expected: ['e4'], ms: 1 }],
    });
    const b = parseBackup(text);
    expect(b.repertoires).toEqual([rep]);
    expect(b.trainCards[0]!.srs.dueAt).toEqual(srs.dueAt);
    expect(b.trainCards[0]!.srs.lastReviewAt).toEqual(srs.lastReviewAt);
    expect(b.trainLog[0]).not.toHaveProperty('id');
    // The restored card still schedules.
    expect((await review(b.trainCards[0]!.srs, 'good', new Date('2026-12-01T00:00:00Z'))).reps).toBe(2);
  });

  it('refuses files it cannot read', () => {
    const code = (text: string) => {
      try {
        parseBackup(text);
        return 'ok';
      } catch (e) {
        return (e as BackupError).code;
      }
    };
    expect(code('not json')).toBe('json');
    expect(code('{"format":"other","version":1}')).toBe('format');
    expect(code(JSON.stringify({ format: 'chess-on-the-fly/openings', version: 99 }))).toBe('newer');
    const base = { format: 'chess-on-the-fly/openings', version: 1, repertoires: [rep], chapters: [], trainCards: [], trainLog: [] };
    expect(code(JSON.stringify(base))).toBe('ok');
    expect(code(JSON.stringify({ ...base, chapters: [{ id: 'c', repertoireId: 'other', root: {} }] }))).toBe('invalid');
    expect(code(JSON.stringify({ ...base, trainCards: [{ repertoireId: 'r1', posKey: 'k', srs: { dueAt: 'nope' } }] }))).toBe('invalid');
    expect(code(JSON.stringify({ ...base, trainLog: 3 }))).toBe('invalid');
  });
});
