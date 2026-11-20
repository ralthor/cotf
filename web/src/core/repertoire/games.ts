import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import type { GameRecord } from '../chess/types';
import { standardUci } from './parse';
import { posKey } from './posKey';
import { narrowChapters, type TrainGraph } from './trainer';
import type { PosKey, Side } from './types';

/** Moves kept per game: enough for any opening repertoire. */
export const GAME_PLIES = 80;
/** Plies in the repertoire before a game counts in its chapter's results. */
export const MIN_BOOK_FOR_RESULTS = 2;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** A game trimmed to what the repertoire comparison needs. */
export type OpeningGame = {
  id: string;
  source: 'chesscom' | 'lichess';
  url?: string;
  white: string;
  black: string;
  /** The colour the user played. */
  userColour: Side;
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  /** ISO time the game was played (ended). */
  playedAt: string;
  timeClass?: string;
  opening?: string;
  /** The first moves, SAN and standard UCI. */
  moves: { san: string; uci: string }[];
};

function playedAt(g: GameRecord): string {
  if (g.providerData?.endTime) return new Date(g.providerData.endTime * 1000).toISOString();
  const d = (g.headers.UTCDate ?? g.headers.Date ?? '').replace(/\./g, '-');
  const time = g.headers.UTCTime ?? '00:00:00';
  const iso = new Date(`${d}T${time}Z`);
  return Number.isNaN(iso.getTime()) ? g.importedAt : iso.toISOString();
}

/**
 * Trims an imported game for comparison, with the colour `username` played. Null when the user
 * did not play in it or it did not start from the standard position.
 */
export function toOpeningGame(g: GameRecord, username: string): OpeningGame | null {
  if (g.source !== 'chesscom' && g.source !== 'lichess') return null;
  if (g.initialFen.split(' ').slice(0, 4).join(' ') !== START_FEN.split(' ').slice(0, 4).join(' ')) return null;
  const u = username.trim().toLowerCase();
  const white = g.headers.White ?? '?';
  const black = g.headers.Black ?? '?';
  const userColour: Side | null = white.toLowerCase() === u ? 'w' : black.toLowerCase() === u ? 'b' : null;
  if (!userColour) return null;
  const r = g.headers.Result;
  return {
    id: g.id,
    source: g.source,
    url: g.sourceUrl,
    white,
    black,
    userColour,
    result: r === '1-0' || r === '0-1' || r === '1/2-1/2' ? r : '*',
    playedAt: playedAt(g),
    timeClass: g.providerData?.timeClass,
    opening: g.headers.Opening ?? g.headers.ECOUrl?.split('/').pop()?.replace(/-/g, ' '),
    moves: g.moves.slice(0, GAME_PLIES).map((m) => ({ san: m.san, uci: m.uci })),
  };
}

/** Points for the user: 1 win, 0.5 draw, 0 loss; null when unfinished. */
export function userScore(g: OpeningGame): number | null {
  if (g.result === '*') return null;
  if (g.result === '1/2-1/2') return 0.5;
  return (g.result === '1-0') === (g.userColour === 'w') ? 1 : 0;
}

export type GameCheck = {
  gameId: string;
  side: Side;
  /**
   * `none`: the repertoire has nothing for this side from the start; `followed`: the game stayed in
   * it until it ran out (or the game ended); `you` / `opponent`: who played the first move outside it.
   */
  kind: 'none' | 'followed' | 'you' | 'opponent';
  /** Moves (plies) played inside the repertoire. */
  inBook: number;
  /** Chapters the game was still in when it left or the repertoire ran out. */
  chapters: string[];
  /** The move that left the repertoire (kinds `you` and `opponent`). */
  ply?: number;
  posKey?: PosKey;
  fen?: string;
  played?: { san: string; uci: string };
  /** The repertoire's moves there (SAN). */
  expected?: string[];
  /** Positions from the start up to where the game left or the walk stopped. */
  keys: PosKey[];
};

/** Walks a game through the repertoire graph of the side the user played, up to where it leaves it. */
export function compareGame(graphs: Readonly<Record<Side, TrainGraph>>, game: OpeningGame): GameCheck {
  const side = game.userColour;
  const g = graphs[side];
  const pos = Chess.default();
  const base = { gameId: game.id, side };
  const keys = [posKey(pos)];
  let chapters = g.chapters.filter((c) => c.root.posKey === keys[0]).map((c) => c.id);
  if (!chapters.length) return { ...base, kind: 'none', inBook: 0, chapters: [], keys };
  for (let i = 0; i < game.moves.length; i++) {
    const key = keys[keys.length - 1]!;
    const out = g.from.get(key) ?? [];
    if (!out.length) return { ...base, kind: 'followed', inBook: i, chapters, keys };
    const san = game.moves[i]!.san;
    const move = parseSan(pos, san);
    if (!move) return { ...base, kind: 'followed', inBook: i, chapters, keys };
    const uci = standardUci(pos, move);
    const m = out.find((x) => x.uci === uci);
    if (!m) {
      const mover: Side = pos.turn === 'white' ? 'w' : 'b';
      return {
        ...base,
        kind: mover === side ? 'you' : 'opponent',
        inBook: i,
        chapters,
        ply: i,
        posKey: key,
        fen: makeFen(pos.toSetup()),
        played: { san, uci },
        expected: out.map((x) => x.san),
        keys,
      };
    }
    chapters = narrowChapters(g, chapters, m);
    pos.play(move);
    keys.push(posKey(pos));
  }
  return { ...base, kind: 'followed', inBook: game.moves.length, chapters, keys };
}

/** One (position, move) where games left the repertoire, with the games it happened in. */
export type Deviation = {
  key: string;
  side: Side;
  posKey: PosKey;
  fen: string;
  played: { san: string; uci: string };
  expected: string[];
  /** "1. e4 c5 2. Nf3" up to the move. */
  line: string;
  /** Positions from the start to the one where the move was played. */
  keys: PosKey[];
  games: OpeningGame[];
};

export type ChapterResult = { chapterId: string; games: number; wins: number; draws: number; losses: number; inBook: number };

export type GamesSummary = {
  checked: number;
  inRepertoire: number;
  followed: number;
  you: Deviation[];
  opponent: Deviation[];
  chapters: ChapterResult[];
  /** Average moves (plies) in book over games that started in the repertoire. */
  averageInBook: number;
};

/** "1. e4 c5 2. Nf3" for the first `plies` moves of a game from the standard start. */
export function sanLine(moves: readonly { san: string }[], plies: number): string {
  return moves
    .slice(0, plies)
    .map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m.san}` : m.san))
    .join(' ');
}

export function summariseGames(graphs: Readonly<Record<Side, TrainGraph>>, games: readonly OpeningGame[]): GamesSummary {
  const you = new Map<string, Deviation>();
  const opponent = new Map<string, Deviation>();
  const chapters = new Map<string, ChapterResult>();
  let inRepertoire = 0;
  let followed = 0;
  let bookTotal = 0;
  for (const game of games) {
    const c = compareGame(graphs, game);
    if (c.kind === 'none') continue;
    inRepertoire++;
    bookTotal += c.inBook;
    if (c.kind === 'followed') followed++;
    if ((c.kind === 'you' || c.kind === 'opponent') && c.posKey && c.played && c.fen) {
      const map = c.kind === 'you' ? you : opponent;
      const key = `${c.side}|${c.posKey}|${c.played.uci}`;
      const d = map.get(key) ?? {
        key,
        side: c.side,
        posKey: c.posKey,
        fen: c.fen,
        played: c.played,
        expected: c.expected ?? [],
        line: sanLine(game.moves, (c.ply ?? 0) + 1),
        keys: c.keys,
        games: [],
      };
      d.games.push(game);
      map.set(key, d);
    }
    // Results go to the chapter the game was in, once it is down to one, and only when both sides
    // played at least one repertoire move (a game that left on move 1 says nothing about it).
    if (c.chapters.length === 1 && c.inBook >= MIN_BOOK_FOR_RESULTS) {
      const id = c.chapters[0]!;
      const r = chapters.get(id) ?? { chapterId: id, games: 0, wins: 0, draws: 0, losses: 0, inBook: 0 };
      const s = userScore(game);
      r.games++;
      r.inBook += c.inBook;
      if (s === 1) r.wins++;
      else if (s === 0.5) r.draws++;
      else if (s === 0) r.losses++;
      chapters.set(id, r);
    }
  }
  const byCount = (a: Deviation, b: Deviation) => b.games.length - a.games.length || a.line.localeCompare(b.line);
  return {
    checked: games.length,
    inRepertoire,
    followed,
    you: [...you.values()].sort(byCount),
    opponent: [...opponent.values()].sort(byCount),
    chapters: [...chapters.values()].sort((a, b) => b.games - a.games),
    averageInBook: inRepertoire ? bookTotal / inRepertoire : 0,
  };
}

/** Position keys along a game's first `plies` moves (fewer if a move cannot be read). */
export function gameKeys(game: OpeningGame, plies = 24): PosKey[] {
  const pos = Chess.default();
  const keys = [posKey(pos)];
  for (const m of game.moves.slice(0, plies)) {
    const move = parseSan(pos, m.san);
    if (!move) break;
    pos.play(move);
    keys.push(posKey(pos));
  }
  return keys;
}

export type OpeningResult = { name: string; eco: string; side: Side; games: number; wins: number; draws: number; losses: number };

/**
 * Your games grouped by the opening they reached (named by `name` from their positions) and the
 * side you played, most played first.
 */
export function openingResults(
  games: readonly OpeningGame[],
  name: (keys: readonly PosKey[]) => { eco: string; name: string } | null,
): OpeningResult[] {
  const by = new Map<string, OpeningResult>();
  for (const g of games) {
    const o = name(gameKeys(g));
    if (!o) continue;
    const key = `${g.userColour}|${o.name}`;
    const r = by.get(key) ?? { name: o.name, eco: o.eco, side: g.userColour, games: 0, wins: 0, draws: 0, losses: 0 };
    const s = userScore(g);
    r.games++;
    if (s === 1) r.wins++;
    else if (s === 0.5) r.draws++;
    else if (s === 0) r.losses++;
    by.set(key, r);
  }
  return [...by.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}
