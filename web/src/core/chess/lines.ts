import { Chess } from 'chess.js';

/** Converts a UCI line into SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, uci: string[], max = 10): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of uci.slice(0, max)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

/** FEN after playing a UCI line from `fen` (stops at the first illegal move). */
export function fenAfterLine(fen: string, uci: string[]): string {
  const c = new Chess(fen);
  for (const u of uci) {
    try {
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      break;
    }
  }
  return c.fen();
}

/** SAN moves with move numbers, e.g. "12. Nf3 Nc6 13. Bb5" or "12... Nc6 13. Bb5". */
export function numberedLine(fen: string, san: string[]): string {
  const parts = fen.split(' ');
  let white = parts[1] !== 'b';
  let num = Number(parts[5] ?? '1');
  return san
    .map((m, i) => {
      const prefix = white ? `${num}. ` : i === 0 ? `${num}... ` : '';
      if (!white) num++;
      white = !white;
      return prefix + m;
    })
    .join(' ');
}

/** Square centre position on a board, in percent, for overlays. */
export function squarePosition(square: string, orientation: 'white' | 'black'): { left: number; top: number } {
  const file = square.charCodeAt(0) - 97; // a..h → 0..7
  const rank = Number(square[1]); // 1..8
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 8 - rank : rank - 1;
  return { left: col * 12.5, top: row * 12.5 };
}
