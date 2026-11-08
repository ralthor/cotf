import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyMove, DEFAULT_POLICY } from './classify';
import { ACCURACY_VERSION, gameAccuracy } from '../scoring/accuracy';
import type { EngineScore } from '../engine/types';

type Case = {
  name: string;
  mover: 'w' | 'b';
  playedUci: string;
  bestUci: string;
  best: EngineScore;
  played: EngineScore;
  forced?: boolean;
  brilliant?: boolean;
  expected: string;
  expectedCpl: number | null;
};

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../shared/classifier-cases.json', import.meta.url)), 'utf8'),
) as { policyVersion: string; accuracyVersion: string; cases: Case[]; accuracy: { losses: number[] } };

describe('classifier parity fixture (shared with the Python backend)', () => {
  it('uses the same versions', () => {
    expect(fixture.policyVersion).toBe(DEFAULT_POLICY.version);
    expect(fixture.accuracyVersion).toBe(ACCURACY_VERSION);
  });
  for (const c of fixture.cases) {
    it(c.name, () => {
      const r = classifyMove(c);
      expect(r.category).toBe(c.expected);
      expect(r.loss.centipawnLoss ?? null).toBe(c.expectedCpl);
    });
  }
  it('accuracy value matches the documented reference', () => {
    const r = gameAccuracy(fixture.accuracy.losses.map((l) => ({ expectedLossPct: l, forced: false })));
    // Python test asserts the same number.
    expect(r.value).toBe(80.6);
  });
});
