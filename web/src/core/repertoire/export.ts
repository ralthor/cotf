import { ChildNode, makeComment, makePgn, Node, type Game, type PgnNodeData } from 'chessops/pgn';
import { parseSquare } from 'chessops/util';
import type { Comment, CommentShape } from 'chessops/pgn';
import type { Chapter, Eval, RepNode, Shape } from './types';

function toCommentShapes(shapes: readonly Shape[] | undefined): CommentShape[] {
  const out: CommentShape[] = [];
  for (const s of shapes ?? []) {
    const from = parseSquare(s.from);
    const to = parseSquare(s.to);
    if (from !== undefined && to !== undefined) out.push({ color: s.color, from, to });
  }
  return out;
}

function toEvaluation(e: Eval | undefined): Comment['evaluation'] {
  if (!e) return undefined;
  return 'mate' in e ? { mate: e.mate, depth: e.depth } : { pawns: e.pawns, depth: e.depth };
}

/** Comment strings for a node: its texts, then one with the arrows, circles and eval. */
function comments(node: RepNode): string[] | undefined {
  const out = [...(node.comments ?? [])];
  const shapes = toCommentShapes(node.shapes);
  const evaluation = toEvaluation(node.eval);
  if (shapes.length || evaluation) out.push(makeComment({ text: '', shapes, evaluation }).trim());
  return out.length ? out : undefined;
}

function addChildren(from: RepNode, into: Node<PgnNodeData>) {
  for (const child of from.children) {
    const node = new ChildNode<PgnNodeData>({
      san: child.san!,
      ...(child.nags?.length && { nags: [...child.nags] }),
      ...(child.commentsBefore?.length && { startingComments: [...child.commentsBefore] }),
      ...(comments(child) && { comments: comments(child) }),
    });
    into.children.push(node);
    addChildren(child, node);
  }
}

/** The chapter as PGN, with variations, comments, NAGs, [%cal]/[%csl] and [%eval]. */
export function chapterToPgn(chapter: Chapter): string {
  const headers = new Map(Object.entries(chapter.headers));
  if (!headers.has('Event')) headers.set('Event', chapter.title);
  headers.set('Orientation', chapter.side === 'w' ? 'white' : 'black');
  if (!headers.has('Result')) headers.set('Result', '*');
  const game: Game<PgnNodeData> = { headers, comments: comments(chapter.root), moves: new Node<PgnNodeData>() };
  addChildren(chapter.root, game.moves);
  return makePgn(game);
}

/** All chapters of a repertoire, in order, as one multi-game PGN. */
export function repertoireToPgn(chapters: readonly Chapter[]): string {
  return [...chapters]
    .sort((a, b) => a.order - b.order)
    .map(chapterToPgn)
    .join('\n');
}
