import { useState } from 'react';
import { chapterToPgn, repertoireToPgn } from '../../core/repertoire/export';
import type { ParseWarning } from '../../core/repertoire/parse';
import type { Chapter, Repertoire, Side } from '../../core/repertoire/types';
import { t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { downloadText, safeFilename } from '../analysis/export';
import { ImportError } from '../import/http';
import { warningText } from './RepertoireImport';

export type RepertoireListProps = {
  repertoires: Repertoire[];
  selected: Repertoire | null;
  chapters: Chapter[];
  chapterId: string | null;
  persisted: boolean | null;
  onSelect: (id: string) => void;
  onOpenChapter: (id: string) => void;
  onCreate: (name: string) => Promise<Repertoire>;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSaveChapters: (repertoireId: string, chapters: Chapter[]) => Promise<void>;
  onRefresh: (repertoireId: string) => Promise<{ added: number; updated: number; warnings: ParseWarning[] }>;
};

export const sideLabel = (s: Side) => t(s === 'w' ? 'repertoire.white' : 'repertoire.black');

export function RepertoireList(props: RepertoireListProps) {
  const { repertoires, selected, chapters, chapterId, persisted, onSelect, onOpenChapter } = props;
  useT();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasStudies = chapters.some((c) => c.source.kind === 'lichess-study');

  const removeRepertoire = async (r: Repertoire) => {
    if (!window.confirm(t('repertoire.confirmRemove', { name: r.name }))) return;
    await props.onRemove(r.id);
  };

  const removeChapter = async (c: Chapter) => {
    if (!selected || !window.confirm(t('repertoire.chapter.confirmRemove', { name: c.title }))) return;
    await props.onSaveChapters(selected.id, chapters.filter((x) => x.id !== c.id));
  };

  const setSide = async (c: Chapter, side: Side) => {
    if (!selected) return;
    await props.onSaveChapters(selected.id, chapters.map((x) => (x.id === c.id ? { ...x, side } : x)));
  };

  const refresh = async () => {
    if (!selected) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await props.onRefresh(selected.id);
      const parts = [t('repertoire.refresh.done', { added: r.added, updated: r.updated }), ...r.warnings.map(warningText)];
      setStatus({ text: parts.join(' '), error: false });
    } catch (e) {
      setStatus({ text: e instanceof ImportError ? e.message : (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="rep-list-title">
      <h2 id="rep-list-title" className="sr-only">{t('repertoire.list.title', { n: repertoires.length })}</h2>
      {renaming && selected ? (
        <form
          className="row rep-rename"
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get('name');
            void props.onRename(selected.id, String(name ?? '')).then(() => setRenaming(null));
          }}
        >
          <input name="name" defaultValue={selected.name} aria-label={t('repertoire.name')} autoFocus />
          <button type="submit" className="small">{t('repertoire.save')}</button>
          <button type="button" className="link small" onClick={() => setRenaming(null)}>
            {t('common.cancel')}
          </button>
        </form>
      ) : (
        <div className="row rep-picker">
          {repertoires.length > 0 ? (
            <label className="row rep-select">
              <span className="small">{t('repertoire.picker')}</span>
              <select value={selected?.id ?? ''} onChange={(e) => onSelect(e.target.value)}>
                {repertoires.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="small muted" style={{ flex: 1, margin: 0 }}>{t('repertoire.list.empty')}</p>
          )}
          {selected && (
            <>
              <button type="button" className="link small" onClick={() => setRenaming(selected.id)} aria-label={t('repertoire.renameNamed', { name: selected.name })}>
                {t('repertoire.rename')}
              </button>
              <button type="button" className="link small danger" aria-label={t('repertoire.removeNamed', { name: selected.name })} title={t('repertoire.removeNamed', { name: selected.name })} onClick={() => void removeRepertoire(selected)}>
                ✕
              </button>
            </>
          )}
          <button
            type="button"
            className="small"
            title={t('repertoire.new')}
            onClick={() => {
              const name = window.prompt(t('repertoire.name'), t('repertoire.defaultName'));
              if (name?.trim()) void props.onCreate(name).then((r) => onSelect(r.id));
            }}
          >
            + {t('repertoire.newShort')}
          </button>
        </div>
      )}

      {selected && (
        <>
          <h3>{tn('repertoire.chapters', chapters.length)}</h3>
          {chapters.length === 0 ? (
            <p className="small muted">{t('repertoire.chapters.empty')}</p>
          ) : (
            <ul className="game-list chapter-list">
              {chapters.map((c) => (
                <li key={c.id} className="row" style={{ flexWrap: 'nowrap' }}>
                  <button type="button" style={{ flex: 1, minWidth: 0 }} aria-current={c.id === chapterId ? 'true' : undefined} onClick={() => onOpenChapter(c.id)}>
                    <bdi>{c.title}</bdi>
                    <div className="meta">
                      {sideLabel(c.side)} · {t(`repertoire.source.${c.source.kind}`)}
                    </div>
                  </button>
                  <select
                    className="small side-select"
                    value={c.side}
                    aria-label={t('repertoire.chapter.side', { name: c.title })}
                    onChange={(e) => void setSide(c, e.target.value as Side)}
                  >
                    <option value="w">{t('repertoire.white')}</option>
                    <option value="b">{t('repertoire.black')}</option>
                  </select>
                  <button
                    type="button"
                    className="link small"
                    aria-label={t('repertoire.chapter.exportNamed', { name: c.title })}
                    title={t('repertoire.chapter.export')}
                    onClick={() => downloadText(`${safeFilename(c.title)}.pgn`, chapterToPgn(c), 'application/x-chess-pgn')}
                  >
                    PGN
                  </button>
                  <button type="button" className="link small remove-game" aria-label={t('repertoire.chapter.removeNamed', { name: c.title })} onClick={() => void removeChapter(c)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="small"
              disabled={chapters.length === 0}
              onClick={() => downloadText(`${safeFilename(selected.name)}.pgn`, repertoireToPgn(chapters), 'application/x-chess-pgn')}
            >
              {t('repertoire.export')}
            </button>
            {hasStudies && (
              <button type="button" className="small" disabled={busy} onClick={() => void refresh()}>
                {busy ? t('common.loading') : t('repertoire.refresh')}
              </button>
            )}
          </div>
          {status && (
            <p className={status.error ? 'small error' : 'small'} aria-live="polite">
              {status.text}
            </p>
          )}
        </>
      )}
      {repertoires.length > 0 && persisted !== null && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          {t(persisted ? 'repertoire.storage.kept' : 'repertoire.storage.mayClear')}
        </p>
      )}
    </section>
  );
}
