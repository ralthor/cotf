/**
 * Small per-browser preferences in localStorage (no server, no expiry).
 * Every access is guarded: storage can be blocked or unavailable (private mode, policies).
 */
const PREFIX = 'chess-analyser:';

export type PrefKey = 'chesscomUsername' | 'lichessUsername' | 'importTab' | 'chesscomMonths' | 'alwaysShowBest';

export function getPref(key: PrefKey): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function setPref(key: PrefKey, value: string | null): void {
  try {
    if (value === null || value === '') localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage unavailable: the preference simply won't be remembered.
  }
}
