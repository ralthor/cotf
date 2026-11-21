import type { GameRecord } from '../core/chess/types';

/** Event asking the app to open a game in the Analyse tab (detail: the GameRecord). */
export const OPEN_GAME_EVENT = 'cotf:open-game';

export function openInAnalyse(game: GameRecord): void {
  window.dispatchEvent(new CustomEvent<GameRecord>(OPEN_GAME_EVENT, { detail: game }));
}
