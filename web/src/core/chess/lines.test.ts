import { describe, expect, it } from 'vitest';
import { numberedLine, squarePosition, uciLineToSan } from './lines';

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('lines', () => {
  it('converts UCI to SAN and stops at illegal moves', () => {
    expect(uciLineToSan(AFTER_E4, ['e7e5', 'g1f3', 'b8c6', 'zzzz', 'f1b5'])).toEqual(['e5', 'Nf3', 'Nc6']);
  });
  it('numbers lines from either side to move', () => {
    expect(numberedLine(AFTER_E4, ['e5', 'Nf3', 'Nc6'])).toBe('1... e5 2. Nf3 Nc6');
    expect(numberedLine('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', ['Nf3', 'Nc6', 'Bb5'])).toBe('2. Nf3 Nc6 3. Bb5');
  });
  it('maps squares to board percentages for both orientations', () => {
    expect(squarePosition('a8', 'white')).toEqual({ left: 0, top: 0 });
    expect(squarePosition('h1', 'white')).toEqual({ left: 87.5, top: 87.5 });
    expect(squarePosition('a8', 'black')).toEqual({ left: 87.5, top: 87.5 });
    expect(squarePosition('d4', 'white')).toEqual({ left: 37.5, top: 50 });
  });
});
