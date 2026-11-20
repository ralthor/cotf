import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { getPref, setPref } from '../../storage/prefs';
import { ChapterView } from './ChapterView';
import { RepertoireImport } from './RepertoireImport';
import { RepertoireList } from './RepertoireList';
import { TrainerView } from './TrainerView';
import { useRepertoires } from './useRepertoires';

/** The Openings tab: repertoires and their chapters on the left, the open chapter on the right. */
export function OpeningsView() {
  useT();
  const reps = useRepertoires();
  const [chapterId, setChapterIdState] = useState<string | null>(() => getPref('openChapter'));
  const setChapterId = (id: string | null) => {
    setChapterIdState(id);
    setPref('openChapter', id);
  };
  const [view, setViewState] = useState<'browse' | 'train'>(() => (getPref('openingsView') === 'train' ? 'train' : 'browse'));
  const setView = (v: 'browse' | 'train') => {
    setViewState(v);
    setPref('openingsView', v);
  };
  // Phones: the lists fold into a panel above the board (null = automatic).
  const [listOpen, setListOpen] = useState<boolean | null>(null);
  const chapterCol = useRef<HTMLDivElement>(null);

  // The remembered chapter, or the first one of the selected repertoire.
  const chapter = reps.chapters.find((c) => c.id === chapterId) ?? reps.chapters[0] ?? null;

  const openChapter = (id: string) => {
    setChapterId(id);
    setView('browse');
    setListOpen(false);
    requestAnimationFrame(() => {
      const el = chapterCol.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const showList = listOpen ?? !chapter;

  return (
    <div className="layout openings">
      <button type="button" className="games-toggle" aria-expanded={showList} aria-controls="openings-panel" onClick={() => setListOpen(!showList)}>
        <span className="games-toggle-title">
          <strong>{chapter ? <bdi>{chapter.title}</bdi> : t('repertoire.noChapter')}</strong>
          {reps.selected && (
            <span className="meta">
              <bdi>{reps.selected.name}</bdi> · {tn('repertoire.chapters', reps.chapters.length)}
            </span>
          )}
        </span>
        <span className="games-toggle-label">
          {t('repertoire.toggle')} <Icon name="chevronDown" size={16} />
        </span>
      </button>
      <div className="stack games-col" id="openings-panel" data-open={showList ? '' : undefined}>
        <RepertoireList
          repertoires={reps.repertoires}
          selected={reps.selected}
          chapters={reps.chapters}
          chapterId={chapter?.id ?? null}
          persisted={reps.persisted}
          onSelect={reps.select}
          onOpenChapter={openChapter}
          onCreate={reps.create}
          onRename={reps.rename}
          onRemove={reps.remove}
          onSaveChapters={reps.saveChapters}
          onRefresh={(id) => reps.refreshStudies(id)}
        />
        <RepertoireImport repertoires={reps.repertoires} selectedId={reps.selected?.id ?? null} onImport={reps.importPgn} />
      </div>
      <div className="game-col" ref={chapterCol}>
        {reps.repertoires.length > 0 && (
          <div className="tabs openings-tabs" role="tablist" aria-label={t('nav.openings')}>
            {(['browse', 'train'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
                {t(`openings.${v}`)}
              </button>
            ))}
          </div>
        )}
        {view === 'train' && reps.repertoires.length > 0 ? (
          <TrainerView repertoire={reps.selected} chapters={reps.chapters} />
        ) : chapter ? (
          <ChapterView key={`${chapter.id}|${chapter.importedAt}`} chapter={chapter} />
        ) : (
          <div className="panel">
            <p>{reps.repertoires.length ? t('repertoire.selectChapter') : t('repertoire.intro')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
