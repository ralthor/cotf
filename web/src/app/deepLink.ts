import type { GameRecord } from '../core/chess/types';
import { t } from '../i18n';
import { LichessClient, lichessToGameRecord, parseLichessGameId } from '../features/import/lichess';

/**
 * Deep link: `lichess=<game id or URL>` opens that finished Lichess game for review.
 * It is read from the hash query (`#/analyse?lichess=…`, what the Telegram chess bot
 * links to) and from the real query string (`/?lichess=…`, the older link form). GitHub
 * Pages serves the same index.html for any query, so both reach the app.
 */
export type DeepLink = { kind: 'lichess'; id: string } | { kind: 'invalid'; value: string };

const PARAM = 'lichess';

function hashQuery(hash: string): URLSearchParams {
  const q = hash.indexOf('?');
  return new URLSearchParams(q < 0 ? '' : hash.slice(q + 1));
}

export function readDeepLink(
  search: string = window.location.search,
  hash: string = window.location.hash,
): DeepLink | null {
  // The hash wins when both are set: it's the current link form.
  const value = (hashQuery(hash).get(PARAM) ?? new URLSearchParams(search).get(PARAM) ?? '').trim();
  if (!value) return null;
  // Unlike the import box, a bare id is unambiguous here: the parameter says it's a game.
  const id = parseLichessGameId(value);
  return id ? { kind: 'lichess', id } : { kind: 'invalid', value };
}

/** The address with the deep-link parameter removed from both the query and the hash. */
export function addressWithoutDeepLink(pathname: string, search: string, hash: string): string {
  const s = new URLSearchParams(search);
  s.delete(PARAM);
  const hq = hashQuery(hash);
  hq.delete(PARAM);
  const q = hash.indexOf('?');
  const route = q < 0 ? hash : hash.slice(0, q);
  const ss = s.toString();
  const hs = hq.toString();
  return `${pathname}${ss ? `?${ss}` : ''}${route}${hs ? `?${hs}` : ''}`;
}

/** Drops the parameter so a reload or a shared address doesn't import again. */
export function clearDeepLink(): void {
  const { pathname, search, hash } = window.location;
  const next = addressWithoutDeepLink(pathname, search, hash);
  if (next !== `${pathname}${search}${hash}`) window.history.replaceState(null, '', next);
}

/** Why a link value was refused, in words for the notice. */
export function invalidDeepLinkReason(value: string): string {
  if (/lichess\.org\/study\//i.test(value)) return t('link.study');
  return t('link.notGame');
}

export const lichessGameRecordId = (gameId: string): string => `url:https://lichess.org/${gameId}`;

export async function importLichessGame(gameId: string, client: LichessClient = new LichessClient()): Promise<GameRecord> {
  return lichessToGameRecord(await client.game(gameId));
}
