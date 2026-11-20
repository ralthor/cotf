import { useCallback, useEffect, useState } from 'react';
import { parseRepertoirePgn, type ParsedChapter, type ParseWarning } from '../../core/repertoire/parse';
import type { Chapter, ChapterSource, Repertoire, Side } from '../../core/repertoire/types';
import { repertoireStore } from '../../storage/db';
import { getPref, setPref } from '../../storage/prefs';
import { chapterRefFromHeaders, LichessStudyClient, studyUrl, type StudyRef } from '../import/lichessStudy';

export const studyClient = new LichessStudyClient();
const NO_CHAPTERS: Chapter[] = [];

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Where imported chapters go: an existing repertoire, or a new one with this name. */
export type ImportTarget = { repertoireId: string } | { newName: string };

export type ImportOrigin = { kind: 'pgn-file'; fileName: string } | { kind: 'pgn-paste' } | { kind: 'lichess-study'; ref: StudyRef };

export type ImportSummary = { repertoire: Repertoire; added: number; updated: number; warnings: ParseWarning[] };

/** Chapter id and source for a parsed chapter: Lichess chapters keep their chapter id, so re-imports replace them. */
function identify(p: ParsedChapter, origin: ImportOrigin): { id: string; source: ChapterSource } {
  if (origin.kind === 'lichess-study') {
    const ref = chapterRefFromHeaders(p.headers) ?? (origin.ref.chapterId ? { studyId: origin.ref.studyId, chapterId: origin.ref.chapterId } : null);
    if (ref) {
      return {
        id: `lichess:${ref.studyId}:${ref.chapterId}`,
        source: {
          kind: 'lichess-study',
          studyId: ref.studyId,
          chapterId: ref.chapterId,
          studyName: p.headers.StudyName,
          url: studyUrl(ref),
          wholeStudy: !origin.ref.chapterId,
        },
      };
    }
  }
  return { id: newId(), source: origin.kind === 'lichess-study' ? { kind: 'pgn-paste' } : origin };
}

/**
 * Merges parsed chapters into existing ones: a chapter with the same id is replaced in place
 * (keeping its order and the side the user chose), new ones are added at the end.
 */
export function mergeChapters(
  repertoireId: string,
  existing: readonly Chapter[],
  parsed: readonly ParsedChapter[],
  origin: ImportOrigin,
  defaultSide: Side,
  now = new Date().toISOString(),
): { chapters: Chapter[]; added: number; updated: number } {
  const out = [...existing];
  let added = 0;
  let updated = 0;
  let order = existing.reduce((m, c) => Math.max(m, c.order), -1) + 1;
  for (const p of parsed) {
    const { id, source } = identify(p, origin);
    const at = out.findIndex((c) => c.id === id);
    const prev = at >= 0 ? out[at] : undefined;
    const chapter: Chapter = {
      id,
      repertoireId,
      title: p.title ?? `#${p.index}`,
      side: prev?.side ?? p.orientation ?? defaultSide,
      source,
      importedAt: now,
      headers: p.headers,
      startFen: p.startFen,
      root: p.root,
      order: prev?.order ?? order++,
    };
    if (at >= 0) {
      out[at] = chapter;
      updated++;
    } else {
      out.push(chapter);
      added++;
    }
  }
  return { chapters: out, added, updated };
}

async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

export function useRepertoires() {
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Chapters of one repertoire; only shown while that repertoire is the selected one.
  const [loadedChapters, setLoadedChapters] = useState<{ repertoireId: string; chapters: Chapter[] } | null>(null);
  const chapters = loadedChapters && loadedChapters.repertoireId === selectedId ? loadedChapters.chapters : NO_CHAPTERS;
  const setChapters = useCallback((repertoireId: string, list: Chapter[]) => setLoadedChapters({ repertoireId, chapters: list }), []);
  const [loaded, setLoaded] = useState(false);
  /** Whether the browser promised to keep this site's data (null: unknown / unsupported). */
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void repertoireStore.list().then((list) => {
      setRepertoires(list);
      const saved = getPref('openRepertoire');
      setSelectedId((id) => id ?? (list.some((r) => r.id === saved) ? saved : (list[0]?.id ?? null)));
      setLoaded(true);
    });
    try {
      void navigator.storage?.persisted?.().then(setPersisted, () => undefined);
    } catch {
      // unsupported
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    void repertoireStore.chapters(selectedId).then((c) => live && setChapters(selectedId, c));
    return () => {
      live = false;
    };
  }, [selectedId, setChapters]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setPref('openRepertoire', id);
  }, []);

  const reloadList = useCallback(async () => setRepertoires(await repertoireStore.list()), []);

  const create = useCallback(
    async (name: string): Promise<Repertoire> => {
      const now = new Date().toISOString();
      const rep: Repertoire = { id: newId(), name: name.trim() || 'Repertoire', createdAt: now, updatedAt: now };
      await repertoireStore.put(rep);
      await reloadList();
      return rep;
    },
    [reloadList],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const rep = repertoires.find((r) => r.id === id);
      if (!rep || !name.trim()) return;
      await repertoireStore.put({ ...rep, name: name.trim(), updatedAt: new Date().toISOString() });
      await reloadList();
    },
    [repertoires, reloadList],
  );

  const remove = useCallback(
    async (id: string) => {
      await repertoireStore.remove(id);
      const list = await repertoireStore.list();
      setRepertoires(list);
      if (selectedId === id) select(list[0]?.id ?? null);
    },
    [selectedId, select],
  );

  /** Saves the selected repertoire's chapters (and its derived moves). */
  const saveChapters = useCallback(async (repertoireId: string, next: Chapter[]) => {
    await repertoireStore.saveChapters(repertoireId, next);
    setChapters(repertoireId, [...next].sort((a, b) => a.order - b.order));
    await reloadList();
  }, [reloadList, setChapters]);

  /** Parses `pgn` and adds its chapters to the target repertoire. */
  const importPgn = useCallback(
    async (pgn: string, origin: ImportOrigin, target: ImportTarget, defaultSide: Side): Promise<ImportSummary> => {
      const parsed = parseRepertoirePgn(pgn);
      if (parsed.chapters.length === 0) {
        const fallback = 'repertoireId' in target ? repertoires.find((r) => r.id === target.repertoireId) : undefined;
        return { repertoire: fallback ?? { id: '', name: '', createdAt: '', updatedAt: '' }, added: 0, updated: 0, warnings: parsed.warnings };
      }
      const rep = 'repertoireId' in target ? repertoires.find((r) => r.id === target.repertoireId) : await create(target.newName);
      if (!rep) throw new Error('Repertoire not found');
      const existing = await repertoireStore.chapters(rep.id);
      const merged = mergeChapters(rep.id, existing, parsed.chapters, origin, defaultSide);
      await repertoireStore.saveChapters(rep.id, merged.chapters);
      setChapters(rep.id, await repertoireStore.chapters(rep.id));
      select(rep.id);
      await reloadList();
      const p = await requestPersistence();
      if (p !== null) setPersisted(p);
      return { repertoire: rep, added: merged.added, updated: merged.updated, warnings: parsed.warnings };
    },
    [repertoires, create, reloadList, select, setChapters],
  );

  /**
   * Fetches the repertoire's Lichess content again: whole studies (adding their new chapters)
   * when they were imported whole, otherwise just the chapters that were imported.
   */
  const refreshStudies = useCallback(
    async (repertoireId: string, signal?: AbortSignal): Promise<{ added: number; updated: number; warnings: ParseWarning[] }> => {
      let current = await repertoireStore.chapters(repertoireId);
      const refs: StudyRef[] = [];
      const whole = new Set<string>();
      for (const c of current) if (c.source.kind === 'lichess-study' && c.source.wholeStudy) whole.add(c.source.studyId);
      for (const s of whole) refs.push({ studyId: s });
      for (const c of current) {
        if (c.source.kind === 'lichess-study' && !whole.has(c.source.studyId)) refs.push({ studyId: c.source.studyId, chapterId: c.source.chapterId });
      }
      let added = 0;
      let updated = 0;
      const warnings: ParseWarning[] = [];
      for (const ref of refs) {
        const parsed = parseRepertoirePgn(await studyClient.pgn(ref, signal));
        warnings.push(...parsed.warnings);
        const m = mergeChapters(repertoireId, current, parsed.chapters, { kind: 'lichess-study', ref }, 'w');
        current = m.chapters;
        added += m.added;
        updated += m.updated;
      }
      await repertoireStore.saveChapters(repertoireId, current);
      setChapters(repertoireId, await repertoireStore.chapters(repertoireId));
      await reloadList();
      return { added, updated, warnings };
    },
    [reloadList, setChapters],
  );

  /** Reads everything again (after a restore). */
  const reloadAll = useCallback(async () => {
    const list = await repertoireStore.list();
    setRepertoires(list);
    const id = selectedId && list.some((r) => r.id === selectedId) ? selectedId : (list[0]?.id ?? null);
    select(id);
    if (id) setChapters(id, await repertoireStore.chapters(id));
  }, [selectedId, select, setChapters]);

  return {
    loaded,
    reloadAll,
    repertoires,
    selected: repertoires.find((r) => r.id === selectedId) ?? null,
    select,
    chapters,
    persisted,
    create,
    rename,
    remove,
    saveChapters,
    importPgn,
    refreshStudies,
  };
}
