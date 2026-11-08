import { describe, expect, it } from 'vitest';
import { parseSingleGame } from '../../core/chess/pgn';
import { EngineClient } from '../../core/engine/EngineClient';
import { materialEngineTransport } from '../../test/materialEngine';
import { MemoryAnalysisCache, analysisCacheKey, canonicalFen } from './cache';
import { GameAnalyser } from './orchestrator';
import { PRESETS, type GameAnalysis } from './types';

const QUEEN_BLUNDER = `[White "W"]
[Black "B"]
[Result "0-1"]

1. e4 d5 2. Qg4 Bxg4 0-1`;

const preset = { ...PRESETS.fast, firstPassDepth: 2, deepPassDepth: 2, brilliancyDeepDepth: 2, recheckDepth: 2, brilliancyShallowDepth: 2 };

describe('GameAnalyser', () => {
  it('labels a hanging queen as a blunder and the capture as best, for both colours', async () => {
    const game = parseSingleGame(QUEEN_BLUNDER, { source: 'pgn-paste' });
    const engine = new EngineClient(materialEngineTransport, 'material');
    const updates: GameAnalysis[] = [];
    const r = await new GameAnalyser(engine, new MemoryAnalysisCache(), preset).run(game, { onUpdate: (s) => updates.push(s) });
    expect(r.phase).toBe('done');
    expect(r.moves).toHaveLength(4);
    expect(r.positionEvals).toHaveLength(5);
    const [, , qg4, bxg4] = r.moves;
    expect(qg4!.category).toBe('blunder');
    expect(qg4!.loss!.centipawnLoss).toBeGreaterThanOrEqual(800);
    expect(bxg4!.category).toBe('best');
    expect(bxg4!.colour).toBe('b');
    expect(r.summary!.white.counts.blunder).toBe(1);
    expect(updates.length).toBeGreaterThan(4);
    expect(updates.some((u) => u.phase === 'first-pass')).toBe(true);
    expect(r.moves.every((m) => !m!.provisional)).toBe(true);
  });

  it('scores a played move outside MultiPV top 2 via searchmoves', async () => {
    const game = parseSingleGame(QUEEN_BLUNDER, { source: 'pgn-paste' });
    const t = materialEngineTransport();
    const engine = new EngineClient(() => t, 'material');
    const r = await new GameAnalyser(engine, new MemoryAnalysisCache(), preset).run(game, { skipBrilliancy: true });
    expect(r.moves[2]!.playedScoreMethod).toBe('searchmoves');
    expect(t.sent.some((c) => c.endsWith('searchmoves d1g4'))).toBe(true);
  });

  it('reuses cached results on re-run (resume)', async () => {
    const game = parseSingleGame(QUEEN_BLUNDER, { source: 'pgn-paste' });
    const cache = new MemoryAnalysisCache();
    const t = materialEngineTransport();
    const engine = new EngineClient(() => t, 'material');
    await new GameAnalyser(engine, cache, preset).run(game, { skipBrilliancy: true });
    const goCount = t.sent.filter((c) => c.startsWith('go')).length;
    await new GameAnalyser(engine, cache, preset).run(game, { skipBrilliancy: true });
    expect(t.sent.filter((c) => c.startsWith('go')).length).toBe(goCount);
  });

  it('can be cancelled and reports a cancelled phase', async () => {
    const game = parseSingleGame(QUEEN_BLUNDER, { source: 'pgn-paste' });
    const engine = new EngineClient(materialEngineTransport, 'material');
    const ac = new AbortController();
    ac.abort();
    const r = await new GameAnalyser(engine, new MemoryAnalysisCache(), preset).run(game, { signal: ac.signal });
    expect(r.phase).toBe('cancelled');
  });
});

describe('cache keys', () => {
  it('include engine, search settings and canonical FEN', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(canonicalFen(fen)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
    const a = analysisCacheKey('sf-lite', { fen, depth: 12, multiPv: 2 });
    expect(a).not.toBe(analysisCacheKey('sf-full', { fen, depth: 12, multiPv: 2 }));
    expect(a).not.toBe(analysisCacheKey('sf-lite', { fen, depth: 12, multiPv: 3 }));
    expect(a).not.toBe(analysisCacheKey('sf-lite', { fen, depth: 12, multiPv: 2, searchMoves: ['e7e5'] }));
    expect(a).toBe(analysisCacheKey('sf-lite', { fen: fen.replace(' 0 1', ' 0 7'), depth: 12, multiPv: 2 }));
  });
});
