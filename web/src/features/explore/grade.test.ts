import { describe, expect, it } from 'vitest';
import type { EngineLine, EngineScore, PositionAnalysis, SearchRequest } from '../../core/engine/types';
import { gradeMove, legalMove, type Analyser } from './grade';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const cp = (value: number): EngineScore => ({ kind: 'cp', value, perspective: 'white' });
const line = (uci: string, value: number, rank = 1): EngineLine => ({ rank, score: cp(value), pvUci: [uci], depth: 18 });

function fakeEngine(scores: Record<string, number>, bestUci: string) {
  const calls: SearchRequest[] = [];
  const engine: Analyser = {
    async analyse(req) {
      calls.push(req);
      const uci = req.searchMoves?.[0] ?? bestUci;
      return { fen: req.fen, lines: [line(uci, scores[uci] ?? 0)], completedDepth: req.depth ?? 0 } as unknown as PositionAnalysis;
    },
  };
  return { engine, calls };
}

describe('legalMove', () => {
  it('returns uci and san for a legal drag, null otherwise', () => {
    expect(legalMove(START, 'e2', 'e4')).toEqual({ uci: 'e2e4', san: 'e4' });
    expect(legalMove(START, 'e2', 'e5')).toBeNull();
  });

  it('promotes to a queen', () => {
    expect(legalMove('8/4P3/8/8/8/8/8/k6K w - - 0 1', 'e7', 'e8')?.uci).toBe('e7e8q');
  });
});

describe('gradeMove', () => {
  it('calls the best move best without a second search', async () => {
    const { engine, calls } = fakeEngine({ e2e4: 30 }, 'e2e4');
    const g = await gradeMove(engine, START, 'e2e4', { depth: 10 });
    expect(g.category).toBe('best');
    expect(g.san).toBe('e4');
    expect(calls).toHaveLength(1);
  });

  it('searches a move that is not the best on its own and classifies the loss', async () => {
    const { engine, calls } = fakeEngine({ e2e4: 30, g2g4: -250 }, 'e2e4');
    const g = await gradeMove(engine, START, 'g2g4', { depth: 10 });
    expect(calls[1]?.searchMoves).toEqual(['g2g4']);
    expect(['mistake', 'blunder']).toContain(g.category);
    expect(g.bestUci).toBe('e2e4');
  });

  it('uses known lines instead of searching', async () => {
    const { engine, calls } = fakeEngine({}, 'e2e4');
    const g = await gradeMove(engine, START, 'd2d4', { depth: 10, known: [line('e2e4', 30), line('d2d4', 28, 2)] });
    expect(g.category).toBe('best');
    expect(calls).toHaveLength(0);
  });

  it('rejects an illegal move', async () => {
    const { engine } = fakeEngine({}, 'e2e4');
    await expect(gradeMove(engine, START, 'e2e5', { depth: 10 })).rejects.toThrow();
  });
});
