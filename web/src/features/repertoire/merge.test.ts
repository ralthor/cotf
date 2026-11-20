import { describe, expect, it } from 'vitest';
import { parseRepertoirePgn } from '../../core/repertoire/parse';
import { LICHESS_STUDY } from '../../test/fixtures/repertoire';
import { mergeChapters } from './useRepertoires';

describe('mergeChapters', () => {
  const study = parseRepertoirePgn(LICHESS_STUDY).chapters;
  const origin = { kind: 'lichess-study', ref: { studyId: 'AbCdEfGh' } } as const;

  it('gives study chapters stable ids and their orientation', () => {
    const r = mergeChapters('r1', [], study, origin, 'w', 'T1');
    expect(r.chapters.map((c) => [c.id, c.side, c.order])).toEqual([
      ['lichess:AbCdEfGh:IjKlMnOp', 'b', 0],
      ['lichess:AbCdEfGh:QrStUvWx', 'w', 1],
    ]);
    expect(r.chapters[0]!.source).toMatchObject({ kind: 'lichess-study', url: 'https://lichess.org/study/AbCdEfGh/IjKlMnOp', studyName: 'My repertoire' });
    expect([r.added, r.updated]).toEqual([2, 0]);
  });

  it('replaces chapters on re-import, keeping order and the chosen side', () => {
    const first = mergeChapters('r1', [], study, origin, 'w', 'T1').chapters;
    const edited = first.map((c) => (c.id.endsWith('QrStUvWx') ? { ...c, side: 'b' as const } : c));
    const pasted = mergeChapters('r1', edited, parseRepertoirePgn('1. d4 d5 *').chapters, { kind: 'pgn-paste' }, 'w', 'T2').chapters;
    const again = mergeChapters('r1', pasted, study, origin, 'w', 'T3');
    expect([again.added, again.updated]).toEqual([0, 2]);
    expect(again.chapters.map((c) => [c.side, c.order, c.importedAt])).toEqual([
      ['b', 0, 'T3'],
      ['b', 1, 'T3'],
      ['w', 2, 'T2'],
    ]);
  });
});

describe('study scope', () => {
  it('remembers whether the whole study or one chapter was imported', () => {
    const study = parseRepertoirePgn(LICHESS_STUDY).chapters;
    const whole = mergeChapters('r1', [], study, { kind: 'lichess-study', ref: { studyId: 'AbCdEfGh' } }, 'w').chapters;
    const one = mergeChapters('r1', [], study.slice(0, 1), { kind: 'lichess-study', ref: { studyId: 'AbCdEfGh', chapterId: 'IjKlMnOp' } }, 'w').chapters;
    expect(whole.map((c) => c.source.kind === 'lichess-study' && c.source.wholeStudy)).toEqual([true, true]);
    expect(one.map((c) => c.source.kind === 'lichess-study' && c.source.wholeStudy)).toEqual([false]);
  });
});
