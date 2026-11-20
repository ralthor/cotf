import type { Chapter, RepMove, RepNode } from './types';

const sideToMove = (posKey: string) => (posKey.split(' ')[1] === 'b' ? 'b' : 'w');

export const repMoveKey = (m: Pick<RepMove, 'side' | 'from' | 'uci'>) => `${m.side}|${m.from}|${m.uci}`;

/**
 * Derives the repertoire graph from its chapters: one move per (side, position, uci), merged
 * across chapters and transpositions, with every place it appears.
 */
export function buildMoves(repertoireId: string, chapters: readonly Chapter[]): RepMove[] {
  const moves = new Map<string, RepMove>();
  for (const ch of chapters) {
    const walk = (node: RepNode, path: number[]) => {
      node.children.forEach((child, i) => {
        if (!child.uci || !child.san) return;
        const childPath = [...path, i];
        const key = repMoveKey({ side: ch.side, from: node.posKey, uci: child.uci });
        let m = moves.get(key);
        if (!m) {
          m = {
            repertoireId,
            side: ch.side,
            from: node.posKey,
            uci: child.uci,
            san: child.san,
            to: child.posKey,
            mine: sideToMove(node.posKey) === ch.side,
            main: false,
            refs: [],
          };
          moves.set(key, m);
        }
        if (i === 0) m.main = true;
        m.refs.push({ chapterId: ch.id, path: childPath });
        walk(child, childPath);
      });
    };
    walk(ch.root, []);
  }
  return [...moves.values()];
}
