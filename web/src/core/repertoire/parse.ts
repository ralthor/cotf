import { castlingSide, type Position } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseComment, parsePgn, parseVariant, startingPosition, type Node, type PgnNodeData } from 'chessops/pgn';
import { makeSan, parseSan } from 'chessops/san';
import { kingCastlesTo, makeSquare, makeUci } from 'chessops/util';
import { posKey } from './posKey';
import type { Eval, RepNode, Shape, Side } from './types';

export const REPERTOIRE_PGN_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxGames: 300,
  /** Nodes in one chapter (all variations together). */
  maxNodes: 20_000,
};

/** A chapter as parsed, before it is given an id and a repertoire. */
export type ParsedChapter = {
  /** 1-based index of the game in the PGN text. */
  index: number;
  headers: Record<string, string>;
  /** From ChapterName / Event / Opening / players; null when the PGN has none. */
  title: string | null;
  /** From the [Orientation] header (Lichess studies), if present. */
  orientation: Side | null;
  startFen: string;
  root: RepNode;
  nodeCount: number;
};

/** Problems that did not stop the import. `code` is an i18n key suffix (`repertoire.warn.<code>`). */
export type ParseWarning = { game: number; code: 'illegal' | 'empty' | 'variant' | 'setup' | 'tooLarge' | 'tooMany'; vars?: Record<string, string | number> };

export type ParseResult = { chapters: ParsedChapter[]; warnings: ParseWarning[] };

const isUnknown = (v: string | undefined) => !v || v === '?' || v === '-';

function chapterTitle(h: Record<string, string>): string | null {
  if (!isUnknown(h.ChapterName)) return h.ChapterName!;
  if (!isUnknown(h.Event)) return h.Event!;
  if (!isUnknown(h.Opening)) return h.Opening!;
  if (!isUnknown(h.White) && !isUnknown(h.Black)) return `${h.White} – ${h.Black}`;
  return null;
}

/** Standard UCI for a chessops move (chessops writes castling as king-takes-rook, e1h1). */
export function standardUci(pos: Position, move: Parameters<typeof castlingSide>[1]): string {
  const side = castlingSide(pos, move);
  if (side && 'from' in move) return makeSquare(move.from) + makeSquare(kingCastlesTo(pos.turn, side));
  return makeUci(move);
}

type ParsedComments = { text: string[]; shapes: Shape[]; eval?: Eval };

function parseComments(comments: readonly string[] | undefined): ParsedComments {
  const out: ParsedComments = { text: [], shapes: [] };
  for (const raw of comments ?? []) {
    const c = parseComment(raw);
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (text) out.text.push(text);
    for (const s of c.shapes) out.shapes.push({ color: s.color, from: makeSquare(s.from), to: makeSquare(s.to) });
    if (c.evaluation) {
      out.eval =
        'mate' in c.evaluation
          ? { mate: c.evaluation.mate, ...(c.evaluation.depth !== undefined && { depth: c.evaluation.depth }) }
          : { pawns: c.evaluation.pawns, ...(c.evaluation.depth !== undefined && { depth: c.evaluation.depth }) };
    }
  }
  return out;
}

function applyComments(node: RepNode, c: ParsedComments) {
  if (c.text.length) node.comments = [...(node.comments ?? []), ...c.text];
  if (c.shapes.length) node.shapes = [...(node.shapes ?? []), ...c.shapes];
  if (c.eval) node.eval = c.eval;
}

const moveLabel = (pos: Position, san: string) => `${pos.fullmoves}${pos.turn === 'white' ? '.' : '...'} ${san}`;

/**
 * Parses PGN text (one or more games) into repertoire chapters, keeping every variation,
 * comment, NAG, arrow, highlighted square and evaluation. Clocks are dropped. An illegal move
 * cuts off that branch (with a warning); the rest of the game is kept.
 */
export function parseRepertoirePgn(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const chapters: ParsedChapter[] = [];
  const games = parsePgn(text);
  games.forEach((game, i) => {
    const index = i + 1;
    if (chapters.length >= REPERTOIRE_PGN_LIMITS.maxGames) {
      if (chapters.length === REPERTOIRE_PGN_LIMITS.maxGames && !warnings.some((w) => w.code === 'tooMany'))
        warnings.push({ game: index, code: 'tooMany', vars: { max: REPERTOIRE_PGN_LIMITS.maxGames } });
      return;
    }
    const headers = Object.fromEntries(game.headers);
    const variant = headers.Variant ?? '';
    if (parseVariant(variant) !== 'chess' || /960|fischer|wild\/[12]/i.test(variant)) {
      warnings.push({ game: index, code: 'variant', vars: { variant } });
      return;
    }
    const start = startingPosition(game.headers);
    if (start.isErr) {
      warnings.push({ game: index, code: 'setup' });
      return;
    }
    const startPos = start.value;
    const root: RepNode = { fen: makeFen(startPos.toSetup()), posKey: posKey(startPos), children: [] };
    applyComments(root, parseComments(game.comments));

    let nodeCount = 0;
    let tooLarge = false;
    const build = (pos: Position, from: Node<PgnNodeData>, into: RepNode) => {
      for (const child of from.children) {
        if (nodeCount >= REPERTOIRE_PGN_LIMITS.maxNodes) {
          tooLarge = true;
          return;
        }
        const d = child.data;
        const move = parseSan(pos, d.san);
        if (!move) {
          warnings.push({ game: index, code: 'illegal', vars: { move: moveLabel(pos, d.san) } });
          continue;
        }
        const next = pos.clone();
        const uci = standardUci(pos, move);
        const san = makeSan(pos, move); // canonical SAN, with check signs
        next.play(move);
        nodeCount++;
        const node: RepNode = { san, uci, fen: makeFen(next.toSetup()), posKey: posKey(next), children: [] };
        if (d.nags?.length) node.nags = [...d.nags];
        const before = parseComments(d.startingComments);
        if (before.text.length) node.commentsBefore = before.text;
        // Shapes written before a move belong to the position before it, i.e. the parent.
        if (before.shapes.length) into.shapes = [...(into.shapes ?? []), ...before.shapes];
        applyComments(node, parseComments(d.comments));
        into.children.push(node);
        build(next, child, node);
      }
    };
    build(startPos, game.moves, root);
    if (tooLarge) warnings.push({ game: index, code: 'tooLarge', vars: { max: REPERTOIRE_PGN_LIMITS.maxNodes } });

    if (root.children.length === 0 && !root.comments?.length) {
      warnings.push({ game: index, code: 'empty' });
      return;
    }
    const o = headers.Orientation?.toLowerCase();
    chapters.push({
      index,
      headers,
      title: chapterTitle(headers),
      orientation: o === 'white' ? 'w' : o === 'black' ? 'b' : null,
      startFen: root.fen,
      root,
      nodeCount,
    });
  });
  return { chapters, warnings };
}

/** Follows a child-index path from the root; undefined if the path does not exist. */
export function nodeAt(root: RepNode, path: readonly number[]): RepNode | undefined {
  let n: RepNode | undefined = root;
  for (const i of path) n = n?.children[i];
  return n;
}

/** Nodes along a path, root first. */
export function nodesOnPath(root: RepNode, path: readonly number[]): RepNode[] {
  const out = [root];
  let n = root;
  for (const i of path) {
    const c = n.children[i];
    if (!c) break;
    out.push(c);
    n = c;
  }
  return out;
}

/** Comment text for display: unknown [%…] commands (e.g. Lichess' [%anno …]) are hidden; they stay in exported PGN. */
export function displayComment(text: string): string {
  return text.replace(/\[%[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Display texts of a comment list, without the ones that become empty. */
export function displayComments(texts: readonly string[] | undefined): string[] {
  return (texts ?? []).map(displayComment).filter(Boolean);
}
