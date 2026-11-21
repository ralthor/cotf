import { Chess, type Square } from 'chess.js';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard';

/** The board's drag starts only after this many pixels, so a slightly shaky click stays a click. */
export const DRAG_ACTIVATION_PX = 6;

const SELECTED: CSSProperties = { background: 'rgba(47,111,143,0.5)' };
const TARGET: CSSProperties = { background: 'radial-gradient(circle, rgba(20,85,30,0.45) 22%, transparent 24%)' };
const CAPTURE: CSSProperties = { background: 'radial-gradient(circle, transparent 58%, rgba(20,85,30,0.45) 60%)' };

type Options = {
  fen: string;
  /** Whether the user may move now. */
  enabled: boolean;
  /** The colour whose pieces can be picked ('w' or 'b'). */
  side: 'w' | 'b';
  /** Plays from → to; returns whether the move was accepted. */
  move: (from: string, to: string) => boolean;
};

/**
 * Click-to-move and drag-and-drop for react-chessboard, sharing one behaviour on every board:
 * click a piece, then click where it goes; or drag it. A drag that ends where it started counts as a
 * click, so a shaky click still picks the piece.
 */
export function useClickToMove({ fen, enabled, side, move }: Options) {
  const [picked, setPicked] = useState<{ fen: string; square: string } | null>(null);
  const selected = enabled && picked?.fen === fen ? picked.square : null;
  // The square of a drag that ended where it started, so the click the browser may send after it is not counted twice.
  const lastDropClick = useRef<{ square: string; at: number } | null>(null);

  const targets = useMemo(() => {
    if (!selected) return [];
    try {
      return new Chess(fen).moves({ square: selected as Square, verbose: true }).map((m) => ({ to: m.to as string, capture: !!m.captured }));
    } catch {
      return [];
    }
  }, [fen, selected]);

  const own = (pieceType: string | undefined) => !!pieceType && pieceType[0] === side;

  const click = (square: string, pieceType: string | undefined) => {
    if (!enabled) return;
    if (selected && square !== selected && targets.some((t) => t.to === square)) {
      setPicked(null);
      move(selected, square);
      return;
    }
    if (own(pieceType)) return setPicked(square === selected ? null : { fen, square });
    setPicked(null);
  };

  const onSquareClick = ({ square, piece }: SquareHandlerArgs) => {
    const last = lastDropClick.current;
    lastDropClick.current = null;
    if (last && last.square === square && performance.now() - last.at < 400) return;
    click(square, piece?.pieceType);
  };

  const onPieceDrop = ({ sourceSquare, targetSquare, piece }: PieceDropHandlerArgs): boolean => {
    if (!enabled) return false;
    if (!targetSquare || targetSquare === sourceSquare) {
      if (targetSquare) {
        lastDropClick.current = { square: sourceSquare, at: performance.now() };
        click(sourceSquare, piece.pieceType);
      }
      return false;
    }
    setPicked(null);
    return move(sourceSquare, targetSquare);
  };

  /** Styles for the picked square and where it can go; merge them over the board's own square styles. */
  const squareStyles = useMemo(() => {
    const out: Record<string, CSSProperties> = {};
    if (!selected) return out;
    out[selected] = SELECTED;
    for (const t of targets) out[t.to] = t.capture ? CAPTURE : TARGET;
    return out;
  }, [selected, targets]);

  return {
    selected,
    onSquareClick,
    onPieceDrop,
    squareStyles,
    clear: () => setPicked(null),
    canDragPiece: ({ piece }: { piece: { pieceType: string } }) => enabled && own(piece.pieceType),
  };
}

/** Merges the click-to-move styles over a board's own styles (backgrounds win, other properties stay). */
export function mergeSquareStyles(base: Record<string, CSSProperties>, top: Record<string, CSSProperties>): Record<string, CSSProperties> {
  const out = { ...base };
  for (const [sq, st] of Object.entries(top)) out[sq] = { ...out[sq], ...st };
  return out;
}
