import { useSyncExternalStore } from 'react';
import { getLocale, LOCALES, onLocaleChange, setLocale, t, tn } from './index';

/** Re-renders the component when the language changes. Returns the current locale code. */
export function useLocale(): string {
  return useSyncExternalStore(onLocaleChange, getLocale, getLocale);
}

/** `t` and `tn`, with the component re-rendering on a language change. */
export function useT(): { t: typeof t; tn: typeof tn; locale: string } {
  const locale = useLocale();
  return { t, tn, locale };
}

/** Small language menu. The choice is remembered in this browser. */
export function LanguageSelect({ className }: { className?: string }) {
  const locale = useLocale();
  if (LOCALES.length < 2) return null;
  return (
    <select
      className={className}
      aria-label={t('i18n.language')}
      value={locale}
      onChange={(e) => setLocale(e.target.value, true)}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
