import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { displayComments } from './parse';
import type { RepNode } from './types';

/**
 * Questions about the reasoning behind a move, built from the study's own content: no AI and no
 * outside text. In order of preference:
 * - `author`: a question written in the comment as "Q: … A: …";
 * - `plan`: the move's arrows or circled squares ("which square is the plan aimed at?");
 * - `blank`: a move or square from the comment, blanked out, with three choices.
 */
export type Question =
  | { kind: 'author'; question: string; answer: string }
  | { kind: 'plan'; squares: string[]; arrows: [string, string][] }
  | { kind: 'blank'; text: string; answer: string; choices: string[] };

const AUTHOR = /Q:\s*([\s\S]+?)\s*A:\s*([\s\S]+)/;
// A SAN move (piece moves, pawn captures, castling), or a square, standing alone in the text.
const SAN = /(?<![\w-])(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|O-O-O|O-O)[+#]?(?![\w-])/g;
const SQUARE = /(?<![\w-])[a-h][1-8](?![\w-])/g;
const FILES = 'abcdefgh';

/** Small seeded generator, so a question looks the same each time it is shown for a position. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Legal moves in a position, as SAN. */
function legalSans(fen: string): string[] {
  const setup = parseFen(fen);
  if (setup.isErr) return [];
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return [];
  const out: string[] = [];
  for (const [from, tos] of pos.value.allDests()) for (const to of tos) out.push(makeSan(pos.value, { from, to }));
  return out;
}

/** Squares near `sq` (same file or rank, or a diagonal step), as distractors. */
function nearbySquares(sq: string): string[] {
  const f = FILES.indexOf(sq[0]!);
  const r = Number(sq[1]);
  const out: string[] = [];
  for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [0, 2]] as const) {
    const nf = f + df;
    const nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) out.push(`${FILES[nf]}${nr}`);
  }
  return out;
}

/**
 * A question about the move that led to `node` (played from `parentFen` as `playedUci`), or null
 * when its comment and shapes give nothing to ask.
 */
export function questionFor(node: RepNode, parentFen: string, playedUci: string): Question | null {
  const comments = displayComments([...(node.commentsBefore ?? []), ...(node.comments ?? [])]);
  const text = comments.join(' ');

  const authored = AUTHOR.exec(text);
  if (authored) return { kind: 'author', question: authored[1]!.trim(), answer: authored[2]!.trim() };

  const played: [string, string] = [playedUci.slice(0, 2), playedUci.slice(2, 4)];
  const shapes = (node.shapes ?? []).filter((s) => !(s.from === played[0] && s.to === played[1]));
  if (shapes.length) {
    const arrows = shapes.filter((s) => s.from !== s.to).map((s) => [s.from, s.to] as [string, string]);
    const squares = [...new Set(shapes.map((s) => s.to))];
    return { kind: 'plan', squares, arrows };
  }

  if (!text) return null;
  const rand = seeded(`${node.posKey}|${text}`);
  // Moves first (they say more than a square), longest comment first.
  const moves = [...text.matchAll(SAN)].map((m) => ({ token: m[0], at: m.index ?? 0, move: true }));
  const squares = [...text.matchAll(SQUARE)]
    .filter((m) => !moves.some((x) => (m.index ?? 0) >= x.at && (m.index ?? 0) < x.at + x.token.length))
    .map((m) => ({ token: m[0], at: m.index ?? 0, move: false }));
  const pick = moves[0] ?? squares[0];
  if (!pick) return null;
  const answer = pick.token.replace(/[+#]$/, '');
  let pool: string[];
  if (pick.move) {
    pool = [...new Set([...legalSans(node.fen), ...legalSans(parentFen)].map((s) => s.replace(/[+#]$/, '')))].filter((s) => s !== answer);
    // Prefer moves by the same kind of piece: closer distractors.
    const same = pool.filter((s) => s[0] === answer[0]);
    pool = same.length >= 2 ? same : pool;
  } else {
    pool = nearbySquares(answer).filter((s) => s !== answer);
  }
  if (pool.length < 2) return null;
  const distractors = shuffle(pool, rand).slice(0, 2);
  const blanked = `${text.slice(0, pick.at)}____${text.slice(pick.at + pick.token.length)}`;
  return { kind: 'blank', text: blanked, answer, choices: shuffle([answer, ...distractors], rand) };
}
