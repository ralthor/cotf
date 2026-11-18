import { afterEach, describe, expect, it } from 'vitest';
import { FALLBACK_LOCALE, LOCALES, matchLocale, setLocale, t, tn, tOr } from './index';

const files = import.meta.glob<Record<string, string>>('./locales/*.json', { eager: true, import: 'default' });
const dicts = Object.fromEntries(Object.entries(files).map(([p, d]) => [/([^/]+)\.json$/.exec(p)![1]!, d]));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => setLocale(FALLBACK_LOCALE));

  it('has English and Persian, English first', () => {
    expect(LOCALES.map((l) => l.code)).toEqual(['en', 'fa']);
    expect(LOCALES.find((l) => l.code === 'fa')?.dir).toBe('rtl');
  });

  it('every language has the same keys and placeholders as English', () => {
    const en = dicts.en!;
    for (const [code, d] of Object.entries(dicts)) {
      expect(Object.keys(d).filter((k) => !(k in en)), `${code}: extra keys`).toEqual([]);
      expect(Object.keys(en).filter((k) => !(k in d)), `${code}: missing keys`).toEqual([]);
      for (const k of Object.keys(en)) expect(placeholders(d[k]!), `${code}: ${k}`).toEqual(placeholders(en[k]!));
    }
  });

  it('fills placeholders and picks plurals', () => {
    expect(t('app.games', { n: 3 })).toBe('Games (3)');
    expect(tn('app.plies', 1)).toBe('1 ply');
    expect(tn('app.plies', 2)).toBe('2 plies');
  });

  it('switches language and falls back to English, then the key', () => {
    setLocale('fa');
    expect(t('nav.analyse')).toBe('تحلیل');
    expect(t('no.such.key')).toBe('no.such.key');
    expect(tOr('no.such.key', 'raw')).toBe('raw');
    setLocale('xx');
    expect(t('nav.analyse')).toBe('Analyse');
  });

  it('matches browser and Telegram language codes', () => {
    expect(matchLocale(['fa-IR'])).toBe('fa');
    expect(matchLocale([null, 'de', 'en-GB'])).toBe('en');
    expect(matchLocale(['de'])).toBe('en');
  });
});
