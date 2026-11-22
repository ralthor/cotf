import { describe, expect, it } from 'vitest';
import { FullBackupError, isFullBackup, makeFullBackup, parseFullBackup } from './fullBackup';

describe('full backup', () => {
  it('round-trips stores with dates, maps and sets, and never writes the Lichess token', () => {
    const due = new Date('2026-11-22T10:00:00Z');
    const text = makeFullBackup({
      dbVersion: 7,
      stores: { trainCards: [{ v: { due, seen: new Set(['a']), by: new Map([['k', 1]]) } }], settings: [{ k: 'preset', v: 'standard' }] },
      prefs: { lichessToken: 'secret', insightsList: 'losses' },
      extras: { 'i18n.locale': 'fa' },
    });
    expect(text).not.toContain('secret');
    expect(isFullBackup(text)).toBe(true);
    const b = parseFullBackup(text);
    const card = b.stores.trainCards![0]!.v as { due: Date; seen: Set<string>; by: Map<string, number> };
    expect(card.due).toEqual(due);
    expect(card.seen.has('a')).toBe(true);
    expect(card.by.get('k')).toBe(1);
    expect(b.stores.settings![0]).toEqual({ k: 'preset', v: 'standard' });
    expect(b.prefs).toEqual({ insightsList: 'losses' });
    expect(b.extras).toEqual({ 'i18n.locale': 'fa' });
  });

  it('refuses other files', () => {
    expect(() => parseFullBackup('nope')).toThrow(FullBackupError);
    expect(() => parseFullBackup('{"format":"chess-on-the-fly/openings","version":1}')).toThrow(FullBackupError);
    expect(isFullBackup('{"format":"chess-on-the-fly/openings"}')).toBe(false);
  });
});
