import type { GameRecord } from '../core/chess/types';

/** Event asking the app to open a game in the Analyse tab, optionally at a ply. */
export const OPEN_GAME_EVENT = 'cotf:open-game';

export type OpenGameDetail = { game: GameRecord; ply?: number };

export function openInAnalyse(game: GameRecord, ply?: number): void {
  window.dispatchEvent(new CustomEvent<OpenGameDetail>(OPEN_GAME_EVENT, { detail: { game, ply } }));
}
