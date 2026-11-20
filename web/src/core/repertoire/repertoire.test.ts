import { describe, expect, it } from 'vitest';
import { ANNOTATED, BAD_GAMES, FROM_POSITION, LICHESS_STUDY, TRANSPOSITION } from '../../test/fixtures/repertoire';
import { chapterToPgn } from './export';
import { buildMoves } from './graph';
import { nagText } from './nags';
import { nodeAt, parseRepertoirePgn, type ParsedChapter } from './parse';
import { posKeyFromFen } from './posKey';
import type { Chapter, RepNode } from './types';

const asChapter = (p: ParsedChapter, id = `c${p.index}`, side = p.orientation ?? 'w'): Chapter => ({
  id,
  repertoireId: 'r1',
  title: p.title ?? id,
  side,
  source: { kind: 'pgn-paste' },
  importedAt: '2026-11-20T00:00:00Z',
  headers: p.headers,
  startFen: p.startFen,
  root: p.root,
  order: p.index,
});

/** Strips fen/posKey so trees can be compared on content only. */
const content = (n: RepNode): unknown => ({
  san: n.san,
  uci: n.uci,
  nags: n.nags,
  commentsBefore: n.commentsBefore,
  comments: n.comments,
  shapes: n.shapes,
  eval: n.eval,
  children: n.children.map(content),
});

describe('position keys', () => {
  it('drop move counters and an en-passant square with no capture', () => {
    expect(posKeyFromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    );
    expect(posKeyFromFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3')).toBe(
      'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6',
    );
    expect(posKeyFromFen('not a fen')).toBeNull();
  });
});

describe('parseRepertoirePgn', () => {
  const { chapters, warnings } = parseRepertoirePgn(ANNOTATED);
  const ch = chapters[0]!;

  it('keeps the main line and every variation', () => {
    expect(warnings).toEqual([]);
    expect(ch.title).toBe('Italian ideas');
    expect(ch.orientation).toBe('w');
    const afterNf3 = nodeAt(ch.root, [0, 0, 0])!;
    expect(afterNf3.children.map((c) => c.san)).toEqual(['Nc6', 'd6', 'Nf6']);
    // Three levels: 2...d6 3.d4 (3.Bc4 Be7 (3...Nf6 4.Ng5))
    const bc4 = nodeAt(ch.root, [0, 0, 0, 1, 1])!;
    expect(bc4.san).toBe('Bc4');
    expect(bc4.children.map((c) => c.san)).toEqual(['Be7', 'Nf6']);
    expect(nodeAt(ch.root, [0, 0, 0, 1, 1, 1, 0])!.san).toBe('Ng5');
    expect(ch.nodeCount).toBe(16);
  });

  it('parses comments, arrows, circles and evals, and drops clocks', () => {
    expect(ch.root.comments).toEqual(['Start here.']);
    expect(ch.root.shapes).toEqual([{ color: 'green', from: 'e4', to: 'e4' }]);
    const e4 = ch.root.children[0]!;
    expect(e4.uci).toBe('e2e4');
    expect(e4.comments).toEqual(["King's pawn."]);
    expect(e4.shapes).toEqual([
      { color: 'green', from: 'e2', to: 'e4' },
      { color: 'red', from: 'd7', to: 'd5' },
    ]);
    expect(e4.eval).toEqual({ pawns: 0.3 });
    const bc4 = nodeAt(ch.root, [0, 0, 0, 0, 0])!;
    expect(bc4.eval).toEqual({ mate: -2 });
  });

  it('keeps NAGs written as $n and as glyphs, and comments before a move', () => {
    expect(nodeAt(ch.root, [0, 0])!.nags).toEqual([1]);
    expect(nodeAt(ch.root, [0, 0, 0, 0, 0])!.nags).toEqual([5]);
    expect(nodeAt(ch.root, [0, 0, 0, 0, 0, 0])!.nags).toEqual([16]);
    expect(nagText([5, 16])).toEqual({ move: '!?', position: '±' });
    expect(nodeAt(ch.root, [0, 0, 0, 2])!.commentsBefore).toEqual(['Petroff:']);
  });

  it('starts from a [FEN] position', () => {
    const r = parseRepertoirePgn(FROM_POSITION);
    expect(r.chapters[0]!.startFen).toBe('4k3/8/8/8/8/8/4P3/4K3 w - - 0 40');
    expect(r.chapters[0]!.root.children[0]!.san).toBe('e4');
  });

  it('skips empty and non-standard games and cuts illegal branches with a warning', () => {
    const r = parseRepertoirePgn(BAD_GAMES);
    expect(r.chapters.map((c) => c.title)).toEqual(['Illegal in variation']);
    expect(r.warnings).toEqual([
      { game: 1, code: 'empty' },
      { game: 2, code: 'variant', vars: { variant: 'Crazyhouse' } },
      { game: 3, code: 'illegal', vars: { move: '2. Ke3' } },
    ]);
    // 1...Nc6 is kept (legal); only 2.Ke3 and what follows is cut.
    const e4 = r.chapters[0]!.root.children[0]!;
    expect(e4.children.map((c) => c.san)).toEqual(['e5', 'Nc6', 'c5']);
    expect(e4.children[1]!.children).toEqual([]);
  });

  it('writes castling as standard UCI', () => {
    const r = parseRepertoirePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *');
    expect(nodeAt(r.chapters[0]!.root, [0, 0, 0, 0, 0, 0, 0])!.uci).toBe('e1g1');
  });

  it('reads a Lichess study export as chapters', () => {
    const r = parseRepertoirePgn(LICHESS_STUDY);
    expect(r.chapters.map((c) => [c.title, c.orientation])).toEqual([
      ['Caro-Kann', 'b'],
      ['Scandinavian', 'w'],
    ]);
    expect(r.chapters[0]!.root.comments).toEqual(['The main idea is a quick ...c5.']);
  });
});

describe('buildMoves', () => {
  it('merges transpositions into one position', () => {
    const r = parseRepertoirePgn(TRANSPOSITION);
    const chapters = r.chapters.map((c) => asChapter(c));
    const moves = buildMoves('r1', chapters);
    const finalKeys = new Set(chapters.map((c) => nodeAt(c.root, [0, 0, 0, 0])!.posKey));
    expect(finalKeys.size).toBe(1);
    // Black's moves are "mine" in a Black repertoire.
    expect(moves.filter((m) => m.mine).map((m) => m.san).sort()).toEqual(['Nf6', 'Nf6', 'e6', 'e6']);
    expect(moves.every((m) => m.side === 'b')).toBe(true);
  });

  it('merges the same move from two chapters and records both', () => {
    const r = parseRepertoirePgn(`${ANNOTATED}\n\n[Event "Again"]\n\n1. e4 e5 *`);
    const moves = buildMoves('r1', r.chapters.map((c) => asChapter(c, `c${c.index}`, 'w')));
    const e4 = moves.find((m) => m.san === 'e4')!;
    expect(e4.refs).toEqual([
      { chapterId: 'c1', path: [0] },
      { chapterId: 'c2', path: [0] },
    ]);
    expect(e4.mine).toBe(true);
    expect(moves.find((m) => m.san === 'd6')!.main).toBe(false);
  });
});

describe('chapterToPgn', () => {
  it('round-trips variations, comments, shapes, evals and NAGs', () => {
    const original = parseRepertoirePgn(ANNOTATED).chapters[0]!;
    const pgn = chapterToPgn(asChapter(original));
    expect(pgn).toContain('[%cal Ge2e4,Rd7d5]');
    expect(pgn).toContain('[Orientation "white"]');
    expect(pgn).not.toContain('%clk');
    const again = parseRepertoirePgn(pgn);
    expect(again.warnings).toEqual([]);
    expect(content(again.chapters[0]!.root)).toEqual(content(original.root));
  });
});

describe('NAG names', () => {
  it('every glyph has a description in English', async () => {
    const { NAMED_NAGS } = await import('./nags');
    const en = (await import('../../i18n/locales/en.json')).default as Record<string, string>;
    expect(NAMED_NAGS.filter((n) => !en[`nag.${n}`])).toEqual([]);
  });
});

describe('displayComment', () => {
  it('hides unknown [%…] commands', async () => {
    const { displayComment } = await import('./parse');
    expect(displayComment('[%anno "AAArmstark", aaarmstark] White is better.')).toBe('White is better.');
    expect(displayComment('[%anno "x"]')).toBe('');
  });
});
