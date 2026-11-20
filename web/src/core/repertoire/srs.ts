import { DefaultScheduler, Rating, type DefaultSchedulerCard, type Grade } from 'ts-fsrs';

/** FSRS state of one training card (ts-fsrs, FSRS-7). Stored as is in IndexedDB (dates stay Dates). */
export type SrsCard = DefaultSchedulerCard;

/** How an answer went, from which the FSRS rating follows. */
export type AnswerResult = 'good' | 'hinted' | 'wrong' | 'shown';

export const RATING: Record<AnswerResult, Grade> = {
  good: Rating.Good,
  hinted: Rating.Hard,
  wrong: Rating.Again,
  shown: Rating.Again,
};

type Scheduler = Awaited<ReturnType<typeof DefaultScheduler<'FSRS-7'>>>;
let scheduler: Promise<Scheduler> | null = null;

/** The shared scheduler: FSRS-7 defaults, with fuzzing so cards learnt together spread out. */
export function getScheduler(): Promise<Scheduler> {
  scheduler ??= DefaultScheduler({ version: 'FSRS-7', enableFuzz: true });
  return scheduler;
}

/** The card after answering `result` at `now` (a new card when `card` is undefined). */
export async function review(card: SrsCard | undefined, result: AnswerResult, now = new Date()): Promise<SrsCard> {
  const s = await getScheduler();
  return s.review({ card: card ?? s.newCard({ now }), grade: RATING[result], now }).card;
}

export const isDue = (card: SrsCard | undefined, now = new Date()): boolean => !!card && card.dueAt.getTime() <= now.getTime();
