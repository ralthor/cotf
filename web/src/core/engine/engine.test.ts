import { describe, expect, it } from 'vitest';
import { buildGoCommand, parseBestMove, parseInfoLine, toWhiteScore } from './uci';
import { EngineClient } from './EngineClient';
import { EngineError } from './types';
import { fakeTransport } from '../../test/fakeEngine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('UCI parsing', () => {
  it('parses multipv, cp, nodes, wdl and pv', () => {
    const i = parseInfoLine(
      'info depth 18 seldepth 25 multipv 2 score cp -35 wdl 50 900 50 nodes 123456 nps 1000 time 120 pv e7e5 g1f3 b8c6',
    )!;
    expect(i).toMatchObject({ depth: 18, seldepth: 25, multipv: 2, nodes: 123456, timeMs: 120 });
    expect(i.score).toEqual({ kind: 'cp', value: -35 });
    expect(i.wdl).toEqual({ win: 50, draw: 900, loss: 50 });
    expect(i.pv).toEqual(['e7e5', 'g1f3', 'b8c6']);
  });
  it('parses mate scores and bounds', () => {
    const i = parseInfoLine('info depth 20 score mate -3 upperbound nodes 5 pv e1e2')!;
    expect(i.score).toEqual({ kind: 'mate', value: -3 });
    expect(i.bound).toBe('upper');
  });
  it('ignores currmove and string lines', () => {
    expect(parseInfoLine('info depth 5 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfoLine('info string NNUE evaluation using nn.bin')).toBeNull();
  });
  it('parses bestmove including (none)', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ best: 'e2e4', ponder: 'e7e5' });
    expect(parseBestMove('bestmove (none)')).toEqual({ best: null, ponder: undefined });
  });
  it('builds go commands with searchmoves', () => {
    expect(buildGoCommand({ depth: 12, searchMoves: ['e7e8q'] })).toBe('go depth 12 searchmoves e7e8q');
    expect(buildGoCommand({})).toBe('go depth 16');
  });
});

describe('score perspective', () => {
  it('flips cp for black to move', () => {
    expect(toWhiteScore({ kind: 'cp', value: 50 }, 'b')).toEqual({ kind: 'cp', value: -50, perspective: 'white' });
    expect(toWhiteScore({ kind: 'cp', value: 50 }, 'w')).toEqual({ kind: 'cp', value: 50, perspective: 'white' });
  });
  it('converts mate scores to a winner', () => {
    expect(toWhiteScore({ kind: 'mate', value: 2 }, 'b')).toMatchObject({ kind: 'mate', moves: 2, winner: 'b' });
    expect(toWhiteScore({ kind: 'mate', value: -2 }, 'b')).toMatchObject({ kind: 'mate', moves: 2, winner: 'w' });
  });
});

describe('EngineClient', () => {
  it('handshakes, sets MultiPV and returns same-depth lines (black to move, white-relative)', async () => {
    const t = fakeTransport(({ emit }) => {
      emit('info depth 1 multipv 1 score cp 10 pv e7e5');
      emit('info depth 1 multipv 2 score cp 0 pv c7c5');
      emit('info depth 2 multipv 1 score cp 20 pv e7e5 g1f3');
      emit('info depth 2 multipv 2 score cp 5 pv c7c5 g1f3');
      emit('info depth 3 multipv 1 score cp 25 pv e7e5 g1f3 b8c6'); // incomplete depth 3
      emit('bestmove e7e5');
    });
    const c = new EngineClient(() => t, 'fake');
    const r = await c.analyse({ fen: AFTER_E4, depth: 3, multiPv: 2 });
    expect(t.sent.slice(0, 2)).toEqual(['uci', 'isready']);
    expect(t.sent).toContain('setoption name MultiPV value 2');
    expect(r.completedDepth).toBe(2); // depth 3 lacked multipv 2
    expect(r.lines.map((l) => l.rank)).toEqual([1, 2]);
    expect(r.lines[0]!.score).toEqual({ kind: 'cp', value: -20, perspective: 'white' });
    expect(r.bestMoveUci).toBe('e7e5');
    expect(r.byDepth).toHaveLength(3);
    expect(r.engineId).toContain('FakeFish');
  });

  it('serialises concurrent requests so output never mixes', async () => {
    const t = fakeTransport(({ fen, emit }) => {
      const v = fen.includes(' w ') ? 11 : 22;
      setTimeout(() => {
        emit(`info depth 1 multipv 1 score cp ${v} pv a2a3`);
        emit('bestmove a2a3');
      }, 5);
    });
    const c = new EngineClient(() => t);
    const [a, b] = await Promise.all([c.analyse({ fen: START, depth: 1 }), c.analyse({ fen: AFTER_E4, depth: 1 })]);
    expect(a.lines[0]!.score).toMatchObject({ value: 11 });
    expect(b.lines[0]!.score).toMatchObject({ value: -22 });
  });

  it('passes searchmoves for restricted-root searches', async () => {
    const t = fakeTransport(({ emit }) => {
      emit('info depth 1 multipv 1 score cp -300 pv d1h5');
      emit('bestmove d1h5');
    });
    const c = new EngineClient(() => t);
    await c.analyse({ fen: START, depth: 8, searchMoves: ['d2d4'] });
    expect(t.sent).toContain('go depth 8 searchmoves d2d4');
  });

  it('cancels, sends stop and waits for bestmove before the next search', async () => {
    let call = 0;
    const t = fakeTransport(({ emit }) => {
      call++;
      if (call === 1) emit('info depth 1 multipv 1 score cp 1 pv e2e4'); // hangs until stop
      else {
        emit('info depth 1 multipv 1 score cp 33 pv d2d4');
        emit('bestmove d2d4');
      }
    });
    const c = new EngineClient(() => t);
    const ac = new AbortController();
    const first = c.analyse({ fen: START, depth: 30 }, { signal: ac.signal });
    const second = c.analyse({ fen: START, depth: 1 });
    setTimeout(() => ac.abort(), 10);
    await expect(first).rejects.toBeInstanceOf(EngineError);
    const r = await second;
    expect(t.sent).toContain('stop');
    expect(r.lines[0]!.score).toMatchObject({ value: 33 });
  });

  it('restarts the engine when stop is not acknowledged', async () => {
    let starts = 0;
    const c = new EngineClient(() => {
      starts++;
      return fakeTransport(() => undefined, { respondToStop: false });
    });
    await expect(c.analyse({ fen: START, depth: 5, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
    expect(starts).toBe(2);
  });

  it('rejects invalid FEN without touching the engine', async () => {
    const t = fakeTransport(() => undefined);
    const c = new EngineClient(() => t);
    await expect(c.analyse({ fen: 'not a fen' })).rejects.toMatchObject({ code: 'invalid-fen' });
    expect(t.sent).toHaveLength(0);
  });

  it('handles checkmate and stalemate positions without searching', async () => {
    const t = fakeTransport(() => undefined);
    const c = new EngineClient(() => t);
    const mated = await c.analyse({ fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3' });
    expect(mated.terminal).toBe('checkmate');
    expect(mated.lines[0]!.score).toMatchObject({ kind: 'mate', moves: 0, winner: 'b' });
    const stale = await c.analyse({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
    expect(stale.terminal).toBe('stalemate');
  });
});
