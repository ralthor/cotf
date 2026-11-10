import { Chess } from 'chess.js';
import type { Colour } from '../chess/types';

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material balance in pawns from `colour`'s perspective. */
export function materialBalance(fen: string, colour: Colour): number {
  const board = fen.split(' ')[0]!;
  let bal = 0;
  for (const ch of board) {
    const lower = ch.toLowerCase();
    const v = VALUES[lower];
    if (v === undefined) continue;
    const isWhite = ch !== lower;
    bal += (isWhite ? 1 : -1) * v;
  }
  return colour === 'w' ? bal : -bal;
}

export type SacrificeEvidence = {
  isSacrifice: boolean;
  /** Largest sustained material deficit (pawns) for the mover along the line, after replies. */
  maxDeficit: number;
  /** How many consecutive mover-to-move checkpoints the deficit persisted. */
  persistedCheckpoints: number;
  /** Material change at the end of the inspected line (positive = mover regained/gained). */
  finalDelta: number;
  /** The inspected line ends with the opponent checkmated. */
  endsInMate: boolean;
  /**
   * Material (pawns) the opponent can win right after the move by capturing, net of anything the
   * move itself captured (static exchange evaluation). Catches pieces left hanging and declined sacrifices.
   */
  offered: number;
  /** Size of the sacrifice in pawns: the larger of the line deficit and `offered` (0 when not a sacrifice). */
  size: number;
  inspectedPlies: number;
  note: string;
};

const ATTACKER_ORDER: Record<string, number> = { ...VALUES, k: 100 };

/**
 * Static exchange evaluation: material the side to move wins by starting a capture sequence on
 * `square`, each side always recapturing with its least valuable piece and free to stop.
 * Uses legal moves only, so pins and checks are respected.
 */
export function staticExchange(chess: Chess, square: string): number {
  const gains: number[] = [];
  let made = 0;
  for (;;) {
    const caps = chess
      .moves({ verbose: true })
      .filter((m) => m.to === square && m.captured && !m.flags.includes('e'))
      .sort((a, b) => ATTACKER_ORDER[a.piece]! - ATTACKER_ORDER[b.piece]!);
    const cap = caps[0];
    if (!cap) break;
    gains.push(VALUES[cap.captured!]!);
    chess.move(cap);
    made++;
  }
  for (let i = 0; i < made; i++) chess.undo();
  let res = 0;
  for (let i = gains.length - 1; i >= 0; i--) res = Math.max(0, gains[i]! - res);
  return res;
}

/** Most material the side to move can win by capturing one of the other side's (non-king) pieces. */
function maxCaptureGain(chess: Chess): number {
  const victim = chess.turn() === 'w' ? 'b' : 'w';
  let best = 0;
  for (const row of chess.board())
    for (const sq of row)
      if (sq && sq.color === victim && sq.type !== 'k') best = Math.max(best, staticExchange(chess, sq.square));
  return best;
}

/**
 * Looks for a genuine, voluntary material sacrifice by the played move (the first move of `lineUci`):
 *  - along the engine line: material is sampled only when it is the mover's turn again (after the
 *    opponent's reply), so ordinary exchanges and recaptures cancel out. The deficit must persist
 *    for `minCheckpoints` replies, or for one reply when the line ends in mate;
 *  - or offered: right after the move the opponent can win material by capturing (a piece left
 *    hanging, including during a quiet move), whether or not the engine line accepts it.
 * A capture, an equal trade or a one-ply imbalance is NOT a sacrifice.
 */
export function detectSacrifice(
  fenBefore: string,
  lineUci: string[],
  opts: { minDeficit?: number; minCheckpoints?: number; maxPlies?: number } = {},
): SacrificeEvidence {
  const minDeficit = opts.minDeficit ?? 2;
  const minCheckpoints = opts.minCheckpoints ?? 2;
  const maxPlies = opts.maxPlies ?? 10;
  const chess = new Chess(fenBefore);
  const mover = chess.turn();
  const start = materialBalance(fenBefore, mover);

  let maxDeficit = 0;
  let run = 0;
  let bestRun = 0;
  let inspected = 0;
  let offered = 0;
  for (const uci of lineUci.slice(0, maxPlies)) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    inspected++;
    if (inspected === 1) {
      const gainedByMove = materialBalance(chess.fen(), mover) - start;
      offered = Math.max(0, maxCaptureGain(chess) - gainedByMove);
    }
    if (chess.turn() !== mover) continue; // checkpoint only after the opponent's reply
    const deficit = start - materialBalance(chess.fen(), mover);
    if (deficit >= minDeficit) {
      run++;
      bestRun = Math.max(bestRun, run);
      maxDeficit = Math.max(maxDeficit, deficit);
    } else {
      run = 0;
    }
  }
  const finalDelta = materialBalance(chess.fen(), mover) - start;
  const endsInMate = inspected > 0 && chess.isCheckmate() && chess.turn() !== mover;
  const lineSacrifice = bestRun >= (endsInMate ? 1 : minCheckpoints) && maxDeficit >= minDeficit;
  const offeredSacrifice = offered >= minDeficit;
  const isSacrifice = lineSacrifice || offeredSacrifice;
  const size = Math.max(lineSacrifice ? maxDeficit : 0, offeredSacrifice ? offered : 0);
  const parts: string[] = [];
  if (lineSacrifice)
    parts.push(
      endsInMate && bestRun < minCheckpoints
        ? `Mover gives up ${maxDeficit} pawn(s) of material and mates.`
        : `Mover stays ${maxDeficit} pawn(s) of material down for ${bestRun} replies along the engine line.`,
    );
  if (offeredSacrifice) parts.push(`After the move the opponent can win ${offered} pawn(s) of material by capturing.`);
  const note = isSacrifice
    ? parts.join(' ')
    : inspected === 0
      ? 'No line available to inspect.'
      : 'No sustained material deficit; captures and exchanges balance out.';
  return {
    isSacrifice,
    maxDeficit,
    persistedCheckpoints: bestRun,
    finalDelta,
    endsInMate,
    offered,
    size,
    inspectedPlies: inspected,
    note,
  };
}
