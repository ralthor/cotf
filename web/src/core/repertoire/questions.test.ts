import { describe, expect, it } from 'vitest';
import { parseRepertoirePgn } from './parse';
import { questionFor } from './questions';
import { findTraps } from './traps';
import { buildTrainGraph } from './trainer';
import type { Chapter, RepNode } from './types';

function root(pgn: string): RepNode {
  return parseRepertoirePgn(pgn).chapters[0]!.root;
}
const at = (r: RepNode, path: number[]) => path.reduce((n, i) => n.children[i]!, r);

describe('reasoning questions', () => {
  it('uses a question written by the author', () => {
    const r = root('1. e4 { Q: Why e4? A: It frees the queen and the bishop. } *');
    expect(questionFor(at(r, [0]), r.fen, 'e2e4')).toEqual({ kind: 'author', question: 'Why e4?', answer: 'It frees the queen and the bishop.' });
  });

  it('asks where the plan is aimed from arrows, leaving out the move itself', () => {
    const r = root('1. e4 { [%cal Ge2e4,Gd1h5] [%csl Rf7] } *');
    expect(questionFor(at(r, [0]), r.fen, 'e2e4')).toEqual({ kind: 'plan', squares: ['h5', 'f7'], arrows: [['d1', 'h5']] });
    const only = root('1. e4 { [%cal Ge2e4] } *');
    expect(questionFor(at(only, [0]), only.fen, 'e2e4')).toBeNull();
  });

  it('blanks a move from the comment, with legal distractors', () => {
    const r = root('1. e4 e5 2. Nf3 { Next comes Bc4, aiming at f7. } *');
    const n = at(r, [0, 0, 0]);
    const q = questionFor(n, at(r, [0, 0]).fen, 'g1f3');
    expect(q?.kind).toBe('blank');
    if (q?.kind !== 'blank') return;
    expect(q.answer).toBe('Bc4');
    expect(q.text).toBe('Next comes ____, aiming at f7.');
    expect(q.choices).toHaveLength(3);
    expect(q.choices).toContain('Bc4');
    expect(new Set(q.choices).size).toBe(3);
    // Same position, same question.
    expect(questionFor(n, at(r, [0, 0]).fen, 'g1f3')).toEqual(q);
  });

  it('falls back to a square, and to nothing', () => {
    const r = root('1. d4 { Control of e5 matters. } *');
    const q = questionFor(at(r, [0]), r.fen, 'd2d4');
    expect(q).toMatchObject({ kind: 'blank', answer: 'e5', text: 'Control of ____ matters.' });
    const plain = root('1. d4 { A solid start. } *');
    expect(questionFor(at(plain, [0]), plain.fen, 'd2d4')).toBeNull();
    expect(questionFor(at(root('1. d4 *'), [0]), root('1. d4 *').fen, 'd2d4')).toBeNull();
  });
});

describe('traps', () => {
  it('finds opponent mistakes marked in the study with your answer', () => {
    const pgn = `[Orientation "white"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4?! 4. Nxe5 Qg5?? 5. Nxf7 ( 4... Qe7 ) *`;
    const p = parseRepertoirePgn(pgn).chapters[0]!;
    const ch: Chapter = { id: 'c', repertoireId: 'r', title: 'Italian', side: 'w', source: { kind: 'pgn-paste' }, importedAt: '', headers: p.headers, startFen: p.startFen, root: p.root, order: 0 };
    const traps = findTraps(buildTrainGraph([ch], 'w'));
    expect(traps.map((t) => [t.mistake.san, t.replies.map((m) => m.san), t.nag])).toEqual([
      ['Qg5', ['Nxf7'], 4],
      ['Nd4', ['Nxe5'], 6],
    ]);
    expect(traps[0]!.line).toBe('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5');
  });
});
