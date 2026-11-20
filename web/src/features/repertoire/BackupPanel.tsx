import { useEffect, useState } from 'react';
import { BackupError, makeBackup, parseBackup } from '../../core/repertoire/backup';
import { getLocale, t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { backupStore, repertoireStore, trainStore } from '../../storage/db';
import { getPref, setPref } from '../../storage/prefs';
import { downloadText } from '../analysis/export';

/** Days after which a backup counts as old. */
const REMIND_DAYS = 7;

/** Backup of all repertoires and training progress as one JSON file: download and restore. */
export function BackupPanel({ onRestored }: { onRestored: () => void }) {
  useT();
  const [last, setLast] = useState(() => getPref('lastBackup'));
  const [hasProgress, setHasProgress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  // When the panel opened: enough to judge whether the last backup is old.
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    void trainStore.count().then((n) => setHasProgress(n > 0));
  }, [status]);

  const age = last ? (openedAt - Date.parse(last)) / 86_400_000 : Infinity;
  const remind = hasProgress && age > REMIND_DAYS;

  const download = async () => {
    setBusy(true);
    try {
      const data = await backupStore.read();
      const now = new Date();
      downloadText(`chess-on-the-fly-openings-${now.toISOString().slice(0, 10)}.json`, makeBackup(data, now), 'application/json');
      setPref('lastBackup', now.toISOString());
      setLast(now.toISOString());
      setStatus({ text: t('backup.saved', { reps: data.repertoires.length, cards: data.trainCards.length }) });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: File) => {
    setStatus(null);
    let backup;
    try {
      backup = parseBackup(await file.text());
    } catch (e) {
      setStatus({ text: t(`backup.error.${e instanceof BackupError ? e.code : 'json'}`), error: true });
      return;
    }
    const existing = new Set((await repertoireStore.list()).map((r) => r.id));
    const replaced = backup.repertoires.filter((r) => existing.has(r.id)).length;
    const question = tn('backup.confirm', backup.repertoires.length) + (replaced ? ` ${tn('backup.confirmReplace', replaced)}` : '');
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      await backupStore.restore(backup);
      setStatus({ text: t('backup.restored', { reps: backup.repertoires.length, cards: backup.trainCards.length, answers: backup.trainLog.length }) });
      onRestored();
    } catch (e) {
      setStatus({ text: t('import.failed', { reason: (e as Error).message }), error: true });
    } finally {
      setBusy(false);
    }
  };

  const lastText = last ? new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(last)) : null;

  return (
    <section className="panel stack" aria-labelledby="backup-title" style={{ gap: 8 }}>
      <h2 id="backup-title" style={{ margin: 0 }}>
        {t('backup.title')}
      </h2>
      <p className={`small ${remind ? 'warn' : 'muted'}`} style={{ margin: 0 }}>
        {lastText ? t('backup.last', { date: lastText }) : t('backup.never')} {remind && t('backup.remind')}
      </p>
      <div className="row">
        <button type="button" className={remind ? 'primary' : undefined} disabled={busy} onClick={() => void download()}>
          {t('backup.download')}
        </button>
        <label className="button-link file-button">
          {t('backup.restore')}
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void restore(f);
            }}
          />
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t('backup.help')}
      </p>
      {status && (
        <p className={`small ${status.error ? 'error' : ''}`} style={{ margin: 0 }} aria-live="polite">
          {status.text}
        </p>
      )}
    </section>
  );
}
