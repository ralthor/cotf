/**
 * Small per-browser preferences in localStorage (no server, no expiry).
 * Every access is guarded: storage can be blocked or unavailable (private mode, policies).
 */
const PREFIX = 'chess-analyser:';

export type PrefKey = 'chesscomUsername' | 'lichessUsername' | 'importTab' | 'chesscomMonths' | 'alwaysShowBest' | 'engineOn' | 'repImportTab' | 'openRepertoire' | 'openChapter' | 'openingsView' | 'trainSide' | 'trainNoHints' | 'lastBackup' | 'lichessToken' | 'explorerOpen' | 'explorerDb' | 'trainQuestions' | 'insightsFilters' | 'insightsDb' | 'yourGamesOpen' | 'insightsHidden' | 'fixesRepertoire' | 'insightsList' | 'lossSource' | 'lossDepth' | 'lossView';

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

/** Every preference this app keeps, by key (for the full backup). */
export function allPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = localStorage.getItem(k) ?? '';
    }
  } catch {
    // Storage unavailable: nothing to export.
  }
  return out;
}

/** Replaces every preference with `prefs`, leaving the keys in `keep` as they are. */
export function replacePrefs(prefs: Record<string, string>, keep: readonly PrefKey[]): void {
  const kept = new Set(keep.map((k) => PREFIX + k));
  try {
    const old: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && !kept.has(k)) old.push(k);
    }
    for (const k of old) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(prefs)) if (!kept.has(PREFIX + k)) localStorage.setItem(PREFIX + k, v);
  } catch {
    // Storage unavailable: preferences are not restored.
  }
}
