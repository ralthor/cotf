import { moveNode, myMoves, positionLabel, type TrainGraph } from './trainer';
import type { PosKey, RepMove } from './types';

/** NAGs that mark the opponent's move as an error: ? (2), ?? (4), ?! (6). */
const ERRORS = new Set([2, 4, 6]);

/** A trap: the opponent's mistake in the study and your repertoire's answer to it. */
export type Trap = {
  /** Position after the opponent's mistake (your move): the card to practise. */
  posKey: PosKey;
  mistake: RepMove;
  /** Your repertoire's moves there. */
  replies: RepMove[];
  /** Moves leading to the position. */
  line: string;
  /** How bad the mistake was marked: the worst NAG. */
  nag: number;
};

/** Opponent moves the study marks with ?, ?? or ?!, followed by an answer in your repertoire. */
export function findTraps(g: TrainGraph): Trap[] {
  const out = new Map<PosKey, Trap>();
  for (const list of g.from.values()) {
    for (const m of list) {
      if (m.mine) continue;
      const nags = m.refs.flatMap((r) => {
        const at = moveNode(g, { ...m, refs: [r] });
        return at?.node.nags ?? [];
      });
      const errors = nags.filter((n) => ERRORS.has(n));
      if (!errors.length) continue;
      const replies = myMoves(g, m.to);
      if (!replies.length || out.has(m.to)) continue;
      // ?? (4) is worse than ? (2), which is worse than ?! (6).
      const nag = errors.includes(4) ? 4 : errors.includes(2) ? 2 : 6;
      out.set(m.to, { posKey: m.to, mistake: m, replies, line: positionLabel(g, m.to), nag });
    }
  }
  const rank = (n: number) => (n === 4 ? 0 : n === 2 ? 1 : 2);
  return [...out.values()].sort((a, b) => rank(a.nag) - rank(b.nag) || a.line.length - b.line.length);
}
