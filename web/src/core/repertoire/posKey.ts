import type { Position } from 'chessops/chess';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import type { PosKey } from './types';

/** Placement, side to move, castling, and the en-passant square only when a capture is legal. */
export function posKey(pos: Position): PosKey {
  return makeFen(pos.toSetup(), { epd: true });
}

/** Position key for a FEN, or null if the FEN is not a legal standard position. */
export function posKeyFromFen(fen: string): PosKey | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? null : posKey(pos.value);
}
