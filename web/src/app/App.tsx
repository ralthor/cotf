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
import { clearDeepLink, importLichessGame, invalidDeepLinkReason, lichessGameRecordId, readDeepLink } from './deepLink';
import { ImportError } from '../features/import/http';
import { About, Disclaimer } from './About';
import { LanguageSelect, useT } from '../i18n/react';

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
  const { t, tn, locale } = useT();
  useEffect(() => {
    document.title = t('app.title');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable module function
  }, [locale]);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gameColRef = useRef<HTMLDivElement>(null);
  const knownIds = useMemo(() => new Set(games.map((g) => g.id)), [games]);
  const [linkStatus, setLinkStatus] = useState<{ text: string; error: boolean } | null>(null);

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

  useEffect(() => {
    // ?lichess=<id or URL> (in the hash or the query): open that game, importing it unless
    // it's already here. Checked on load and on hash changes (a link clicked while open).
    const openLinked = async () => {
      const link = readDeepLink();
      if (!link) return;
      clearDeepLink(); // synchronously, so a second run (StrictMode, reload) finds nothing
      if (link.kind === 'invalid') {
        setLinkStatus({ text: t('app.link.invalid', { reason: invalidDeepLinkReason(link.value) }), error: true });
        return;
      }
      const linked = link.id;
      const existing = (await gameStore.list()).find((g) => g.id === lichessGameRecordId(linked));
      if (existing) {
        setSelectedId(existing.id);
        revealGame();
        return;
      }
      setLinkStatus({ text: t('app.link.importing', { id: linked }), error: false });
      try {
        onImported([await importLichessGame(linked)]);
        setLinkStatus(null);
      } catch (e) {
        const reason = e instanceof ImportError ? e.message : (e as Error).message;
        setLinkStatus({ text: t('app.link.failed', { id: linked, reason }), error: true });
      }
    };
    void gameStore.list().then((list) => {
      setGames(list);
      if (list[0]) setSelectedId((id) => id ?? list[0]!.id);
      void openLinked();
    });
    const onHash = () => void openLinked();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable module function
  }, [onImported]);

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
    { route: 'analyse', label: t('nav.analyse'), show: true },
    { route: 'research', label: t('nav.research'), show: true },
    { route: 'library', label: t('nav.library'), show: backendEnabled },
    { route: 'stats', label: t('nav.stats'), show: backendEnabled },
    { route: 'about', label: t('nav.about'), show: true },
  ];

  return (
    <>
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <nav aria-label={t('nav.main')}>
          {nav
            .filter((n) => n.show)
            .map((n) => (
              <a key={n.route} href={`#/${n.route}`} aria-current={route === n.route ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
        </nav>
        <span className="spacer" />
        <span className="small muted hide-mobile">{t('app.tagline')}</span>
        <LanguageSelect className="lang-select" />
      </header>
      <main>
        {route === 'analyse' && (
          <div className="layout">
            <div className="stack">
              {linkStatus && (
                <p className={linkStatus.error ? 'notice error' : 'notice'} role={linkStatus.error ? 'alert' : 'status'}>
                  {linkStatus.text}
                  {linkStatus.error && (
                    <button type="button" className="link small" onClick={() => setLinkStatus(null)}>
                      {t('common.dismiss')}
                    </button>
                  )}
                </p>
              )}
              <ImportPanel onImported={onImported} knownIds={knownIds} />
              <section className="panel" aria-labelledby="games-title">
                <h2 id="games-title">{t('app.games', { n: games.length })}</h2>
                {games.length === 0 ? (
                  <p className="small muted">{t('app.games.empty')}</p>
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
                            {g.source} · {tn('app.plies', g.moves.length)}
                          </div>
                        </button>
                        <button type="button" className="link small remove-game" aria-label={t('app.games.remove', { title: gameTitle(g) })} onClick={() => remove(g.id)}>
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
                  <p>{t('app.selectGame')}</p>
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
