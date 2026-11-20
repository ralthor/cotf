import { describe, expect, it } from 'vitest';
import { parseRepertoirePgn } from './parse';
import { review } from './srs';
import {
  ahead,
  answerResult,
  buildTrainGraph,
  hintFor,
  isCard,
  lineLabel,
  myMoves,
  pickReply,
  pickShown,
  pickStart,
  positionLabel,
  reschedules,
  theirMoves,
} from './trainer';
import type { Chapter, Side } from './types';
import { ANNOTATED, TRANSPOSITION } from '../../test/fixtures/repertoire';

function chapters(pgn: string, side?: Side): Chapter[] {
  return parseRepertoirePgn(pgn).chapters.map((p, i) => ({
    id: `c${i}`,
    repertoireId: 'r',
    title: p.title ?? 'x',
    side: side ?? p.orientation ?? 'w',
    source: { kind: 'pgn-paste' },
    importedAt: '',
    headers: p.headers,
    startFen: p.startFen,
    root: p.root,
    order: i,
  }));
}

const all = () => true;

describe('training graph', () => {
  const g = buildTrainGraph(chapters(ANNOTATED), 'w');
  const start = g.starts[0]!;

  it('has one start and cards only where it is your move', () => {
    expect(g.starts).toHaveLength(1);
    expect(isCard(g, start)).toBe(true);
    expect(myMoves(g, start).map((m) => m.san)).toEqual(['e4']);
    // After 1. e4 it is Black's move: not a card.
    const afterE4 = myMoves(g, start)[0]!.to;
    expect(isCard(g, afterE4)).toBe(false);
    expect(theirMoves(g, afterE4).map((m) => m.san)).toEqual(['e5']);
    // White moves: 1. e4, 2. Nf3, 3. Bc4 (main), 3. d4 / 3. Bc4 and 4. d4 / 4. Ng5 (Philidor), 3. Nxe5 (Petroff).
    expect(g.cards.length).toBe(7);
  });

  it('counts the cards ahead and ignores the other side', () => {
    expect(ahead(g, start, all)).toBe(g.cards.length);
    expect(ahead(g, start, () => false)).toBe(0);
    expect(buildTrainGraph(chapters(ANNOTATED), 'b').cards).toEqual([]);
  });

  it('only plays replies with something to train behind them', () => {
    const afterNf3 = [...g.from.values()].flat().find((m) => m.san === 'Nf3')!.to;
    const replies = theirMoves(g, afterNf3).map((m) => m.san);
    expect(replies.sort()).toEqual(['Nc6', 'Nf6', 'd6']);
    const petroffCard = theirMoves(g, afterNf3).find((m) => m.san === 'Nf6')!.to;
    const onlyPetroff = (k: string) => k === petroffCard;
    for (const r of [0, 0.5, 0.99]) expect(pickReply(g, afterNf3, onlyPetroff, () => r)?.san).toBe('Nf6');
    expect(pickReply(g, afterNf3, () => false)).toBeNull();
  });

  it('shows the move with the most to learn and starts lines where there is work', () => {
    expect(pickShown(g, start, all)?.san).toBe('e4');
    expect(pickStart(g, all, true)).toBe(start);
    expect(pickStart(g, () => false, true)).toBeNull();
    expect(pickStart(g, all, false, () => 0.3)).toBe(start);
  });

  it('merges transpositions into one card', () => {
    const t = buildTrainGraph(chapters(TRANSPOSITION), 'b');
    // 1. d4 Nf6 2. c4 e6 and 1. c4 e6 2. d4 Nf6: four positions to answer, both lines end in one position.
    expect(t.cards).toHaveLength(4);
    const ends = [...t.from.values()].flat().filter((m) => m.san === 'e6' || m.san === 'Nf6').map((m) => m.to);
    expect(new Set(ends.filter((k) => !t.from.has(k))).size).toBe(1);
    expect(ahead(t, t.starts[0]!, all)).toBe(4);
  });
});

describe('answers', () => {
  it('turns tries into results and decides what is rescheduled', () => {
    expect(answerResult({ wrong: 0, hint: 0, shown: false })).toBe('good');
    expect(answerResult({ wrong: 0, hint: 2, shown: false })).toBe('hinted');
    expect(answerResult({ wrong: 1, hint: 2, shown: false })).toBe('wrong');
    expect(answerResult({ wrong: 1, hint: 0, shown: true })).toBe('shown');
    expect(reschedules(true, 'good')).toBe(true);
    expect(reschedules(false, 'good')).toBe(false);
    expect(reschedules(false, 'hinted')).toBe(false);
    expect(reschedules(false, 'wrong')).toBe(true);
  });

  it('gives hints step by step', () => {
    const g = buildTrainGraph(chapters(ANNOTATED), 'w');
    const moves = myMoves(g, g.starts[0]!);
    expect(hintFor(moves, 0)).toEqual({ squares: [], arrows: [] });
    expect(hintFor(moves, 1).squares).toEqual(['e2']);
    expect(hintFor(moves, 2).squares).toEqual(['e2', 'e4']);
    expect(hintFor(moves, 3).arrows).toEqual([['e2', 'e4']]);
  });

  it('schedules with FSRS: a failure comes back sooner than a success', async () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const good = await review(undefined, 'good', now);
    const again = await review(undefined, 'wrong', now);
    expect(good.reps).toBe(1);
    expect(good.dueAt.getTime()).toBeGreaterThan(again.dueAt.getTime());
    const lapse = await review(good, 'wrong', good.dueAt);
    expect(lapse.lapses).toBe(1);
  });
});

describe('labels', () => {
  it('writes move numbers', () => {
    const g = buildTrainGraph(chapters(ANNOTATED), 'w');
    const root = g.chapters[0]!.root;
    expect(lineLabel(root, [0, 0, 0])).toBe('1. e4 e5 2. Nf3');
    expect(lineLabel(root, [])).toBe('');
    const bc4 = [...g.from.values()].flat().find((m) => m.san === 'Bc4' && m.main)!;
    expect(positionLabel(g, bc4.to)).toBe('1. e4 e5 2. Nf3 Nc6 3. Bc4');
  });
});
