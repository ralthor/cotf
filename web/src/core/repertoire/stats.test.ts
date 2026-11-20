import { describe, expect, it } from 'vitest';
import { parseRepertoirePgn } from './parse';
import { review } from './srs';
import { chapterCards, computeStats, dayKey } from './stats';
import { buildTrainGraph } from './trainer';
import type { AnswerResult } from './srs';
import type { Chapter, TrainCard, TrainLogEntry } from './types';
import { ANNOTATED } from '../../test/fixtures/repertoire';

const chapters: Chapter[] = parseRepertoirePgn(ANNOTATED).chapters.map((p, i) => ({
  id: `c${i}`,
  repertoireId: 'r',
  title: 'Italian',
  side: 'w',
  source: { kind: 'pgn-paste' },
  importedAt: '',
  headers: p.headers,
  startFen: p.startFen,
  root: p.root,
  order: i,
}));
const g = buildTrainGraph(chapters, 'w');
const now = new Date(2026, 10, 20, 15, 0, 0); // local time
const daysAgo = (n: number, hour = 10) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, hour).toISOString();
const entry = (posKey: string, at: string, result: AnswerResult): TrainLogEntry => ({
  repertoireId: 'r',
  side: 'w',
  posKey,
  at,
  mode: 'memorise',
  result,
  wrong: [],
  expected: [],
  ms: 1000,
});

describe('progress statistics', () => {
  it('counts positions per chapter like the training graph', () => {
    expect(chapterCards(chapters[0]!).size).toBe(g.cards.length);
  });

  it('counts learnt, mastered and due cards', async () => {
    const [a, b] = g.cards;
    const fresh = await review(undefined, 'good', now);
    const cards = new Map<string, TrainCard>([
      [a!, { repertoireId: 'r', side: 'w', posKey: a!, srs: { ...fresh, stability: 30 } }],
      [b!, { repertoireId: 'r', side: 'w', posKey: b!, srs: { ...fresh, dueAt: new Date(now.getTime() - 1000) } }],
    ]);
    const s = computeStats(g.cards, chapters, cards, [], now);
    expect(s).toMatchObject({ positions: g.cards.length, learnt: 2, mastered: 1, due: 1, answers: 0, accuracy: null, streak: 0 });
    expect(s.chapters[0]).toMatchObject({ positions: g.cards.length, learnt: 2, mastered: 1 });
  });

  it('computes accuracy, days, streaks, records and the hardest positions', () => {
    const [a, b, c] = g.cards;
    const log = [
      entry(a!, daysAgo(0), 'good'),
      entry(b!, daysAgo(0), 'wrong'),
      entry(b!, daysAgo(1), 'shown'),
      entry(a!, daysAgo(1), 'good'),
      entry(c!, daysAgo(2), 'good'),
      entry(c!, daysAgo(2, 11), 'good'),
      entry(a!, daysAgo(5), 'good'),
      entry(a!, daysAgo(6), 'good'),
      entry(a!, daysAgo(40), 'wrong'),
      entry(a!, daysAgo(41), 'good'),
      entry('not-in-scope', daysAgo(0), 'wrong'),
    ];
    const s = computeStats(g.cards, chapters, new Map(), log, now);
    expect(s.answers).toBe(10);
    expect(s.accuracy).toBeCloseTo(6 / 8);
    expect(s.previousAccuracy).toBeCloseTo(1 / 2);
    expect(s.days).toHaveLength(30);
    expect(s.days[29]).toEqual({ day: dayKey(now), answers: 2, good: 1 });
    expect(s.days[27]!.answers).toBe(2);
    expect(s.streak).toBe(3);
    expect(s.bestStreak).toBe(3);
    expect(s.bestDay?.answers).toBe(2);
    // Oldest first: good (41 days ago), wrong, then good ×4, shown, good, wrong (b today at 10:00 sorts after a).
    expect(s.bestRun).toBe(4);
    expect(s.hardest.map((h) => [h.posKey, h.answers, h.failed])).toEqual([
      [b, 2, 2],
      [a, 6, 1],
    ]);
  });

  it('keeps a streak that ended yesterday', () => {
    const s = computeStats(g.cards, chapters, new Map(), [entry(g.cards[0]!, daysAgo(1), 'good'), entry(g.cards[0]!, daysAgo(2), 'good')], now);
    expect(s.streak).toBe(2);
  });
});
