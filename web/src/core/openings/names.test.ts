import { describe, expect, it } from 'vitest';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { posKey } from '../repertoire/posKey';
import { family, loadOpenings, lookup, openingOf } from './names';

function keys(moves: string): string[] {
  const pos = Chess.default();
  const out = [posKey(pos)];
  for (const san of moves.split(' ')) {
    pos.play(parseSan(pos, san)!);
    out.push(posKey(pos));
  }
  return out;
}

describe('opening names', () => {
  it('names positions, including by transposition', async () => {
    const t = await loadOpenings();
    expect(Object.keys(t).length).toBeGreaterThan(3000);
    const caro = keys('e4 c6 d4 d5 e5');
    expect(lookup(t, caro.at(-1)!)).toEqual({ eco: 'B12', name: 'Caro-Kann Defense: Advance Variation' });
    // A move with no name of its own keeps the last named one.
    expect(openingOf(t, keys('e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7 O-O Ne7'))?.name).toMatch(/^Caro-Kann Defense: Advance Variation/);
    // QGD reached through the English order.
    expect(openingOf(t, keys('c4 e6 Nc3 d5 d4'))?.name).toMatch(/Queen's Gambit Declined/);
    expect(openingOf(t, [keys('e4')[0]!])).toBeNull();
    expect(family('Caro-Kann Defense: Advance Variation')).toBe('Caro-Kann Defense');
  });
});
