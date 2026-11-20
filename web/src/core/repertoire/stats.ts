import { isDue } from './srs';
import type { Chapter, PosKey, RepNode, TrainCard, TrainLogEntry } from './types';

/** Stability (days) from which a position counts as mastered. */
export const MASTERED_DAYS = 21;
const DAY = 86_400_000;

export type DayCount = { day: string; answers: number; good: number };

export type ChapterProgress = { chapter: Chapter; positions: number; learnt: number; mastered: number; answers: number; good: number };

export type HardPosition = { posKey: PosKey; answers: number; failed: number };

export type Stats = {
  positions: number;
  learnt: number;
  mastered: number;
  due: number;
  answers: number;
  good: number;
  /** First-time accuracy (0–1) in the last 30 days and the 30 before; null without answers. */
  accuracy: number | null;
  previousAccuracy: number | null;
  /** The last 30 local days, oldest first. */
  days: DayCount[];
  streak: number;
  bestStreak: number;
  bestDay: DayCount | null;
  bestRun: number;
  chapters: ChapterProgress[];
  hardest: HardPosition[];
};

/** Local calendar day "YYYY-MM-DD". */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Positions where it is the chapter's side to move and the chapter has a move. */
export function chapterCards(ch: Chapter): Set<PosKey> {
  const out = new Set<PosKey>();
  const walk = (n: RepNode) => {
    if (n.children.length && n.fen.split(' ')[1] === ch.side) out.add(n.posKey);
    n.children.forEach(walk);
  };
  walk(ch.root);
  return out;
}

const isMastered = (c: TrainCard | undefined) => !!c && c.srs.stability >= MASTERED_DAYS;
const ratio = (good: number, n: number) => (n ? good / n : null);

/**
 * Progress for one repertoire and side: `positions` are the cards in scope, `log` the answers for
 * that side in any order (only graded answers are logged).
 */
export function computeStats(
  positions: readonly PosKey[],
  chapters: readonly Chapter[],
  cards: ReadonlyMap<PosKey, TrainCard>,
  log: readonly TrainLogEntry[],
  now = new Date(),
): Stats {
  const inScope = new Set(positions);
  // Mistakes found in games are not training answers.
  const entries = log.filter((e) => inScope.has(e.posKey) && e.mode !== 'game').sort((a, b) => a.at.localeCompare(b.at));

  let learnt = 0;
  let mastered = 0;
  let due = 0;
  for (const k of positions) {
    const c = cards.get(k);
    if (!c) continue;
    learnt++;
    if (isMastered(c)) mastered++;
    if (isDue(c.srs, now)) due++;
  }

  // Accuracy: last 30 days against the 30 before.
  const t = now.getTime();
  let recent = 0;
  let recentGood = 0;
  let before = 0;
  let beforeGood = 0;
  for (const e of entries) {
    const age = t - Date.parse(e.at);
    if (age < 30 * DAY) [recent, recentGood] = [recent + 1, recentGood + Number(e.result === 'good')];
    else if (age < 60 * DAY) [before, beforeGood] = [before + 1, beforeGood + Number(e.result === 'good')];
  }

  // Answers per local day.
  const perDay = new Map<string, DayCount>();
  for (const e of entries) {
    const k = dayKey(new Date(e.at));
    const d = perDay.get(k) ?? { day: k, answers: 0, good: 0 };
    d.answers++;
    if (e.result === 'good') d.good++;
    perDay.set(k, d);
  }
  const days: DayCount[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    days.push(perDay.get(k) ?? { day: k, answers: 0, good: 0 });
  }

  // Streaks: consecutive local days with answers; the current one may end today or yesterday.
  const trained = new Set(perDay.keys());
  const back = (k: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - k);
    return dayKey(d);
  };
  let streak = 0;
  for (let i = trained.has(back(0)) ? 0 : 1; trained.has(back(i)); i++) streak++;
  let bestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of [...trained].sort()) {
    const next = prev ? new Date(`${prev}T12:00:00`) : null;
    next?.setDate(next.getDate() + 1);
    run = next && dayKey(next) === k ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = k;
  }
  let bestDay: DayCount | null = null;
  for (const d of perDay.values()) if (!bestDay || d.answers > bestDay.answers) bestDay = d;
  let bestRun = 0;
  let goodRun = 0;
  for (const e of entries) {
    goodRun = e.result === 'good' ? goodRun + 1 : 0;
    bestRun = Math.max(bestRun, goodRun);
  }

  const chapterStats = chapters.map((chapter): ChapterProgress => {
    const set = chapterCards(chapter);
    let cl = 0;
    let cm = 0;
    for (const k of set) {
      const c = cards.get(k);
      if (c) cl++;
      if (isMastered(c)) cm++;
    }
    const es = entries.filter((e) => set.has(e.posKey));
    return { chapter, positions: set.size, learnt: cl, mastered: cm, answers: es.length, good: es.filter((e) => e.result === 'good').length };
  });

  const byPos = new Map<PosKey, HardPosition>();
  for (const e of entries) {
    const h = byPos.get(e.posKey) ?? { posKey: e.posKey, answers: 0, failed: 0 };
    h.answers++;
    if (e.result === 'wrong' || e.result === 'shown') h.failed++;
    byPos.set(e.posKey, h);
  }
  const hardest = [...byPos.values()]
    .filter((h) => h.answers >= 2 && h.failed > 0)
    .sort((a, b) => b.failed / b.answers - a.failed / a.answers || b.failed - a.failed)
    .slice(0, 10);

  return {
    positions: positions.length,
    learnt,
    mastered,
    due,
    answers: entries.length,
    good: entries.filter((e) => e.result === 'good').length,
    accuracy: ratio(recentGood, recent),
    previousAccuracy: ratio(beforeGood, before),
    days,
    streak,
    bestStreak,
    bestDay,
    bestRun,
    chapters: chapterStats,
    hardest,
  };
}
