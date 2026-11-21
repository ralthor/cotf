import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { getPref, setPref } from '../../storage/prefs';
import { ChapterView } from './ChapterView';
import { RepertoireImport } from './RepertoireImport';
import { RepertoireList } from './RepertoireList';
import { BackupPanel } from './BackupPanel';
import { GamesView } from './GamesView';
import { InsightsView } from './InsightsView';
import { ProgressView } from './ProgressView';
import { TrainerView } from './TrainerView';
import { useRepertoires } from './useRepertoires';
import type { Side } from '../../core/repertoire/types';

type View = 'browse' | 'train' | 'progress' | 'games' | 'insights';

/** The Openings tab: repertoires and their chapters on the left, the open chapter on the right. */
export function OpeningsView() {
  useT();
  const reps = useRepertoires();
  const [chapterId, setChapterIdState] = useState<string | null>(() => getPref('openChapter'));
  const setChapterId = (id: string | null) => {
    setChapterIdState(id);
    setPref('openChapter', id);
  };
  const [view, setViewState] = useState<View>(() => {
    const saved = getPref('openingsView');
    return saved === 'train' || saved === 'progress' || saved === 'games' || saved === 'insights' ? saved : 'browse';
  });
  // Bumped after a restore, so the training views read their data again.
  const [dataVersion, setDataVersion] = useState(0);
  const setView = (v: View) => {
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

  // "My fixes": the repertoire the Improve sub-tab adds better moves to, for training.
  const fixesRep = reps.repertoires.find((r) => r.id === getPref('fixesRepertoire')) ?? null;
  const addFix = async (pgn: string, colour: Side) => {
    const res = await reps.importPgn(pgn, { kind: 'pgn-paste' }, fixesRep ? { repertoireId: fixesRep.id } : { newName: t('fixes.repName') }, colour);
    if (res.repertoire.id) setPref('fixesRepertoire', res.repertoire.id);
  };
  const practiseFixes = () => {
    const id = getPref('fixesRepertoire');
    if (id) reps.select(id);
    setView('train');
  };

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
        {reps.repertoires.length > 0 && (
          <BackupPanel
            onRestored={() => {
              void reps.reloadAll();
              setDataVersion((v) => v + 1);
            }}
          />
        )}
        <RepertoireImport repertoires={reps.repertoires} selectedId={reps.selected?.id ?? null} onImport={reps.importPgn} />
      </div>
      <div className="game-col" ref={chapterCol}>
        {reps.loaded && (
          <div className="tabs openings-tabs" role="tablist" aria-label={t('nav.openings')}>
            {(['browse', 'train', 'progress', 'games', 'insights'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
                {t(`openings.${v}`)}
              </button>
            ))}
          </div>
        )}
        {view === 'insights' ? (
          <InsightsView key={dataVersion} onFetch={() => setView('games')} onAddFix={addFix} onPractise={practiseFixes} hasFixes={!!fixesRep} />
        ) : view === 'games' ? (
          <GamesView key={dataVersion} repertoire={reps.selected} chapters={reps.chapters} onImport={reps.importPgn} />
        ) : view === 'train' && reps.repertoires.length > 0 ? (
          <TrainerView key={dataVersion} repertoire={reps.selected} chapters={reps.chapters} />
        ) : view === 'progress' && reps.repertoires.length > 0 ? (
          <ProgressView key={dataVersion} repertoire={reps.selected} chapters={reps.chapters} />
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
