import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { parsePgn, parseSingleGame } from '../../core/chess/pgn';
import { EngineClient } from '../../core/engine/EngineClient';
import { materialEngineTransport } from '../../test/materialEngine';
import { MemoryAnalysisCache } from './cache';
import { annotatedPgn, analysisJson } from './export';
import { GameAnalyser } from './orchestrator';
import { PRESETS } from './types';
import { IdbAnalysisCache, analysisKey, analysisStore, gameStore } from '../../storage/db';

const PGN = `[Event "Export test"]
[White "W"]
[Black "B"]
[Result "0-1"]

1. e4 d5 2. Qg4 Bxg4 0-1`;

const preset = { ...PRESETS.fast, firstPassDepth: 2, deepPassDepth: 2, brilliancyDeepDepth: 2, recheckDepth: 2, brilliancyShallowDepth: 2 };

describe('export', () => {
  it('writes an annotated PGN that re-imports to the same moves', async () => {
    const game = parseSingleGame(PGN, { source: 'pgn-paste' });
    const a = await new GameAnalyser(new EngineClient(materialEngineTransport, 'm'), new MemoryAnalysisCache(), preset).run(game);
    const pgn = annotatedPgn(game, a);
    expect(pgn).toContain('[Annotator "Chess Game Analyser');
    expect(pgn).toContain('Qg4 $4');
    expect(pgn).toMatch(/\[%eval -?\d+\.\d\d\]/);
    const back = parsePgn(pgn, { source: 'pgn-paste' });
    expect(back.errors).toEqual([]);
    expect(back.games[0]!.moves.map((m) => m.san)).toEqual(game.moves.map((m) => m.san));
    const json = JSON.parse(analysisJson(game, a));
    expect(json.format).toBe('chess-analyser/v1');
  });
});

describe('IndexedDB storage', () => {
  it('stores games, analyses and engine results', async () => {
    const game = parseSingleGame(PGN, { source: 'pgn-paste' });
    await gameStore.put(game);
    expect((await gameStore.list()).map((g) => g.id)).toContain(game.id);
    const cache = new IdbAnalysisCache();
    const a = await new GameAnalyser(new EngineClient(materialEngineTransport, 'm'), cache, preset).run(game, { skipBrilliancy: true });
    const key = analysisKey(game.id, a.presetId, a.policyVersion);
    await analysisStore.put(key, a);
    expect((await analysisStore.get(key))!.moves).toHaveLength(4);
    const fresh = new IdbAnalysisCache();
    // A fresh cache instance reads persisted results from IndexedDB.
    const t = materialEngineTransport();
    await new GameAnalyser(new EngineClient(() => t, 'm'), fresh, preset).run(game, { skipBrilliancy: true });
    expect(t.sent.filter((c) => c.startsWith('go'))).toHaveLength(0);
  });
});
