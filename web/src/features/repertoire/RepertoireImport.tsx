import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { REPERTOIRE_PGN_LIMITS, type ParseWarning } from '../../core/repertoire/parse';
import type { Repertoire, Side } from '../../core/repertoire/types';
import { t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { getPref, setPref } from '../../storage/prefs';
import { ImportError } from '../import/http';
import { parseStudyUrl } from '../import/lichessStudy';
import { studyClient, type ImportOrigin, type ImportSummary, type ImportTarget } from './useRepertoires';

type Tab = 'file' | 'paste' | 'study';
const NEW = '__new__';

export type RepertoireImportProps = {
  repertoires: Repertoire[];
  selectedId: string | null;
  onImport: (pgn: string, origin: ImportOrigin, target: ImportTarget, defaultSide: Side) => Promise<ImportSummary>;
};

export function warningText(w: ParseWarning): string {
  return t(`repertoire.warn.${w.code}`, { game: w.game, ...w.vars });
}

function describeError(e: unknown): string {
  if (e instanceof ImportError) return e.message;
  if ((e as Error).name === 'AbortError') return t('import.cancelled');
  return t('import.failed', { reason: (e as Error).message });
}

export function RepertoireImport({ repertoires, selectedId, onImport }: RepertoireImportProps) {
  useT();
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = getPref('repImportTab');
    return saved === 'file' || saved === 'paste' || saved === 'study' ? saved : 'study';
  });
  const setTab = (next: Tab) => {
    setTabState(next);
    setPref('repImportTab', next);
  };
  // null: follow the repertoire open in the list.
  const [target, setTarget] = useState<string | null>(null);
  const wanted = target ?? selectedId ?? NEW;
  const effectiveTarget = wanted === NEW || repertoires.some((r) => r.id === wanted) ? wanted : NEW;
  const [newName, setNewName] = useState('');
  const [side, setSide] = useState<Side>('w');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: string | null; problems: string[] } | null>(null);
  // Folded once there is a repertoire, unless the user opened it (null = automatic).
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? repertoires.length === 0;

  const run = async (pgn: string, origin: ImportOrigin, suggestedName: string) => {
    setBusy(true);
    setResult(null);
    try {
      const to: ImportTarget = effectiveTarget === NEW ? { newName: newName.trim() || suggestedName } : { repertoireId: effectiveTarget };
      const s = await onImport(pgn, origin, to, side);
      const problems = s.warnings.map(warningText);
      if (s.added + s.updated === 0) {
        setResult({ ok: null, problems: [t('repertoire.import.nothing'), ...problems] });
        return;
      }
      setResult({
        ok:
          tn('repertoire.import.added', s.added, { name: s.repertoire.name }) +
          (s.updated ? ` ${tn('repertoire.import.updated', s.updated)}` : ''),
        problems,
      });
      setTarget(null);
      setNewName('');
      if (origin.kind === 'pgn-paste') setText('');
      if (origin.kind === 'lichess-study') setUrl('');
    } catch (e) {
      setResult({ ok: null, problems: [describeError(e)] });
    } finally {
      setBusy(false);
    }
  };

  const importStudy = async () => {
    const ref = parseStudyUrl(url);
    if (!ref) return setResult({ ok: null, problems: [t('repertoire.study.badUrl')] });
    setBusy(true);
    setResult(null);
    let pgn: string;
    try {
      pgn = await studyClient.pgn(ref);
    } catch (e) {
      setBusy(false);
      return setResult({ ok: null, problems: [describeError(e)] });
    }
    const studyName = /\[StudyName "([^"]*)"\]/.exec(pgn)?.[1] ?? '';
    await run(pgn, { kind: 'lichess-study', ref }, studyName || t('repertoire.defaultName'));
  };

  return (
    <section className="panel" aria-labelledby="rep-import-title">
      <h2 id="rep-import-title" style={isOpen ? undefined : { margin: 0 }}>
        <button type="button" className="fold-toggle" aria-expanded={isOpen} aria-controls="rep-import-body" onClick={() => setOpen(!isOpen)}>
          {t('repertoire.import.title')} <Icon name="chevronDown" size={16} />
        </button>
      </h2>
      {isOpen && (
      <div id="rep-import-body">
      <div className="tabs" role="tablist">
        {(['study', 'file', 'paste'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(`repertoire.import.tab.${k}`)}
          </button>
        ))}
      </div>
      <div className="stack">
        <div className="stack rep-import-options">
          <label className="row small">
            {t('repertoire.import.into')}
            <select value={effectiveTarget} onChange={(e) => setTarget(e.target.value)}>
              {repertoires.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              <option value={NEW}>{t('repertoire.import.newRepertoire')}</option>
            </select>
          </label>
          {effectiveTarget === NEW && (
            <label className="row small">
              <span className="sr-only">{t('repertoire.name')}</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('repertoire.import.namePlaceholder')} />
            </label>
          )}
          <fieldset className="row small side-choice">
            <legend className="small">{t('repertoire.import.side')}</legend>
            {(['w', 'b'] as const).map((s) => (
              <label key={s} className="row">
                <input type="radio" name="rep-side" checked={side === s} onChange={() => setSide(s)} />
                {t(s === 'w' ? 'repertoire.white' : 'repertoire.black')}
              </label>
            ))}
          </fieldset>
        </div>

        {tab === 'study' && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void importStudy();
            }}
          >
            <label className="stack small">
              {t('repertoire.study.label')}
              <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://lichess.org/study/…" autoComplete="off" spellCheck={false} />
            </label>
            <p className="small muted">{t('repertoire.study.help')}</p>
            <div className="row">
              <button type="submit" className="primary" disabled={busy || !url.trim()}>
                {busy ? t('common.loading') : t('repertoire.import.button')}
              </button>
            </div>
          </form>
        )}
        {tab === 'paste' && (
          <div className="stack">
            <label className="stack small">
              {t('repertoire.paste.label')}
              <textarea dir="ltr" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1. e4 e5 2. Nf3 (2. Bc4) Nc6 { Main idea… } *'} />
            </label>
            <div className="row">
              <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void run(text, { kind: 'pgn-paste' }, t('repertoire.defaultName'))}>
                {t('repertoire.import.button')}
              </button>
            </div>
          </div>
        )}
        {tab === 'file' && (
          <label className="stack small">
            {t('repertoire.file.label')}
            <input
              type="file"
              accept=".pgn,application/x-chess-pgn,text/plain"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > REPERTOIRE_PGN_LIMITS.maxBytes) return setResult({ ok: null, problems: [t('import.pgn.tooLarge')] });
                await run(await f.text(), { kind: 'pgn-file', fileName: f.name }, f.name.replace(/\.pgn$/i, ''));
              }}
            />
          </label>
        )}
        {result && (
          <ul className="small" aria-live="polite">
            {result.ok && <li>{result.ok}</li>}
            {result.problems.map((m, i) => (
              <li key={i} className="error">
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
      )}
    </section>
  );
}
