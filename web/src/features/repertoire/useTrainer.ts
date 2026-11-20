import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isDue, review, type AnswerResult } from '../../core/repertoire/srs';
import {
  ahead,
  answerResult,
  buildTrainGraph,
  myMoves,
  moveNode,
  narrowChapters,
  positionChapters,
  pickReply,
  pickShown,
  pickStart,
  reschedules,
  type Needs,
  type TrainGraph,
} from '../../core/repertoire/trainer';
import type { Chapter, PosKey, RepMove, RepNode, Side, TrainCard, TrainLogEntry, TrainMode } from '../../core/repertoire/types';
import { trainStore } from '../../storage/db';

/** New moves shown in one Learn line before it is replayed from memory. */
export const LEARN_BATCH = 6;
/** Positions in one Review session. */
export const REVIEW_BATCH = 20;
/** Pause before the opponent's move (ms). */
const OPPONENT_DELAY = 550;

/** A move's place in a chapter, for its comments and arrows. */
export type Note = { node: RepNode; parent: RepNode; mine: boolean };

export type Ask = {
  pos: PosKey;
  /** Accepted repertoire moves here. */
  moves: RepMove[];
  /** The move wanted: shown while learning, or the line's move when replaying it. */
  expected: RepMove | null;
  /**
   * When only some of your moves lead to positions that need training: those moves. Another
   * repertoire move is not wrong, but the line goes on with one of these.
   */
  wanted: RepMove[] | null;
  /** The move is shown before it is asked (Learn, new position): not graded. */
  intro: boolean;
  /** The card needs training in this mode, so a right answer reschedules it too. */
  needed: boolean;
  hint: number;
  shown: boolean;
  /** Wrong moves tried (SAN). */
  wrong: string[];
  startedAt: number;
  /** Feedback on the last try: not in the repertoire, or another repertoire move than the one wanted. */
  notice: { kind: 'wrong' | 'other'; san: string } | null;
};

export type Phase = 'ask' | 'opponent' | 'feedback' | 'lineEnd' | 'done';

export type Session = {
  mode: TrainMode;
  phase: Phase;
  fen: string;
  pos: PosKey;
  lastUci: string | null;
  ask: Ask | null;
  /** The last moves' comments, oldest first (at most two: the opponent's reply and your move). */
  notes: Note[];
  /** The opponent's move about to be played. */
  pending: RepMove | null;
  /**
   * Chapters the current line or position can belong to, most likely first; one once the line has
   * left the moves chapters share. Only moves already on the board narrow it.
   */
  chapters: string[];
  /** Learn: showing new moves, then replaying the line. Memorise: walking. */
  stage: 'intro' | 'replay' | 'walk';
  lineStart: PosKey;
  /** Moves played in this line (both sides). */
  line: RepMove[];
  replayIndex: number;
  introduced: PosKey[];
  /** Review: the positions to ask, and which one is current. */
  queue: PosKey[];
  queueIndex: number;
  /** Results of graded answers this session, and of the current line. */
  results: AnswerResult[];
  lineResults: AnswerResult[];
};

type Ctx = { g: TrainGraph; cards: ReadonlyMap<PosKey, TrainCard> };

const learnNeeds = (ctx: Ctx, s: Pick<Session, 'introduced'>): Needs => (k) => !ctx.cards.has(k) && !s.introduced.includes(k);
const dueNeeds = (ctx: Ctx): Needs => {
  const now = new Date();
  return (k) => isDue(ctx.cards.get(k)?.srs, now);
};

function noteFor(g: TrainGraph, m: RepMove, prefer: readonly string[]): Note | null {
  const at = moveNode(g, m, prefer);
  return at ? { node: at.node, parent: at.parent, mine: m.mine } : null;
}

function newAsk(pos: PosKey, moves: RepMove[], expected: RepMove | null, intro: boolean, needed: boolean, wanted: RepMove[] | null = null): Ask {
  return { pos, moves, expected, wanted, intro, needed, hint: 0, shown: false, wrong: [], startedAt: Date.now(), notice: null };
}

/** The moves an answer must be one of: the expected move, the wanted moves, or any repertoire move. */
export const accepted = (ask: Ask): RepMove[] => (ask.expected ? [ask.expected] : (ask.wanted ?? ask.moves));

function fenOf(g: TrainGraph, pos: PosKey): string {
  return g.fens.get(pos) ?? `${pos} 0 1`;
}

function startLine(s: Session, ctx: Ctx, start: PosKey): Session {
  return {
    ...s,
    pos: start,
    fen: fenOf(ctx.g, start),
    lastUci: null,
    notes: [],
    line: [],
    lineStart: start,
    replayIndex: 0,
    introduced: [],
    lineResults: [],
    chapters: ctx.g.chapters.filter((c) => c.root.posKey === start).map((c) => c.id),
    stage: s.mode === 'learn' ? 'intro' : 'walk',
  };
}

/** From the current position: ask, let the opponent move, or end the line. */
function advance(s: Session, ctx: Ctx): Session {
  const { g } = ctx;
  const end = (): Session => ({ ...s, phase: 'lineEnd', ask: null, pending: null });

  if (s.stage === 'replay') {
    const m = s.line[s.replayIndex];
    if (!m) return end();
    if (!m.mine) return { ...s, phase: 'opponent', ask: null, pending: m };
    return { ...s, phase: 'ask', pending: null, ask: newAsk(s.pos, myMoves(g, s.pos), m, false, s.introduced.includes(s.pos)) };
  }

  const needs = s.stage === 'intro' ? learnNeeds(ctx, s) : dueNeeds(ctx);
  // Learn: replay the line from its start once the new moves are shown.
  const finishIntro = (): Session => {
    if (s.stage !== 'intro' || s.introduced.length === 0) return end();
    const replay = { ...s, stage: 'replay' as const, pos: s.lineStart, fen: fenOf(g, s.lineStart), lastUci: null, notes: [], replayIndex: 0 };
    return advance(replay, ctx);
  };

  const mine = myMoves(g, s.pos);
  if (mine.length) {
    if (ahead(g, s.pos, needs) === 0) return finishIntro();
    if (s.stage === 'intro' && needs(s.pos)) {
      if (s.introduced.length >= LEARN_BATCH) return finishIntro();
      return { ...s, phase: 'ask', pending: null, ask: newAsk(s.pos, mine, pickShown(g, s.pos, needs), true, false) };
    }
    const leading = mine.filter((m) => ahead(g, m.to, needs) > 0);
    const wanted = leading.length > 0 && leading.length < mine.length ? leading : null;
    return { ...s, phase: 'ask', pending: null, ask: newAsk(s.pos, mine, null, false, s.stage === 'walk' && needs(s.pos), wanted) };
  }
  const reply = pickReply(g, s.pos, needs);
  if (!reply) return finishIntro();
  return { ...s, phase: 'opponent', ask: null, pending: reply };
}

/** Plays `m` on the board. */
function play(s: Session, ctx: Ctx, m: RepMove): Session {
  const chapters = narrowChapters(ctx.g, s.chapters, m);
  const note = noteFor(ctx.g, m, chapters);
  const notes = note ? [...s.notes, note].slice(-2) : s.notes.slice(-1);
  const next: Session = { ...s, pos: m.to, fen: note?.node.fen ?? fenOf(ctx.g, m.to), lastUci: m.uci, notes, chapters, pending: null };
  if (s.stage === 'replay') return { ...next, replayIndex: s.replayIndex + 1 };
  if (s.mode === 'review') return next;
  return { ...next, line: [...s.line, m] };
}

export type TrainerCounts = { cards: number; fresh: number; due: number; weak: number; nextDue: Date | null };

export type Mistake = { posKey: PosKey; times: number; lastAt: string; wrong: string[]; expected: string[] };

/**
 * Training state for one repertoire and side: FSRS cards and the answer log from IndexedDB, and
 * the running session (Learn, Memorise or Review).
 */
export function useTrainer(repertoireId: string | null, chapters: readonly Chapter[], side: Side) {
  const g = useMemo(() => buildTrainGraph(chapters, side), [chapters, side]);
  const [data, setData] = useState<{ key: string; cards: Map<PosKey, TrainCard>; log: TrainLogEntry[] } | null>(null);
  const key = `${repertoireId}|${side}`;
  const loaded = data?.key === key ? data : null;
  const cards = useMemo(() => loaded?.cards ?? new Map<PosKey, TrainCard>(), [loaded]);
  const log = useMemo(() => loaded?.log ?? [], [loaded]);
  const [session, setSession] = useState<Session | null>(null);
  const ctxRef = useRef<Ctx>({ g, cards });
  useEffect(() => {
    ctxRef.current = { g, cards };
  }, [g, cards]);

  useEffect(() => {
    if (!repertoireId) return;
    let live = true;
    void Promise.all([trainStore.cards(repertoireId, side), trainStore.log(repertoireId)]).then(([c, l]) => {
      if (!live) return;
      setData({ key: `${repertoireId}|${side}`, cards: new Map(c.map((x) => [x.posKey, x])), log: l.filter((e) => e.side === side) });
    });
    return () => {
      live = false;
    };
  }, [repertoireId, side]);

  // A different repertoire, side or set of chapters ends the session.
  const [sessionGraph, setSessionGraph] = useState(g);
  if (sessionGraph !== g) {
    setSessionGraph(g);
    setSession(null);
  }

  // The opponent moves after a short pause.
  useEffect(() => {
    if (session?.phase !== 'opponent' || !session.pending) return;
    const id = window.setTimeout(() => {
      setSession((s) => (s && s.phase === 'opponent' && s.pending ? advance(play(s, ctxRef.current, s.pending), ctxRef.current) : s));
    }, OPPONENT_DELAY);
    return () => window.clearTimeout(id);
  }, [session]);

  const counts = useMemo((): TrainerCounts => {
    const now = new Date();
    let fresh = 0;
    let due = 0;
    let weak = 0;
    let nextDue: Date | null = null;
    for (const k of g.cards) {
      const c = cards.get(k)?.srs;
      if (!c) fresh++;
      else {
        if (isDue(c, now)) due++;
        else if (!nextDue || c.dueAt < nextDue) nextDue = c.dueAt;
        if (c.lapses > 0) weak++;
      }
    }
    return { cards: g.cards.length, fresh, due, weak, nextDue };
  }, [g, cards]);

  /** Positions answered wrong (or shown), most recent first. */
  const mistakes = useMemo((): Mistake[] => {
    const inScope = new Set(g.cards);
    const by = new Map<PosKey, Mistake>();
    for (const e of log) {
      if ((e.result !== 'wrong' && e.result !== 'shown') || !inScope.has(e.posKey)) continue;
      const m = by.get(e.posKey) ?? { posKey: e.posKey, times: 0, lastAt: e.at, wrong: [], expected: e.expected };
      m.times++;
      if (e.at >= m.lastAt) [m.lastAt, m.expected] = [e.at, e.expected];
      for (const w of e.wrong) if (!m.wrong.includes(w)) m.wrong.push(w);
      by.set(e.posKey, m);
    }
    return [...by.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [g, log]);

  const start = useCallback(
    (mode: TrainMode, only?: PosKey) => {
      const ctx = ctxRef.current;
      const base: Session = {
        mode,
        phase: 'done',
        fen: '',
        pos: '',
        lastUci: null,
        ask: null,
        notes: [],
        pending: null,
        stage: 'walk',
        lineStart: '',
        line: [],
        replayIndex: 0,
        introduced: [],
        chapters: [],
        queue: [],
        queueIndex: 0,
        results: [],
        lineResults: [],
      };
      if (mode === 'review') {
        const queue = only
          ? [only]
          : [...new Set([...mistakes.map((m) => m.posKey), ...ctx.g.cards.filter((k) => (ctx.cards.get(k)?.srs.lapses ?? 0) > 0)])].slice(0, REVIEW_BATCH);
        const pos = queue[0];
        if (!pos) return setSession(base);
        setSession({ ...base, queue, pos, fen: fenOf(ctx.g, pos), chapters: positionChapters(ctx.g, pos), phase: 'ask', ask: newAsk(pos, myMoves(ctx.g, pos), null, false, true) });
        return;
      }
      const needs = mode === 'learn' ? learnNeeds(ctx, base) : dueNeeds(ctx);
      const first = pickStart(ctx.g, needs, mode === 'learn');
      setSession(first ? advance(startLine(base, ctx, first), ctx) : base);
    },
    [mistakes],
  );

  /** Next line (Learn, Memorise) or position (Review); the session ends when nothing is left. */
  const next = useCallback(() => {
    setSession((s) => {
      if (!s) return s;
      const ctx = ctxRef.current;
      if (s.mode === 'review') {
        const i = s.queueIndex + 1;
        const pos = s.queue[i];
        if (!pos) return { ...s, phase: 'done', ask: null };
        return { ...s, queueIndex: i, pos, fen: fenOf(ctx.g, pos), chapters: positionChapters(ctx.g, pos), lastUci: null, notes: [], phase: 'ask', ask: newAsk(pos, myMoves(ctx.g, pos), null, false, true) };
      }
      const needs = s.mode === 'learn' ? learnNeeds(ctx, { introduced: [] }) : dueNeeds(ctx);
      const first = pickStart(ctx.g, needs, s.mode === 'learn');
      return first ? advance(startLine(s, ctx, first), ctx) : { ...s, phase: 'done', ask: null };
    });
  }, []);

  const stop = useCallback(() => setSession(null), []);

  const hint = useCallback(() => setSession((s) => (s?.ask && !s.ask.intro ? { ...s, ask: { ...s.ask, hint: Math.min(3, s.ask.hint + 1) } } : s)), []);
  const show = useCallback(() => setSession((s) => (s?.ask && !s.ask.intro ? { ...s, ask: { ...s.ask, shown: true } } : s)), []);

  /** Saves a graded answer: the log entry always, the card when it is rescheduled. */
  const record = useCallback(
    async (mode: TrainMode, ask: Ask, result: AnswerResult) => {
      if (!repertoireId) return;
      const prev = ctxRef.current.cards.get(ask.pos);
      let card: TrainCard | null = null;
      if (reschedules(ask.needed || !prev, result)) {
        card = { repertoireId, side, posKey: ask.pos, srs: await review(prev?.srs, result) };
      }
      const entry: TrainLogEntry = {
        repertoireId,
        side,
        posKey: ask.pos,
        at: new Date().toISOString(),
        mode,
        result,
        wrong: ask.wrong,
        expected: ask.moves.map((m) => m.san),
        ms: Date.now() - ask.startedAt,
      };
      await trainStore.answer(card, entry);
      setData((d) => {
        if (!d || d.key !== `${repertoireId}|${side}`) return d;
        const nextCards = card ? new Map(d.cards).set(card.posKey, card) : d.cards;
        return { ...d, cards: nextCards, log: [...d.log, entry] };
      });
    },
    [repertoireId, side],
  );

  /**
   * A move tried on the board (UCI, SAN). Returns whether it stays on the board: a repertoire move
   * is played, anything else goes back.
   */
  const answer = useCallback(
    (uci: string, san: string): boolean => {
      const s = session;
      const ask = s?.ask;
      if (!s || s.phase !== 'ask' || !ask) return false;
      const ctx = ctxRef.current;
      const move = ask.moves.find((m) => m.uci === uci);
      if (!move) {
        setSession({ ...s, ask: { ...ask, wrong: ask.wrong.includes(san) ? ask.wrong : [...ask.wrong, san], notice: { kind: 'wrong', san } } });
        return false;
      }
      if (!accepted(ask).some((m) => m.uci === move.uci)) {
        setSession({ ...s, ask: { ...ask, notice: { kind: 'other', san } } });
        return false;
      }
      let nextS = play(s, ctx, move);
      if (!ask.intro) {
        const result = answerResult({ wrong: ask.wrong.length, hint: ask.hint, shown: ask.shown });
        void record(s.mode, ask, result);
        nextS = { ...nextS, results: [...s.results, result], lineResults: [...s.lineResults, result] };
      } else {
        nextS = { ...nextS, introduced: [...s.introduced, ask.pos] };
      }
      if (s.mode === 'review') nextS = { ...nextS, phase: 'feedback', ask: null };
      else nextS = advance({ ...nextS, ask: null }, ctx);
      setSession(nextS);
      return true;
    },
    [session, record],
  );

  return { graph: g, loaded: !!loaded || !repertoireId, cards, log, counts, mistakes, session, start, next, stop, hint, show, answer };
}
