import { t } from '../../i18n';
import { ImportError, ProviderHttpClient, type FetchLike } from './http';
import { LICHESS_ORIGIN } from './lichess';

export type StudyRef = { studyId: string; chapterId?: string };

const ID = '[A-Za-z0-9]{8}';
const STUDY_PATH = new RegExp(`^(?:https?://)?(?:www\\.)?lichess\\.org/study/(${ID})(?:/(${ID}))?(?:[/?#].*)?$`);
const BARE_ID = new RegExp(`^(${ID})$`);

/**
 * A Lichess study or chapter from a URL (`lichess.org/study/{id}` or `…/study/{id}/{chapterId}`,
 * with or without scheme, `www.`, a query or a `#ply` anchor) or a bare 8-character study ID.
 */
export function parseStudyUrl(input: string): StudyRef | null {
  const s = input.trim();
  const m = STUDY_PATH.exec(s);
  if (m) return m[2] ? { studyId: m[1]!, chapterId: m[2] } : { studyId: m[1]! };
  const b = BARE_ID.exec(s);
  return b ? { studyId: b[1]! } : null;
}

export const studyUrl = (r: StudyRef) => `${LICHESS_ORIGIN}/study/${r.studyId}${r.chapterId ? `/${r.chapterId}` : ''}`;

/** The study and chapter IDs in a chapter's [ChapterURL] (or [Site]) header. */
export function chapterRefFromHeaders(h: Record<string, string>): Required<StudyRef> | null {
  for (const v of [h.ChapterURL, h.Site]) {
    const r = v ? parseStudyUrl(v) : null;
    if (r?.chapterId) return { studyId: r.studyId, chapterId: r.chapterId };
  }
  return null;
}

export class LichessStudyClient {
  private http: ProviderHttpClient;
  constructor(opts: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}) {
    // Same rules as the game client: one request at a time; on 429 wait a full minute.
    this.http = new ProviderHttpClient('Lichess', { fetch: opts.fetch, sleep: opts.sleep, rateLimitBackoffMs: 60_000, maxRetries: 1 });
  }

  /** PGN of a whole study or one chapter, with comments, variations and orientation, without clocks. */
  async pgn(ref: StudyRef, signal?: AbortSignal): Promise<string> {
    const params = new URLSearchParams({ comments: 'true', variations: 'true', clocks: 'false', orientation: 'true' });
    const path = ref.chapterId ? `${ref.studyId}/${ref.chapterId}` : ref.studyId;
    try {
      return await this.http.getText(`${LICHESS_ORIGIN}/api/study/${path}.pgn?${params}`, 'application/x-chess-pgn', signal);
    } catch (e) {
      if (e instanceof ImportError && e.kind === 'not-found') {
        throw new ImportError('not-found', t('repertoire.study.notFound'), e.status);
      }
      throw e;
    }
  }
}
