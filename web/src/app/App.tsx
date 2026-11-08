import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gameTitle } from '../core/chess/pgn';
import type { GameRecord } from '../core/chess/types';
import { GameView } from '../features/game/GameView';
import { ImportPanel } from '../features/import/ImportPanel';
import { ResearchView } from '../features/research/ResearchView';
import { backendEnabled } from '../features/library/api';
import { AuthProvider } from '../features/library/AuthContext';
import { LibraryView } from '../features/library/LibraryView';
import { StatsView } from '../features/library/StatsView';
import { CloudAnalysisPanel } from '../features/cloud/CloudAnalysisPanel';
import { gameStore } from '../storage/db';
import { EngineProvider } from './EngineContext';
import { useHashRoute, type Route } from './useHashRoute';
import { About, Disclaimer } from './About';

const SAMPLE_PGN_GAME_NOTE = 'Tip: import a PGN or fetch your games from Chess.com or Lichess to begin.';

export function App() {
  return (
    <EngineProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </EngineProvider>
  );
}

function Shell() {
  const route = useHashRoute();
  const [games, setGames] = useState<GameRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gameColRef = useRef<HTMLDivElement>(null);
  const knownIds = useMemo(() => new Set(games.map((g) => g.id)), [games]);

  useEffect(() => {
    void gameStore.list().then((list) => {
      setGames(list);
      if (list[0]) setSelectedId((id) => id ?? list[0]!.id);
    });
  }, []);

  /** Brings the opened game into view: on phones it sits above the lists, off-screen. */
  const revealGame = () =>
    requestAnimationFrame(() => {
      const el = gameColRef.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

  const onImported = useCallback((imported: GameRecord[]) => {
    setGames((prev) => {
      const ids = new Set(imported.map((g) => g.id));
      return [...imported, ...prev.filter((g) => !ids.has(g.id))];
    });
    if (imported[0]) setSelectedId(imported[0].id);
    for (const g of imported) void gameStore.put(g);
    if (window.location.hash !== '#/analyse' && window.location.hash !== '') window.location.hash = '#/analyse';
    revealGame();
  }, []);

  const select = (id: string) => {
    setSelectedId(id);
    revealGame();
  };

  const remove = (id: string) => {
    void gameStore.remove(id);
    setGames((g) => g.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const selected = games.find((g) => g.id === selectedId) ?? null;
  const nav: { route: Route; label: string; show: boolean }[] = [
    { route: 'analyse', label: 'Analyse', show: true },
    { route: 'research', label: 'Research', show: true },
    { route: 'library', label: 'Library', show: backendEnabled },
    { route: 'stats', label: 'Stats', show: backendEnabled },
    { route: 'about', label: 'About', show: true },
  ];

  return (
    <>
      <header className="app-header">
        <h1>Chess Game Analyser</h1>
        <nav aria-label="Main">
          {nav
            .filter((n) => n.show)
            .map((n) => (
              <a key={n.route} href={`#/${n.route}`} aria-current={route === n.route ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
        </nav>
        <span className="spacer" />
        <span className="small muted hide-mobile">Completed games only · no live assistance</span>
      </header>
      <main>
        {route === 'analyse' && (
          <div className="layout">
            <div className="stack">
              <ImportPanel onImported={onImported} knownIds={knownIds} />
              <section className="panel" aria-labelledby="games-title">
                <h2 id="games-title">Games ({games.length})</h2>
                {games.length === 0 ? (
                  <p className="small muted">{SAMPLE_PGN_GAME_NOTE}</p>
                ) : (
                  <ul className="game-list">
                    {games.map((g) => (
                      <li key={g.id} className="row" style={{ flexWrap: 'nowrap' }}>
                        <button
                          type="button"
                          style={{ flex: 1, minWidth: 0 }}
                          aria-current={g.id === selectedId ? 'true' : undefined}
                          onClick={() => select(g.id)}
                        >
                          {gameTitle(g)}
                          <div className="meta">
                            {g.source} · {g.moves.length} plies
                          </div>
                        </button>
                        <button type="button" className="link small remove-game" aria-label={`Remove ${gameTitle(g)}`} onClick={() => remove(g.id)}>
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <div className="game-col" ref={gameColRef}>
              {selected ? (
                <GameView
                  key={selected.id}
                  game={selected}
                  renderExtra={backendEnabled ? (ctx) => <CloudAnalysisPanel {...ctx} /> : undefined}
                />
              ) : (
                <div className="panel">
                  <p>Select or import a finished game to review it with Stockfish in your browser.</p>
                </div>
              )}
            </div>
          </div>
        )}
        {route === 'research' && <ResearchView />}
        {route === 'library' && backendEnabled && <LibraryView onOpenGame={onImported} />}
        {route === 'stats' && backendEnabled && <StatsView />}
        {route === 'about' && <About />}
      </main>
      <Disclaimer />
    </>
  );
}
