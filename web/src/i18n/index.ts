/**
 * Localization. Self-contained: it imports nothing from the app, and the app only uses
 * `t()` and the locale helpers below. Texts live in `locales/<code>.json`, one flat file
 * per language: `{ "key": "translated text" }`. To add a language, drop a new JSON file
 * there (copy `en.json`); it is picked up automatically.
 *
 * - `{name}` in a text is replaced by `vars.name`.
 * - Plurals: keys ending in `.one` and `.other`, used through `tn()`.
 * - `_meta.name` is the language's own name (for the menu), `_meta.dir` is `ltr` or `rtl`.
 * - A key missing in a language falls back to English, then to the key itself.
 */
type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;

const files = import.meta.glob<Dict>('./locales/*.json', { eager: true, import: 'default' });

const dicts: Record<string, Dict> = {};
for (const [path, dict] of Object.entries(files)) {
  const code = /([^/]+)\.json$/.exec(path)?.[1];
  if (code) dicts[code] = dict;
}

export const FALLBACK_LOCALE = 'en';
const STORAGE_KEY = 'i18n.locale';

export type LocaleInfo = { code: string; name: string; dir: 'ltr' | 'rtl' };

export const LOCALES: LocaleInfo[] = Object.keys(dicts)
  .sort((a, b) => (a === FALLBACK_LOCALE ? -1 : b === FALLBACK_LOCALE ? 1 : a.localeCompare(b)))
  .map((code) => ({
    code,
    name: dicts[code]!['_meta.name'] ?? code,
    dir: dicts[code]!['_meta.dir'] === 'rtl' ? 'rtl' : 'ltr',
  }));

let current = FALLBACK_LOCALE;
const listeners = new Set<() => void>();

/** First-strong isolate … pop directional isolate (Unicode bidi controls). */
const FSI = '⁨';
const PDI = '⁩';

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  // In right-to-left languages each filled-in value is isolated, so chess moves and evals such as
  // "Qxe4+" or "-0.50 → -6.49" keep their own order instead of being reordered by the sentence
  // around them. A value in Persian still reads right to left (FSI follows its first letter).
  const isolate = localeInfo(current).dir === 'rtl';
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (!(name in vars)) return m;
    const value = String(vars[name]);
    return isolate && value !== '' ? FSI + value + PDI : value;
  });
}

/** Translated text for `key`, with `{name}` placeholders filled from `vars`. */
export function t(key: string, vars?: Vars): string {
  const text = dicts[current]?.[key] ?? dicts[FALLBACK_LOCALE]?.[key] ?? key;
  return interpolate(text, vars);
}

/** Like `t`, but returns `fallback` when no language has the key (for values from servers). */
export function tOr(key: string, fallback: string, vars?: Vars): string {
  const text = dicts[current]?.[key] ?? dicts[FALLBACK_LOCALE]?.[key];
  return text === undefined ? fallback : interpolate(text, vars);
}

/** Plural form: `key.one` when n is 1, else `key.other`. `{n}` is filled in. */
export function tn(key: string, n: number, vars?: Vars): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars });
}

export const getLocale = (): string => current;

export const localeInfo = (code: string = current): LocaleInfo =>
  LOCALES.find((l) => l.code === code) ?? { code, name: code, dir: 'ltr' };

/** The first supported locale among `candidates` ("fa-IR" matches "fa"), else English. */
export function matchLocale(candidates: readonly (string | null | undefined)[]): string {
  for (const c of candidates) {
    if (!c) continue;
    const lower = c.toLowerCase();
    if (dicts[lower]) return lower;
    const base = lower.split(/[-_]/)[0]!;
    if (dicts[base]) return base;
  }
  return FALLBACK_LOCALE;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Switches language, updates `<html lang dir>` and tells subscribers. `remember` keeps it for next visits. */
export function setLocale(code: string, remember = false): void {
  const next = dicts[code] ? code : FALLBACK_LOCALE;
  if (remember) {
    try {
      storage()?.setItem(STORAGE_KEY, next);
    } catch {
      // private mode: not remembered, still applied
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dir = localeInfo(next).dir;
  }
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn();
}

/** Picks the saved choice, else the first match in `hints` (e.g. a Telegram language), else the browser's. */
export function initLocale(hints: readonly (string | null | undefined)[] = []): string {
  let saved: string | null;
  try {
    saved = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    saved = null;
  }
  const browser = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language];
  setLocale(matchLocale([saved, ...hints, ...browser]));
  return current;
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
