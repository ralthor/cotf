import { describe, expect, it } from 'vitest';
import { parseSingleGame } from '../../core/chess/pgn';
import { EngineClient } from '../../core/engine/EngineClient';
import { materialEngineTransport } from '../../test/materialEngine';
import { MemoryAnalysisCache } from '../analysis/cache';
import { PRESETS } from '../analysis/types';
import { MoveExplainer } from './explainer';

const preset = { ...PRESETS.fast, deepPassDepth: 2 };

describe('MoveExplainer (2-ply material engine)', () => {
  it('a hanging queen is explained as an allowed tactic, not as ignoring the pawn threat', async () => {
    const game = parseSingleGame('1. e4 d5 2. Qg4 Bxg4 0-1', { source: 'pgn-paste' });
    const ex = new MoveExplainer(new EngineClient(materialEngineTransport, 'material'), new MemoryAnalysisCache(), preset);
    const r = await ex.whyBad(game.moves[2]!);
    expect(r.refutationSan).toBe('Bxg4');
    expect(r.threat?.san).toBe('dxe4');
    expect(r.causes.map((c) => c.kind)).toEqual(['allowed-tactic']);
    expect(r.causes[0]!.text).toMatch(/^Qg4 allows Bxg4; in the engine's line Black wins 9 pawns of material\./);
  });

  it('finds the threat in a position and returns null in check', async () => {
    const ex = new MoveExplainer(new EngineClient(materialEngineTransport, 'material'), new MemoryAnalysisCache(), preset);
    const t = await ex.threats('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2');
    expect(t?.main.san).toBe('dxe4');
    expect(t?.real.map((x) => x.san)).toContain('dxe4');
    expect(await ex.threats('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1')).toBeNull();
  });
});
