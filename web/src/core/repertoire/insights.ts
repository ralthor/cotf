import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { standardUci } from './parse';
import { posKey } from './posKey';
import { userScore, type OpeningGame } from './games';
import type { PosKey, Side } from './types';

/*
 * What your games say about your openings, with everything needed to show where each number comes
 * from: the games, the move orders that reach a position, and what was played next.
 *
 * Positions are kept per colour you played, so the same position as White and as Black are separate.
 */

/** Imaginary games at the expected score added to each position, so a few games cannot dominate. */
export const SHRINK_GAMES = 5;
/** Plies looked at by default (move 15). */
export const DEFAULT_MAX_PLY = 30;

export type Outcome = { games: number; wins: number; draws: number; losses: number; points: number };

const emptyOutcome = (): Outcome => ({ games: 0, wins: 0, draws: 0, losses: 0, points: 0 });

function addOutcome(o: Outcome, score: number) {
  o.games++;
  o.points += score;
  if (score === 1) o.wins++;
  else if (score === 0) o.losses++;
  else o.draws++;
}

export const scoreOf = (o: Outcome) => (o.games ? o.points / o.games : 0);
export const lossShare = (o: Outcome) => (o.games ? o.losses / o.games : 0);

/** One move order (the moves from the start) that reached a position, with its games. */
export type MoveOrder = { sans: string[]; gameIds: string[]; outcome: Outcome };

/** A move played from a position in your games. */
export type NextMove = { san: string; uci: string; childId: string; gameIds: string[]; outcome: Outcome };

export type PositionNode = {
  /** `colour|posKey`. */
  id: string;
  /** The colour you played. */
  colour: Side;
  posKey: PosKey;
  fen: string;
  /** Plies from the start, the fewest any game took. */
  ply: number;
  /** Whose move it is here: yours, or your opponent's. */
  toMove: 'you' | 'opponent';
  gameIds: string[];
  outcome: Outcome;
  orders: MoveOrder[];
  next: NextMove[];
  /** Positions one move earlier (ids), most games first. */
  parents: string[];
  /**
   * Your average score one move earlier, over the games that reached this position (each game counts
   * the position it came from). Equal to the position's own score at the start.
   */
  before: number;
};

export type GamesTree = {
  nodes: ReadonlyMap<string, PositionNode>;
  games: ReadonlyMap<string, OpeningGame>;
  /** Finished games counted, per colour you played. */
  totals: Record<Side, number>;
  maxPly: number;
};

export const nodeId = (colour: Side, key: PosKey) => `${colour}|${key}`;

type Walk = { keys: PosKey[]; fens: string[]; ucis: string[]; /** Plies asked for when walked. */ upTo: number };
const walks = new WeakMap<OpeningGame, Walk>();

/**
 * Positions along a game's first `plies` plies (cached per game object): keys[i] and fens[i] are
 * after i plies. The FEN is the key plus the move counters, so it costs nothing extra.
 */
export function walkGame(game: OpeningGame, plies = game.moves.length): Walk {
  const hit = walks.get(game);
  if (hit && (hit.upTo >= plies || hit.ucis.length < hit.upTo)) return hit;
  const pos = Chess.default();
  const fenOf = (key: string) => `${key} ${pos.halfmoves} ${pos.fullmoves}`;
  const k0 = posKey(pos);
  const w: Walk = { keys: [k0], fens: [fenOf(k0)], ucis: [], upTo: plies };
  for (const m of game.moves.slice(0, plies)) {
    const move = parseSan(pos, m.san);
    if (!move) break;
    w.ucis.push(standardUci(pos, move));
    pos.play(move);
    const k = posKey(pos);
    w.keys.push(k);
    w.fens.push(fenOf(k));
  }
  walks.set(game, w);
  return w;
}

type Building = PositionNode & { orderMap: Map<string, MoveOrder>; nextMap: Map<string, NextMove>; parentGames: Map<string, number> };

/** Builds the positions reached in the first `maxPly` plies of finished games. */
export function buildGamesTree(games: readonly OpeningGame[], maxPly = DEFAULT_MAX_PLY): GamesTree {
  const nodes = new Map<string, Building>();
  const byId = new Map<string, OpeningGame>();
  const totals: Record<Side, number> = { w: 0, b: 0 };
  for (const game of games) {
    const score = userScore(game);
    if (score === null) continue;
    byId.set(game.id, game);
    totals[game.userColour]++;
    const w = walkGame(game, maxPly);
    const colour = game.userColour;
    const seen = new Set<string>();
    let parent: Building | null = null;
    const last = Math.min(maxPly, w.keys.length - 1);
    for (let i = 0; i <= last; i++) {
      const id = nodeId(colour, w.keys[i]!);
      // A position repeated within a game counts once, at its first visit.
      if (seen.has(id)) break;
      seen.add(id);
      let n = nodes.get(id);
      if (!n) {
        const turn = w.fens[i]!.split(' ')[1] === 'w' ? 'w' : 'b';
        n = {
          id,
          colour,
          posKey: w.keys[i]!,
          fen: w.fens[i]!,
          ply: i,
          toMove: turn === colour ? 'you' : 'opponent',
          gameIds: [],
          outcome: emptyOutcome(),
          orders: [],
          next: [],
          parents: [],
          before: 0,
          orderMap: new Map(),
          nextMap: new Map(),
          parentGames: new Map(),
        };
        nodes.set(id, n);
      }
      n.ply = Math.min(n.ply, i);
      n.gameIds.push(game.id);
      addOutcome(n.outcome, score);
      const sans = game.moves.slice(0, i).map((m) => m.san);
      const orderKey = sans.join(' ');
      const o = n.orderMap.get(orderKey) ?? { sans, gameIds: [], outcome: emptyOutcome() };
      o.gameIds.push(game.id);
      addOutcome(o.outcome, score);
      n.orderMap.set(orderKey, o);
      if (parent) {
        n.parentGames.set(parent.id, (n.parentGames.get(parent.id) ?? 0) + 1);
        const uci = w.ucis[i - 1]!;
        const nx = parent.nextMap.get(uci) ?? { san: game.moves[i - 1]!.san, uci, childId: id, gameIds: [], outcome: emptyOutcome() };
        nx.gameIds.push(game.id);
        addOutcome(nx.outcome, score);
        parent.nextMap.set(uci, nx);
      }
      parent = n;
    }
  }
  const byGames = <T extends { outcome: Outcome }>(a: T, b: T) => b.outcome.games - a.outcome.games;
  for (const n of nodes.values()) {
    n.orders = [...n.orderMap.values()].sort(byGames);
    n.next = [...n.nextMap.values()].sort(byGames);
  }
  for (const n of nodes.values()) {
    let sum = 0;
    let count = 0;
    for (const [pid, k] of n.parentGames) {
      sum += scoreOf(nodes.get(pid)!.outcome) * k;
      count += k;
    }
    n.before = count ? sum / count : scoreOf(n.outcome);
    n.parents = [...n.parentGames].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }
  const out = new Map<string, PositionNode>();
  for (const [id, n] of nodes) {
    const { orderMap: _o, nextMap: _n, parentGames: _p, ...node } = n;
    void _o;
    void _n;
    void _p;
    out.set(id, node);
  }
  return { nodes: out, games: byId, totals, maxPly };
}

/** The score shrunk towards `prior` by SHRINK_GAMES imaginary games. */
export const shrunkScore = (o: Outcome, prior: number, k = SHRINK_GAMES) => (o.points + k * prior) / (o.games + k);

/** "4. Nf3" or "3… Bf5": the move played on 1-based ply `ply`. */
export function moveLabel(ply: number, san: string): string {
  const n = Math.floor((ply - 1) / 2) + 1;
  return ply % 2 === 1 ? `${n}. ${san}` : `${n}… ${san}`;
}

/** "1. e4 c6 2. d4" for a list of moves from the start. */
export function orderLine(sans: readonly string[]): string {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ');
}

/** The move that led to a position in its most common move order. */
export const lastMove = (n: PositionNode) => {
  const sans = n.orders[0]?.sans ?? [];
  return sans.length ? moveLabel(sans.length, sans[sans.length - 1]!) : '';
};

export type WeakSpot = {
  node: PositionNode;
  /** Share of your finished games (with this colour) that reached it. */
  reached: number;
  /** Share of those games you lost. */
  lost: number;
  score: number;
  before: number;
  /** The score shrunk towards `before`. */
  shrunk: number;
  /** games × (before − shrunk). */
  pointsLost: number;
  /** Who played the move into this position. */
  movedBy: 'you' | 'opponent';
};

export type WeakSpotOptions = { minGames?: number; colour?: Side };

/**
 * Positions where your score drops compared with one move earlier, by points lost:
 * games × (score one move earlier − score here, shrunk). Only drops are listed.
 */
export function weakSpots(tree: GamesTree, { minGames = 3, colour }: WeakSpotOptions = {}): WeakSpot[] {
  const out: WeakSpot[] = [];
  for (const n of tree.nodes.values()) {
    if (n.ply === 0 || n.outcome.games < minGames) continue;
    if (colour && n.colour !== colour) continue;
    const shrunk = shrunkScore(n.outcome, n.before);
    const pointsLost = n.outcome.games * (n.before - shrunk);
    if (pointsLost <= 0.05) continue;
    out.push({
      node: n,
      reached: n.outcome.games / Math.max(1, tree.totals[n.colour]),
      lost: lossShare(n.outcome),
      score: scoreOf(n.outcome),
      before: n.before,
      shrunk,
      pointsLost,
      movedBy: n.toMove === 'you' ? 'opponent' : 'you',
    });
  }
  return out.sort((a, b) => b.pointsLost - a.pointsLost || a.node.ply - b.node.ply);
}

/** Positions where it is your move, most played first: the ones worth looking up. */
export function decisionPoints(tree: GamesTree, { minGames = 3, colour }: WeakSpotOptions = {}): PositionNode[] {
  return [...tree.nodes.values()]
    .filter((n) => n.toMove === 'you' && n.next.length > 0 && n.outcome.games >= minGames && (!colour || n.colour === colour))
    .sort((a, b) => b.outcome.games - a.outcome.games || a.ply - b.ply);
}

/** A move in an opening database, scored for the side to move. */
export type DbMove = { uci: string; san: string; games: number; white: number; draws: number; black: number; score: number };

export type DbPosition = { white: number; draws: number; black: number; moves: readonly Omit<DbMove, 'games' | 'score'>[] };

/** The database's moves with their games and score for `mover`, most played first. */
export function dbMoves(db: DbPosition, mover: Side): DbMove[] {
  return db.moves
    .map((m) => {
      const games = m.white + m.draws + m.black;
      const wins = mover === 'w' ? m.white : m.black;
      return { ...m, games, score: games ? (wins + m.draws / 2) / games : 0 };
    })
    .sort((a, b) => b.games - a.games);
}

export const dbScore = (db: DbPosition, mover: Side) => {
  const games = db.white + db.draws + db.black;
  return games ? ((mover === 'w' ? db.white : db.black) + db.draws / 2) / games : 0;
};

export type ImprovementRule = {
  /** Fewest database games for a move to be compared. */
  minDbGames: number;
  /** Smallest share of the position's database games for a move to be suggested (a main move, not a lucky rare one). */
  minShare: number;
  /** Smallest gain per game (score, 0–1) worth suggesting. */
  minGain: number;
};

export const DEFAULT_RULE: ImprovementRule = { minDbGames: 200, minShare: 0.05, minGain: 0.03 };

/** Whether a database move is played enough to be suggested. */
export const isMainMove = (m: DbMove, total: number, rule: ImprovementRule) => m.games >= rule.minDbGames && m.games >= rule.minShare * total;

export type Improvement = {
  node: PositionNode;
  yours: NextMove;
  /** Your move in the database, when it has enough games there. */
  yoursDb?: DbMove;
  better: DbMove;
  /**
   * `database`: both moves compared in the database; `yours`: your move is rare there, so the
   * better move's database score is compared with your own results (shrunk towards the position).
   */
  basis: 'database' | 'yours';
  /** Score per game the better move gains. */
  gain: number;
  /** Your games with this move × gain. */
  pointsToGain: number;
  /** Share of your games (with this colour) that reached the position. */
  reached: number;
  /** Share of your games with this move that you lost. */
  lost: number;
};

/**
 * Better moves than yours at one position, from a database lookup. The database's best-scoring main
 * move (enough games, and a big enough share of the position's games) is compared with each move you
 * played; it is suggested when it gains at least `minGain` per game.
 */
export function improvementsAt(tree: GamesTree, node: PositionNode, db: DbPosition, rule: ImprovementRule = DEFAULT_RULE): Improvement[] {
  const all = dbMoves(db, node.colour);
  const total = db.white + db.draws + db.black;
  const main = all.filter((m) => isMainMove(m, total, rule));
  if (!main.length) return [];
  const best = main.reduce((a, b) => (b.score > a.score ? b : a));
  const prior = dbScore(db, node.colour);
  const out: Improvement[] = [];
  for (const yours of node.next) {
    if (yours.uci === best.uci) continue;
    const yoursDb = all.find((m) => m.uci === yours.uci && m.games >= rule.minDbGames);
    const basis = yoursDb ? 'database' : 'yours';
    const gain = best.score - (yoursDb ? yoursDb.score : shrunkScore(yours.outcome, prior));
    if (gain < rule.minGain) continue;
    out.push({
      node,
      yours,
      yoursDb,
      better: best,
      basis,
      gain,
      pointsToGain: yours.outcome.games * gain,
      reached: node.outcome.games / Math.max(1, tree.totals[node.colour]),
      lost: lossShare(yours.outcome),
    });
  }
  return out;
}
