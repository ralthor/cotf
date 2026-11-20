import { ChildNode, makePgn, Node, type PgnNodeData } from 'chessops/pgn';
import { userScore, type OpeningGame } from './games';
import type { Side } from './types';

export type DiscoverOptions = {
  side: Side;
  /** Depth in plies (default 16: eight moves each). */
  maxPlies?: number;
  /** A move needs at least this many games to be kept (default 2). */
  minGames?: number;
  /** Opponent replies kept per position, most frequent first (default 4). */
  maxReplies?: number;
  /** Comment for one of your moves: games it was played in, average score (0–1, null when unknown). */
  comment: (games: number, score: number | null) => string;
  title: string;
};

type Trie = { san: string; games: number; points: number; scored: number; children: Map<string, Trie> };

const newTrie = (san: string): Trie => ({ san, games: 0, points: 0, scored: 0, children: new Map() });

export type Discovered = { pgn: string; positions: number; games: number };

/**
 * A starter repertoire from the user's games for one side: at your moves the move you play most,
 * at the opponent's moves every reply seen in at least `minGames` games. Null when there is nothing.
 */
export function discoverRepertoire(games: readonly OpeningGame[], opts: DiscoverOptions): Discovered | null {
  const { side, maxPlies = 16, minGames = 2, maxReplies = 4 } = opts;
  const mine = games.filter((g) => g.userColour === side);
  const root = newTrie('');
  for (const g of mine) {
    const s = userScore(g);
    let t = root;
    for (const m of g.moves.slice(0, maxPlies)) {
      let c = t.children.get(m.san);
      if (!c) t.children.set(m.san, (c = newTrie(m.san)));
      c.games++;
      if (s !== null) [c.points, c.scored] = [c.points + s, c.scored + 1];
      t = c;
    }
  }

  let positions = 0;
  const build = (t: Trie, into: Node<PgnNodeData>, ply: number) => {
    const yours = (ply % 2 === 0) === (side === 'w');
    const kids = [...t.children.values()].filter((c) => c.games >= minGames);
    const avg = (c: Trie) => (c.scored ? c.points / c.scored : 0);
    const chosen = yours
      ? kids.sort((a, b) => b.games - a.games || avg(b) - avg(a)).slice(0, 1)
      : kids.sort((a, b) => b.games - a.games).slice(0, maxReplies);
    for (const c of chosen) {
      const data: PgnNodeData = { san: c.san };
      if (yours) {
        positions++;
        data.comments = [opts.comment(c.games, c.scored ? c.points / c.scored : null)];
      }
      const child = new ChildNode(data);
      into.children.push(child);
      build(c, child, ply + 1);
    }
  };
  const moves = new Node<PgnNodeData>();
  build(root, moves, 0);
  if (positions === 0) return null;
  const headers = new Map([
    ['Event', opts.title],
    ['Orientation', side === 'w' ? 'white' : 'black'],
    ['Result', '*'],
  ]);
  return { pgn: makePgn({ headers, moves }), positions, games: mine.length };
}
