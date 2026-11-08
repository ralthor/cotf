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
  inspectedPlies: number;
  note: string;
};

/**
 * Looks for a genuine, voluntary material sacrifice along the line that starts with the
 * played move. Material is sampled only when it is the mover's turn again (after the
 * opponent's reply) so that ordinary exchanges and forced recaptures cancel out.
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
  for (const uci of lineUci.slice(0, maxPlies)) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    inspected++;
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
  const isSacrifice = bestRun >= minCheckpoints && maxDeficit >= minDeficit;
  const note = isSacrifice
    ? `Mover stays ${maxDeficit} pawn(s) of material down for ${bestRun} replies along the engine line.`
    : inspected === 0
      ? 'No line available to inspect.'
      : 'No sustained material deficit; captures and exchanges balance out.';
  return { isSacrifice, maxDeficit, persistedCheckpoints: bestRun, finalDelta, inspectedPlies: inspected, note };
}
