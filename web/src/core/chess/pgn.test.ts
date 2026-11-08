import { describe, expect, it } from 'vitest';
import { DEFAULT_POSITION } from 'chess.js';
import { parsePgn, parseSingleGame, splitPgnGames, parseClock } from './pgn';
import { positionsOf } from './types';
import {
  CHESS960,
  EN_PASSANT,
  ILLEGAL,
  ITALIAN_CASTLING,
  MULTI,
  PROMOTION_FROM_FEN,
  WITH_VARIATIONS_AND_NAGS,
} from '../../test/fixtures/pgn';

const opts = { source: 'pgn-paste' as const, importedAt: '2026-11-08T00:00:00Z' };

describe('splitPgnGames', () => {
  it('splits multi-game input into distinct games', () => {
    expect(splitPgnGames(MULTI)).toHaveLength(3);
  });
  it('handles CRLF and BOM', () => {
    expect(splitPgnGames('﻿' + MULTI.replace(/\n/g, '\r\n'))).toHaveLength(3);
  });
});

describe('parseSingleGame', () => {
  it('reconstructs positions, castling and clocks', () => {
    const g = parseSingleGame(ITALIAN_CASTLING, opts);
    expect(g.initialFen).toBe(DEFAULT_POSITION);
    expect(g.moves).toHaveLength(10);
    expect(positionsOf(g)).toHaveLength(11);
    const castle = g.moves[6]!;
    expect(castle.san).toBe('O-O');
    expect(castle.uci).toBe('e1g1');
    expect(castle.colour).toBe('w');
    expect(castle.fullMoveNumber).toBe(4);
    expect(g.moves[0]!.clockSeconds).toBe(300);
    expect(g.moves[9]!.fenAfter).toBe('r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w - - 1 6');
    // fenBefore of ply n equals fenAfter of ply n-1
    for (let i = 1; i < g.moves.length; i++) expect(g.moves[i]!.fenBefore).toBe(g.moves[i - 1]!.fenAfter);
  });

  it('handles en passant', () => {
    const g = parseSingleGame(EN_PASSANT, opts);
    const ep = g.moves[4]!;
    expect(ep.san).toBe('exd6');
    expect(ep.uci).toBe('e5d6');
    expect(ep.fenAfter.split(' ')[0]).toBe('rnbqkb1r/ppp1pppp/3P1n2/8/8/8/PPPP1PPP/RNBQKBNR');
  });

  it('handles SetUp/FEN and promotion', () => {
    const g = parseSingleGame(PROMOTION_FROM_FEN, opts);
    expect(g.initialFen).toBe('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(g.headers.FEN).toBe('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(g.moves[0]!.uci).toBe('a7a8q');
    expect(g.moves[0]!.isCheck).toBe(true);
  });

  it('keeps the main line, strips NAGs, keeps comments and detects mate', () => {
    const g = parseSingleGame(WITH_VARIATIONS_AND_NAGS, opts);
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(g.moves[2]!.comment).toBe('A comment');
    expect(g.moves[6]!.isCheckmate).toBe(true);
  });

  it('records legal move counts for forced-move detection', () => {
    const g = parseSingleGame(PROMOTION_FROM_FEN, opts);
    expect(g.moves[1]!.legalMoveCount).toBeGreaterThan(0);
  });

  it('rejects illegal moves with an actionable message', () => {
    expect(() => parseSingleGame(ILLEGAL, opts)).toThrow(/Could not read moves/);
  });

  it('rejects unsupported variants', () => {
    expect(() => parseSingleGame(CHESS960, opts)).toThrow(/Unsupported variant/);
  });

  it('gives a stable content-hash id, or a URL id when a source URL is known', () => {
    const a = parseSingleGame(EN_PASSANT, opts);
    const b = parseSingleGame(EN_PASSANT, opts);
    expect(a.id).toBe(b.id);
    const c = parseSingleGame(EN_PASSANT, { ...opts, sourceUrl: 'https://lichess.org/abcdefgh' });
    expect(c.id).toBe('url:https://lichess.org/abcdefgh');
  });
});

describe('parsePgn', () => {
  it('returns valid games and reports invalid ones without crashing', () => {
    const r = parsePgn([ITALIAN_CASTLING, ILLEGAL, EN_PASSANT].join('\n\n'), opts);
    expect(r.games).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.index).toBe(1);
  });
  it('reports empty input', () => {
    expect(parsePgn('   ', opts).errors[0]!.message).toMatch(/No PGN/);
  });
  it('guards input size', () => {
    expect(parsePgn('x'.repeat(6 * 1024 * 1024), opts).errors[0]!.message).toMatch(/larger/);
  });
});

describe('parseClock', () => {
  it('parses fractional seconds', () => {
    expect(parseClock('[%clk 1:02:03.5]')).toBe(3723.5);
    expect(parseClock('no clock')).toBeUndefined();
  });
});
