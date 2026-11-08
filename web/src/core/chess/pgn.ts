import { Chess, DEFAULT_POSITION } from 'chess.js';
import { fnv1a64 } from './hash';
import type { GameRecord, GameSource, MoveRecord } from './types';

export const PGN_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxGames: 500,
  maxPlies: 1200,
};

export type PgnParseError = {
  index: number; // 0-based index of the game within the input
  message: string;
  headers?: Record<string, string>;
};

export type PgnParseResult = {
  games: GameRecord[];
  errors: PgnParseError[];
  truncated: boolean;
};

const HEADER_RE = /^\s*\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;
const CLOCK_RE = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/;
const SUPPORTED_VARIANTS = new Set(['', 'standard', 'from position', 'fromposition']);

/**
 * Splits a multi-game PGN into individual game texts. A new game begins when a
 * tag-pair line follows movetext.
 */
export function splitPgnGames(text: string): string[] {
  const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n');
  const games: string[] = [];
  let current: string[] = [];
  let seenMovetext = false;

  const flush = () => {
    const body = current.join('\n').trim();
    if (body) games.push(body);
    current = [];
    seenMovetext = false;
  };

  for (const line of lines) {
    const isHeader = HEADER_RE.test(line);
    if (isHeader && seenMovetext) flush();
    if (!isHeader && line.trim() !== '') seenMovetext = true;
    current.push(line);
  }
  flush();
  return games;
}

export function parseHeaders(gameText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of gameText.split('\n')) {
    const m = HEADER_RE.exec(line);
    if (m) headers[m[1]!] = m[2]!.replace(/\\(["\\])/g, '$1');
    else if (line.trim() !== '') break;
  }
  return headers;
}

export function parseClock(comment: string | undefined): number | undefined {
  if (!comment) return undefined;
  const m = CLOCK_RE.exec(comment);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function stripCommands(comment: string): string {
  return comment.replace(/\[%[^\]]*\]/g, '').trim();
}

export type ParseOptions = {
  source: GameSource;
  sourceUrl?: string;
  importedAt?: string;
  providerData?: GameRecord['providerData'];
};

/** Parses a single game's PGN text. Throws an Error with a user-facing message on failure. */
export function parseSingleGame(gameText: string, options: ParseOptions): GameRecord {
  const headers = parseHeaders(gameText);
  const variant = (headers.Variant ?? '').trim().toLowerCase();
  if (!SUPPORTED_VARIANTS.has(variant)) {
    throw new Error(`Unsupported variant "${headers.Variant}". Only standard chess is supported.`);
  }

  let initialFen = DEFAULT_POSITION;
  if (headers.FEN) {
    const probe = new Chess();
    try {
      probe.load(headers.FEN);
    } catch (e) {
      throw new Error(`Invalid FEN header: ${(e as Error).message}`, { cause: e });
    }
    initialFen = probe.fen();
  }

  const chess = new Chess();
  try {
    chess.loadPgn(gameText, { strict: false });
  } catch (e) {
    throw new Error(`Could not read moves: ${(e as Error).message}`, { cause: e });
  }

  const history = chess.history({ verbose: true });
  if (history.length > PGN_LIMITS.maxPlies) {
    throw new Error(`Game has ${history.length} plies; the limit is ${PGN_LIMITS.maxPlies}.`);
  }
  if (history.length > 0 && history[0]!.before !== initialFen) {
    // chess.js applied SetUp/FEN itself; trust the starting position it used.
    initialFen = history[0]!.before;
  }

  const comments = new Map<string, string>();
  for (const c of chess.getComments()) comments.set(c.fen, c.comment);

  const replay = new Chess(initialFen);
  const moves: MoveRecord[] = history.map((mv, i) => {
    const legalMoveCount = replay.moves().length;
    const fullMoveNumber = Number(mv.before.split(' ')[5] ?? '1');
    replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    const rawComment = comments.get(mv.after);
    const comment = rawComment ? stripCommands(rawComment) : undefined;
    return {
      ply: i + 1,
      fullMoveNumber,
      colour: mv.color,
      san: mv.san,
      uci: mv.lan,
      fenBefore: mv.before,
      fenAfter: mv.after,
      isCheck: replay.inCheck(),
      isCheckmate: replay.isCheckmate(),
      clockSeconds: parseClock(rawComment),
      comment: comment || undefined,
      legalMoveCount,
    };
  });

  const rawPgn = gameText.trim();
  const id = options.sourceUrl ? `url:${options.sourceUrl}` : `pgn:${fnv1a64(rawPgn)}`;
  return {
    id,
    source: options.source,
    sourceUrl: options.sourceUrl,
    headers,
    rawPgn,
    importedAt: options.importedAt ?? new Date().toISOString(),
    initialFen,
    moves,
    providerData: options.providerData,
  };
}

/** Parses one or more games. Invalid games are reported in `errors`; valid ones are still returned. */
export function parsePgn(text: string, options: ParseOptions): PgnParseResult {
  if (text.length > PGN_LIMITS.maxBytes) {
    return {
      games: [],
      errors: [{ index: 0, message: `Input is larger than ${PGN_LIMITS.maxBytes / 1024 / 1024} MB.` }],
      truncated: false,
    };
  }
  const texts = splitPgnGames(text);
  const truncated = texts.length > PGN_LIMITS.maxGames;
  const games: GameRecord[] = [];
  const errors: PgnParseError[] = [];
  texts.slice(0, PGN_LIMITS.maxGames).forEach((t, index) => {
    try {
      games.push(parseSingleGame(t, options));
    } catch (e) {
      errors.push({ index, message: (e as Error).message, headers: parseHeaders(t) });
    }
  });
  if (texts.length === 0) errors.push({ index: 0, message: 'No PGN games found in the input.' });
  return { games, errors, truncated };
}

export function gameTitle(game: GameRecord): string {
  const w = game.headers.White ?? '?';
  const b = game.headers.Black ?? '?';
  const r = game.headers.Result ?? '*';
  const d = game.headers.UTCDate ?? game.headers.Date ?? '';
  return `${w} vs ${b} (${r})${d && !d.includes('?') ? ` · ${d}` : ''}`;
}
