import { buildMoves } from './graph';
import { nodeAt, nodesOnPath } from './parse';
import type { AnswerResult } from './srs';
import type { Chapter, PosKey, RepMove, RepNode, Side } from './types';

/**
 * Training over a repertoire's position graph. A card is a position where it is the trainee's
 * move and the repertoire has a move for them; a line walks the graph from a chapter's start.
 */
export type TrainGraph = {
  side: Side;
  chapters: readonly Chapter[];
  /** Start positions of the chapters in scope, in chapter order, without repeats. */
  starts: PosKey[];
  /** Moves out of each position, main moves first. */
  from: ReadonlyMap<PosKey, readonly RepMove[]>;
  /** Positions where it is your move: the cards. */
  cards: readonly PosKey[];
  /** A full FEN for each position (with move numbers, from the first chapter that reaches it). */
  fens: ReadonlyMap<PosKey, string>;
};

/** Which cards still need training in the current mode. */
export type Needs = (posKey: PosKey) => boolean;

export function buildTrainGraph(chapters: readonly Chapter[], side: Side): TrainGraph {
  const inScope = chapters.filter((c) => c.side === side);
  const from = new Map<PosKey, RepMove[]>();
  for (const m of buildMoves('', inScope)) {
    const list = from.get(m.from);
    if (list) list.push(m);
    else from.set(m.from, [m]);
  }
  for (const list of from.values()) list.sort((a, b) => Number(b.main) - Number(a.main));
  const fens = new Map<PosKey, string>();
  const walk = (n: RepNode) => {
    if (!fens.has(n.posKey)) fens.set(n.posKey, n.fen);
    n.children.forEach(walk);
  };
  inScope.forEach((c) => walk(c.root));
  const cards = [...from.entries()].filter(([, ms]) => ms.some((m) => m.mine)).map(([k]) => k);
  const starts = [...new Set(inScope.map((c) => c.root.posKey))];
  return { side, chapters: inScope, starts, from, cards, fens };
}

export const myMoves = (g: TrainGraph, pos: PosKey): RepMove[] => (g.from.get(pos) ?? []).filter((m) => m.mine);
export const theirMoves = (g: TrainGraph, pos: PosKey): RepMove[] => (g.from.get(pos) ?? []).filter((m) => !m.mine);
export const isCard = (g: TrainGraph, pos: PosKey): boolean => myMoves(g, pos).length > 0;

/** How many cards that need training can be reached from `pos` (itself included). */
export function ahead(g: TrainGraph, pos: PosKey, needs: Needs): number {
  const seen = new Set<PosKey>();
  const stack = [pos];
  let n = 0;
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const out = g.from.get(p);
    if (!out) continue;
    if (out.some((m) => m.mine) && needs(p)) n++;
    for (const m of out) stack.push(m.to);
  }
  return n;
}

/** Picks an item with probability proportional to its weight; null when all weights are 0. */
function weighted<T>(items: readonly T[], weight: (t: T) => number, rand: () => number): T | null {
  const ws = items.map(weight);
  const total = ws.reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!;
    if (r < 0 && ws[i]! > 0) return items[i]!;
  }
  return items[ws.findLastIndex((w) => w > 0)]!;
}

/** The opponent's reply: weighted by what still needs training behind each one. */
export function pickReply(g: TrainGraph, pos: PosKey, needs: Needs, rand: () => number = Math.random): RepMove | null {
  return weighted(theirMoves(g, pos), (m) => ahead(g, m.to, needs), rand);
}

/** The move to show while learning: the one with the most to learn behind it, main moves on ties. */
export function pickShown(g: TrainGraph, pos: PosKey, needs: Needs): RepMove | null {
  let best: RepMove | null = null;
  let bestN = -1;
  for (const m of myMoves(g, pos)) {
    const n = ahead(g, m.to, needs);
    if (n > bestN) [best, bestN] = [m, n];
  }
  return best;
}

/** Where the next line starts: in chapter order (`ordered`) or weighted by what needs training. */
export function pickStart(g: TrainGraph, needs: Needs, ordered: boolean, rand: () => number = Math.random): PosKey | null {
  if (ordered) return g.starts.find((s) => ahead(g, s, needs) > 0) ?? null;
  return weighted(g.starts, (s) => ahead(g, s, needs), rand);
}

/** How an answer went: shown beats wrong, wrong beats a hint. */
export function answerResult(a: { wrong: number; hint: number; shown: boolean }): AnswerResult {
  if (a.shown) return 'shown';
  if (a.wrong > 0) return 'wrong';
  if (a.hint > 0) return 'hinted';
  return 'good';
}

/** Whether an answer reschedules its card: always when it needed training, otherwise only a failure. */
export const reschedules = (needed: boolean, result: AnswerResult): boolean => needed || result === 'wrong' || result === 'shown';

/** Hint squares for `moves` at a hint level: 1 the pieces, 2 also their targets, 3 arrows. */
export function hintFor(moves: readonly RepMove[], level: number): { squares: string[]; arrows: [string, string][] } {
  if (level <= 0) return { squares: [], arrows: [] };
  const from = moves.map((m) => m.uci.slice(0, 2));
  const to = moves.map((m) => m.uci.slice(2, 4));
  if (level === 1) return { squares: [...new Set(from)], arrows: [] };
  if (level === 2) return { squares: [...new Set([...from, ...to])], arrows: [] };
  return { squares: [], arrows: moves.map((m) => [m.uci.slice(0, 2), m.uci.slice(2, 4)] as [string, string]) };
}

/** Where a move appears in the chapters in scope: its node and the node before it. */
export function moveNode(
  g: TrainGraph,
  m: RepMove,
  prefer: readonly string[] = [],
): { chapter: Chapter; node: RepNode; parent: RepNode; path: number[] } | null {
  const refs = [...m.refs].sort((a, b) => Number(prefer.includes(b.chapterId)) - Number(prefer.includes(a.chapterId)));
  for (const ref of refs) {
    const chapter = g.chapters.find((c) => c.id === ref.chapterId);
    if (!chapter) continue;
    const node = nodeAt(chapter.root, ref.path);
    const parent = nodeAt(chapter.root, ref.path.slice(0, -1));
    if (node && parent) return { chapter, node, parent, path: ref.path };
  }
  return null;
}

/** Chapters in scope (in chapter order) where `m` appears. */
export function chaptersOf(g: TrainGraph, m: RepMove): string[] {
  const ids = new Set(m.refs.map((r) => r.chapterId));
  return g.chapters.filter((c) => ids.has(c.id)).map((c) => c.id);
}

/**
 * The chapters a line can still belong to after `m`: those of `current` that contain `m`, or, when
 * none does (a transposition into another chapter), every chapter that contains `m`.
 */
export function narrowChapters(g: TrainGraph, current: readonly string[], m: RepMove): string[] {
  const ids = chaptersOf(g, m);
  const kept = current.filter((id) => ids.includes(id));
  return kept.length ? kept : ids;
}

/** Chapters in which a move leads to `pos` (the chapters starting there when it is a start). */
export function positionChapters(g: TrainGraph, pos: PosKey): string[] {
  const ids = new Set(g.chapters.filter((c) => c.root.posKey === pos).map((c) => c.id));
  for (const list of g.from.values()) for (const m of list) if (m.to === pos) chaptersOf(g, m).forEach((id) => ids.add(id));
  return g.chapters.filter((c) => ids.has(c.id)).map((c) => c.id);
}

/** A chapter's name for the trainer: its title, and the opening header when it says more. */
export function lineName(ch: Chapter): { title: string; opening: string | null } {
  const opening = ch.headers.Opening?.trim();
  return { title: ch.title, opening: opening && opening !== '?' && opening !== ch.title ? opening : null };
}

/** "1. e4 c5 2. Nf3" for the moves along `path` in a chapter. */
export function lineLabel(root: RepNode, path: readonly number[]): string {
  const nodes = nodesOnPath(root, path);
  const out: string[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const [, turn, , , , num] = nodes[i - 1]!.fen.split(' ');
    if (turn === 'w') out.push(`${num ?? '1'}. ${nodes[i]!.san}`);
    else out.push(i === 1 ? `${num ?? '1'}… ${nodes[i]!.san}` : `${nodes[i]!.san}`);
  }
  return out.join(' ');
}

/** The moves leading to a card position, as a label (from the first move that leads there). */
export function positionLabel(g: TrainGraph, pos: PosKey): string {
  for (const list of g.from.values()) {
    for (const m of list) {
      if (m.to !== pos) continue;
      const at = moveNode(g, m);
      if (at) return lineLabel(at.chapter.root, at.path);
    }
  }
  return '';
}
