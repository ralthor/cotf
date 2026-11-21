import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { ChildNode, makePgn, Node, type PgnNodeData } from 'chessops/pgn';
import { makeSan, parseSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { normalizeMove } from 'chessops/chess';
import { dbMoves, isMainMove, orderLine, type ImprovementRule } from '../../core/repertoire/insights';
import { posKey } from '../../core/repertoire/posKey';
import type { Side } from '../../core/repertoire/types';
import type { ExplorerResult } from './explorer';

/**
 * "My fixes": each finding (a better move than yours at a position from your games) becomes a
 * training chapter that starts at that position, not at move 1, with the opponent's likely replies
 * from the opening database a few moves deep, so you learn a short line rather than one move.
 */

export type Fix = {
  colour: Side;
  /** Full FEN of the position, your move. */
  fen: string;
  /** How your games reached it (SAN from the start). */
  reachedBy: string[];
  /** What you played there. */
  played: string;
  /** The better move, standard UCI. */
  better: string;
  /** Why it is better, in a sentence; shown after you answer. */
  why: string;
  /** Where you played it, shown before you answer (it does not give the answer away). */
  context: string;
  /** The engine's line from the position (standard UCI, starting with the better move), used when the database has no replies. */
  line?: string[];
};

export type Lookup = (fen: string) => Promise<ExplorerResult | null>;

/** Opponent replies kept at each level of the line, and the smallest share of games for one. */
export const REPLY_WIDTH = [3, 2] as const;
export const MIN_REPLY_SHARE = 0.1;

type Line = { san: string; children: Line[] };

const posFrom = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

function play(fen: string, uci: string): { fen: string; san: string } | null {
  const pos = posFrom(fen);
  const m = parseUci(uci);
  if (!m) return null;
  const move = normalizeMove(pos, m);
  if (!pos.isLegal(move)) return null;
  const san = makeSan(pos, move);
  pos.play(move);
  return { fen: makeFen(pos.toSetup()), san };
}

/** Your reply in a position: the database's best-scoring main move, else its most played move. */
function yourReply(db: ExplorerResult, colour: Side, rule: ImprovementRule): string | null {
  const moves = dbMoves(db, colour);
  const total = db.white + db.draws + db.black;
  const main = moves.filter((m) => isMainMove(m, total, rule));
  if (main.length) return main.reduce((a, b) => (b.score > a.score ? b : a)).uci;
  return moves[0]?.uci ?? null;
}

/**
 * The opponent's likely replies after `fen` (their move), each with your answer, `REPLY_WIDTH.length`
 * levels deep. `onStep` is called after each lookup (for progress).
 */
export async function growReplies(fen: string, colour: Side, lookup: Lookup, rule: ImprovementRule, level = 0, onStep?: () => void): Promise<Line[]> {
  if (level >= REPLY_WIDTH.length) return [];
  const db = await lookup(fen);
  onStep?.();
  if (!db) return [];
  const them: Side = colour === 'w' ? 'b' : 'w';
  const total = db.white + db.draws + db.black;
  const replies = dbMoves(db, them)
    .filter((m) => m.games >= MIN_REPLY_SHARE * total)
    .sort((a, b) => b.games - a.games)
    .slice(0, REPLY_WIDTH[level]);
  const out: Line[] = [];
  for (const r of replies) {
    const after = play(fen, r.uci);
    if (!after) continue;
    const line: Line = { san: after.san, children: [] };
    const db2 = await lookup(after.fen);
    onStep?.();
    const mine = db2 && yourReply(db2, colour, rule);
    const answered = mine ? play(after.fen, mine) : null;
    if (answered) {
      const next: Line = { san: answered.san, children: await growReplies(answered.fen, colour, lookup, rule, level + 1, onStep) };
      line.children.push(next);
    }
    out.push(line);
  }
  return out;
}

/** The engine's line after the better move as one reply line, ending on your move (at most 4 plies). */
export function linePly(fen: string, line: readonly string[]): Line[] {
  const sans = sanLine(fen, line.slice(0, 5)).slice(1);
  const usable = sans.length - (sans.length % 2);
  let out: Line[] = [];
  for (let i = usable - 1; i >= 0; i--) out = [{ san: sans[i]!, children: out }];
  return out;
}

/** The most lookups `growReplies` can make, for a progress bar. */
export const MAX_FIX_LOOKUPS = 1 + REPLY_WIDTH[0] * (1 + 1 + REPLY_WIDTH[1]);

const toNode = (l: Line, comment?: string): ChildNode<PgnNodeData> => {
  const n = new ChildNode<PgnNodeData>({ san: l.san, comments: comment ? [comment] : undefined });
  n.children = l.children.map((c) => toNode(c));
  return n;
};

/** A one-chapter PGN for a fix: starts at its position, the better move, then the replies. */
export function fixPgn(fix: Fix, replies: Line[], title: string): string {
  const first = play(fix.fen, fix.better);
  if (!first) throw new Error('illegal fix move');
  const moves = new Node<PgnNodeData>();
  moves.children = [toNode({ san: first.san, children: replies }, fix.why)];
  const headers = new Map<string, string>([
    ['Event', 'My fixes'],
    ['ChapterName', title],
    ['FEN', fix.fen],
    ['SetUp', '1'],
    ['Orientation', fix.colour === 'w' ? 'white' : 'black'],
    ['Result', '*'],
  ]);
  return makePgn({ headers, comments: [fix.context], moves });
}

/** "1. e4 e5 2. Nf3": how a position was reached, for the chapter's context. */
export const reachedText = (sans: readonly string[]) => orderLine([...sans]);

/** SAN for a line of standard UCI moves from `fen`, stopping at an illegal one. */
export function sanLine(fen: string, ucis: readonly string[]): string[] {
  const out: string[] = [];
  let cur = fen;
  for (const u of ucis) {
    const r = play(cur, u);
    if (!r) break;
    out.push(r.san);
    cur = r.fen;
  }
  return out;
}

/** The FEN after a SAN move, or null. */
export function afterSan(fen: string, san: string): string | null {
  const pos = posFrom(fen);
  const m = parseSan(pos, san);
  if (!m) return null;
  pos.play(m);
  return makeFen(pos.toSetup());
}

/** The FEN after a standard UCI move, or null. */
export const afterUci = (fen: string, uci: string) => play(fen, uci)?.fen ?? null;
/** The SAN of a standard UCI move, or null. */
export const sanOf = (fen: string, uci: string) => play(fen, uci)?.san ?? null;

/** The position key of a FEN ('' when unreadable). */
export function keyOfFen(fen: string): string {
  const setup = parseFen(fen);
  if (setup.isErr) return '';
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? '' : posKey(pos.value);
}
