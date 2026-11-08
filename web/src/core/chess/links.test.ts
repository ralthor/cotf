import { describe, expect, it } from 'vitest';
import { lichessAnalysisUrl } from './links';

describe('lichessAnalysisUrl', () => {
  it('encodes the FEN with underscores and keeps slashes', () => {
    expect(lichessAnalysisUrl('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'black')).toBe(
      'https://lichess.org/analysis/standard/rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR_b_KQkq_-_0_1?color=black',
    );
  });
  it('defaults to white orientation and handles en-passant squares', () => {
    expect(lichessAnalysisUrl('8/8/8/3pP3/8/8/8/K6k w - d6 0 2')).toBe(
      'https://lichess.org/analysis/standard/8/8/8/3pP3/8/8/8/K6k_w_-_d6_0_2?color=white',
    );
  });
});
