/** Glyphs for the common NAGs (move and position assessments). Others are not shown. */
const GLYPHS: Record<number, string> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
  7: '□',
  10: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+−',
  19: '−+',
  22: '⨀',
  23: '⨀',
  32: '⟳',
  33: '⟳',
  36: '↑',
  37: '↑',
  40: '→',
  41: '→',
  132: '⇆',
  133: '⇆',
  138: '⊕',
  139: '⊕',
  140: '∆',
  146: 'N',
};

/** Move assessments (!, ?, …) come right after the move; the rest are shown after a space. */
export function nagGlyph(nag: number): string | undefined {
  return GLYPHS[nag];
}

export function isMoveNag(nag: number): boolean {
  return nag >= 1 && nag <= 7;
}

/** i18n key describing a NAG, for titles and screen readers. */
export function nagKey(nag: number): string | undefined {
  return GLYPHS[nag] ? `nag.${nag}` : undefined;
}

/** Move glyphs first, then position glyphs, e.g. "!? ±". */
export function nagText(nags: readonly number[] | undefined): { move: string; position: string } {
  const move = (nags ?? []).filter(isMoveNag).map(nagGlyph).filter(Boolean).join('');
  const position = (nags ?? []).filter((n) => !isMoveNag(n)).map(nagGlyph).filter(Boolean).join(' ');
  return { move, position };
}

/** NAGs that are i18n'd (nag.<n> keys must exist in every locale). */
export const NAMED_NAGS = Object.keys(GLYPHS).map(Number);
