import { useEffect, useMemo, useState } from 'react';
import { CategoryBadge } from '../../components/CategoryBadge';
import { categoryLabel } from '../../components/categoryText';
import { lichessAnalysisUrl } from '../../core/chess/links';
import { discoverRepertoire } from '../../core/repertoire/discover';
import { family, openingOf, type OpeningTable } from '../../core/openings/names';
import { openingResults, summariseGames, type Deviation, type OpeningGame } from '../../core/repertoire/games';
import { buildTrainGraph } from '../../core/repertoire/trainer';
import type { Chapter, PosKey, Repertoire, Side } from '../../core/repertoire/types';
import { formatScore } from '../../core/scoring/score';
import { getLocale, t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { getPref, setPref } from '../../storage/prefs';
import { ImportError } from '../import/http';
import { TrainingBoard } from './TrainerView';
import { useTrainer } from './useTrainer';
import { isPlayable, useOpeningGames } from './useOpeningGames';
import { useOpenings } from './useOpenings';
import type { ImportOrigin, ImportSummary, ImportTarget } from './useRepertoires';

const ROWS = 15;
const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'classical', 'daily'] as const;
const pct = (x: number) => new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(x);
const sideName = (s: Side) => t(s === 'w' ? 'repertoire.white' : 'repertoire.black');

/** Review of one position from a game, with the trainer for that side. */
function GamePractice({ chapters, repertoireId, side, posKey, onDone }: { chapters: readonly Chapter[]; repertoireId: string; side: Side; posKey: PosKey; onDone: () => void }) {
  const sideChapters = useMemo(() => chapters.filter((c) => c.side === side), [chapters, side]);
  const tr = useTrainer(repertoireId, sideChapters, side);
  const { start, loaded } = tr;
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!loaded || started) return;
    start('review', posKey);
    setStarted(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-off start once the cards are loaded
  }, [loaded, started, start, posKey]);
  useEffect(() => {
    if (started && !tr.session) onDone();
  }, [started, tr.session, onDone]);
  return tr.session ? <TrainingBoard tr={tr} session={tr.session} side={side} noHints={false} /> : null;
}

function GameLinks({ games }: { games: OpeningGame[] }) {
  const shown = games.slice(0, 3);
  return (
    <span className="small">
      {shown.map((g, i) => (
        <span key={g.id}>
          {i > 0 && ' · '}
          {g.url ? (
            <a href={g.url} target="_blank" rel="noreferrer noopener">
              <bdi>{g.userColour === 'w' ? g.black : g.white}</bdi> ↗
            </a>
          ) : (
            <bdi>{g.userColour === 'w' ? g.black : g.white}</bdi>
          )}
        </span>
      ))}
      {games.length > shown.length && <span className="muted"> {t('games.more', { n: games.length - shown.length })}</span>}
    </span>
  );
}

function FetchPanel({ og }: { og: ReturnType<typeof useOpeningGames> }) {
  const [cc, setCc] = useState(() => getPref('chesscomUsername') ?? '');
  const [months, setMonths] = useState(() => Number(getPref('chesscomMonths')) || 3);
  const [li, setLi] = useState(() => getPref('lichessUsername') ?? '');
  const [max, setMax] = useState(100);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async () => {
    setBusy(true);
    setStatus({ text: t('games.fetching') });
    try {
      if (cc.trim()) setPref('chesscomUsername', cc.trim());
      if (li.trim()) setPref('lichessUsername', li.trim());
      const r = await og.fetchGames({
        chesscom: cc.trim() ? { username: cc.trim(), months } : undefined,
        lichess: li.trim() ? { username: li.trim(), max } : undefined,
      });
      const text = [tn('games.fetched', r.added), r.skipped ? tn('games.skipped', r.skipped) : '', ...r.errors].filter(Boolean).join(' ');
      setStatus({ text, error: r.errors.length > 0 && r.added === 0 });
    } catch (e) {
      setStatus({ text: e instanceof ImportError ? e.message : t('import.failed', { reason: (e as Error).message }), error: true });
    } finally {
      setBusy(false);
    }
  };

  const bySource = (s: OpeningGame['source']) => og.games.filter((g) => g.source === s).length;
  return (
    <section className="panel stack" aria-labelledby="games-fetch">
      <h2 id="games-fetch" style={{ margin: 0 }}>
        {t('games.title')}
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        {t('games.help')}
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="row games-fetch-row">
          <label className="row small">
            Chess.com
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder={t('games.username')} autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" />
          </label>
          <label className="row small">
            {t('games.months')}
            <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[1, 3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row games-fetch-row">
          <label className="row small">
            Lichess
            <input value={li} onChange={(e) => setLi(e.target.value)} placeholder={t('games.username')} autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" />
          </label>
          <label className="row small">
            {t('games.count')}
            <select value={max} onChange={(e) => setMax(Number(e.target.value))}>
              {[25, 50, 100].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button type="submit" className="primary" disabled={busy || (!cc.trim() && !li.trim())}>
            {busy ? t('common.loading') : t('games.fetch')}
          </button>
          {og.games.length > 0 && (
            <button
              type="button"
              className="link small"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('games.clearConfirm'))) void og.clear();
              }}
            >
              {t('games.clear')}
            </button>
          )}
        </div>
      </form>
      <p className="small" style={{ margin: 0 }}>
        {og.games.length ? t('games.stored', { n: og.games.length, cc: bySource('chesscom'), li: bySource('lichess') }) : t('games.none')}
      </p>
      {status && (
        <p className={`small ${status.error ? 'error' : 'muted'}`} style={{ margin: 0 }} aria-live="polite">
          {status.text}
        </p>
      )}
    </section>
  );
}

/** The Games sub-tab: your games against the selected repertoire, and a repertoire from your games. */
export function GamesView({
  repertoire,
  chapters,
  onImport,
}: {
  repertoire: Repertoire | null;
  chapters: readonly Chapter[];
  onImport: (pgn: string, origin: ImportOrigin, target: ImportTarget, side: Side) => Promise<ImportSummary>;
}) {
  useT();
  const og = useOpeningGames();
  const [timeClass, setTimeClass] = useState('');
  const [practice, setPractice] = useState<{ side: Side; posKey: PosKey } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const games = useMemo(() => (timeClass ? og.games.filter((g) => g.timeClass === timeClass) : og.games), [og.games, timeClass]);
  const graphs = useMemo(() => ({ w: buildTrainGraph(chapters, 'w'), b: buildTrainGraph(chapters, 'b') }), [chapters]);
  const summary = useMemo(() => summariseGames(graphs, games), [graphs, games]);
  const openings = useOpenings();
  const nameAt = (keys: readonly string[]) => (openings ? openingOf(openings, keys)?.name : undefined);
  const { loadGrades } = og;
  useEffect(() => {
    void loadGrades(summary.you);
  }, [summary.you, loadGrades]);

  if (practice && repertoire) {
    return <GamePractice chapters={chapters} repertoireId={repertoire.id} side={practice.side} posKey={practice.posKey} onDone={() => setPractice(null)} />;
  }

  const youRows = summary.you.slice(0, ROWS);
  const mistakes = summary.you.filter((d) => !isPlayable(og.gradeOf(d)));
  const chapterTitle = (id: string) => chapters.find((c) => c.id === id)?.title ?? '?';

  return (
    <div className="stack">
      <FetchPanel og={og} />

      {og.games.length > 0 && repertoire && (
        <section className="panel stack" aria-labelledby="games-summary">
          <div className="row">
            <h2 id="games-summary" style={{ margin: 0, flex: 1 }}>
              {t('games.against')} · <bdi>{repertoire.name}</bdi>
            </h2>
            <label className="row small">
              {t('games.timeClass')}
              <select value={timeClass} onChange={(e) => setTimeClass(e.target.value)}>
                <option value="">{t('games.allTimeClasses')}</option>
                {TIME_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {t(`games.tc.${c}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {summary.inRepertoire === 0 ? (
            <p className="muted">{t('games.noneInRepertoire')}</p>
          ) : (
            <div className="stat-tiles">
              <div className="stat-tile">
                <strong>{summary.inRepertoire}</strong>
                <span className="small">{t('games.inRepertoire', { n: summary.checked })}</span>
              </div>
              <div className="stat-tile">
                <strong>{pct(summary.followed / summary.inRepertoire)}</strong>
                <span className="small">{t('games.followed')}</span>
              </div>
              <div className="stat-tile">
                <strong>{summary.you.reduce((s, d) => s + d.games.length, 0)}</strong>
                <span className="small">{t('games.youLeft')}</span>
              </div>
              <div className="stat-tile">
                <strong>{summary.opponent.reduce((s, d) => s + d.games.length, 0)}</strong>
                <span className="small">{t('games.theyLeft')}</span>
              </div>
              <div className="stat-tile">
                <strong>{(summary.averageInBook / 2).toFixed(1)}</strong>
                <span className="small">{t('games.inBook')}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {repertoire && summary.you.length > 0 && (
        <section className="panel stack" aria-labelledby="games-you">
          <div className="row">
            <h2 id="games-you" style={{ margin: 0, flex: 1 }}>
              {t('games.you.title')}
            </h2>
            {og.grading ? (
              <button type="button" className="small" onClick={og.stopGrading}>
                {t('games.grading', { done: og.grading.done, total: og.grading.total })}
              </button>
            ) : (
              <button type="button" className="small" onClick={() => void og.grade(youRows)} disabled={youRows.every((d) => og.gradeOf(d))}>
                {t('games.grade')}
              </button>
            )}
            <button
              type="button"
              className="small"
              disabled={!mistakes.length}
              onClick={async () => {
                const n = await og.addToReview(repertoire.id, mistakes);
                setMessage(n ? tn('games.added', n) : t('games.addedNone'));
              }}
            >
              {t('games.addToReview')}
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {t('games.you.help')}
          </p>
          {message && (
            <p className="small" aria-live="polite" style={{ margin: 0 }}>
              {message}
            </p>
          )}
          <ul className="mistake-list">
            {youRows.map((d: Deviation) => {
              const g = og.gradeOf(d);
              return (
                <li key={d.key}>
                  <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                    <bdi dir="ltr" className="mistake-line">
                      {d.line}
                    </bdi>
                    {nameAt(d.keys) && (
                      <bdi className="small">{nameAt(d.keys)}</bdi>
                    )}
                    <span className="small muted">
                      {sideName(d.side)} · {tn('games.you.row', d.games.length, { san: d.played.san, expected: d.expected.join(', ') })}
                    </span>
                    {g && (
                      <span className={`small ${isPlayable(g) ? '' : 'error'}`}>
                        <CategoryBadge category={g.category} /> {isPlayable(g) ? t('games.playable') : t('games.mistake')} · {categoryLabel(g.category)} (
                        <bdi dir="ltr">{formatScore(g.played)}</bdi> / <bdi dir="ltr">{formatScore(g.best)}</bdi>)
                      </span>
                    )}
                    <GameLinks games={d.games} />
                  </div>
                  <button type="button" className="small" onClick={() => setPractice({ side: d.side, posKey: d.posKey })}>
                    {t('train.practise')}
                  </button>
                </li>
              );
            })}
          </ul>
          {summary.you.length > ROWS && <p className="small muted">{t('games.moreRows', { n: summary.you.length - ROWS })}</p>}
        </section>
      )}

      {repertoire && summary.opponent.length > 0 && (
        <section className="panel stack" aria-labelledby="games-them">
          <h2 id="games-them" style={{ margin: 0 }}>
            {t('games.them.title')}
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            {t('games.them.help')}
          </p>
          <ul className="mistake-list">
            {summary.opponent.slice(0, ROWS).map((d) => (
              <li key={d.key}>
                <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <bdi dir="ltr" className="mistake-line">
                    {d.line}
                  </bdi>
                  {nameAt(d.keys) && <bdi className="small">{nameAt(d.keys)}</bdi>}
                  <span className="small muted">
                    {sideName(d.side)} · {tn('games.them.row', d.games.length, { san: d.played.san, expected: d.expected.join(', ') })}
                  </span>
                  <GameLinks games={d.games} />
                </div>
                <a className="button-link small" href={lichessAnalysisUrl(d.fen, d.side === 'b' ? 'black' : 'white')} target="_blank" rel="noreferrer noopener">
                  {t('games.prepare')} ↗
                </a>
              </li>
            ))}
          </ul>
          {summary.opponent.length > ROWS && <p className="small muted">{t('games.moreRows', { n: summary.opponent.length - ROWS })}</p>}
        </section>
      )}

      {repertoire && summary.chapters.length > 0 && (
        <section className="panel" aria-labelledby="games-chapters">
          <h2 id="games-chapters">{t('games.byChapter')}</h2>
          <div className="table-scroll">
            <table className="games-table">
              <thead>
                <tr>
                  <th>{t('games.chapter')}</th>
                  <th>{t('games.games')}</th>
                  <th>{t('games.score')}</th>
                  <th dir="ltr">+ = −</th>
                  <th>{t('games.inBookShort')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.chapters.map((c) => (
                  <tr key={c.chapterId}>
                    <td>
                      <bdi>{chapterTitle(c.chapterId)}</bdi>
                    </td>
                    <td>{c.games}</td>
                    <td>{pct((c.wins + c.draws / 2) / c.games)}</td>
                    <td dir="ltr">
                      +{c.wins} ={c.draws} −{c.losses}
                    </td>
                    <td>{(c.inBook / c.games / 2).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {openings && games.length > 0 && <OpeningsPanel games={games} table={openings} />}

      {og.games.length > 0 && <DiscoverPanel games={og.games} onImport={onImport} />}
    </div>
  );
}

/** Builds a repertoire from the moves you play most and imports it as a new repertoire. */
function DiscoverPanel({
  games,
  onImport,
}: {
  games: readonly OpeningGame[];
  onImport: (pgn: string, origin: ImportOrigin, target: ImportTarget, side: Side) => Promise<ImportSummary>;
}) {
  const [side, setSide] = useState<Side>('w');
  const [minGames, setMinGames] = useState(2);
  const [moves, setMoves] = useState(8);
  const [status, setStatus] = useState<string | null>(null);
  const result = useMemo(
    () =>
      discoverRepertoire(games, {
        side,
        minGames,
        maxPlies: moves * 2,
        title: t('games.discover.name', { side: sideName(side) }),
        comment: (n, score) => (score === null ? tn('games.discover.comment', n) : `${tn('games.discover.comment', n)} ${t('games.discover.scored', { pct: pct(score) })}`),
      }),
    [games, side, minGames, moves],
  );
  return (
    <section className="panel stack" aria-labelledby="games-discover">
      <h2 id="games-discover" style={{ margin: 0 }}>
        {t('games.discover.title')}
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        {t('games.discover.help')}
      </p>
      <div className="row train-options">
        <div className="segmented" role="group" aria-label={t('train.side')}>
          {(['w', 'b'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}>
              {sideName(s)}
            </button>
          ))}
        </div>
        <label className="row small">
          {t('games.discover.min')}
          <select value={minGames} onChange={(e) => setMinGames(Number(e.target.value))}>
            {[2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="row small">
          {t('games.discover.depth')}
          <select value={moves} onChange={(e) => setMoves(Number(e.target.value))}>
            {[6, 8, 10, 12].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="small" style={{ margin: 0 }}>
        {result ? t('games.discover.preview', { positions: result.positions, games: result.games }) : t('games.discover.nothing')}
      </p>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!result}
          onClick={async () => {
            if (!result) return;
            const s = await onImport(result.pgn, { kind: 'pgn-paste' }, { newName: t('games.discover.name', { side: sideName(side) }) }, side);
            setStatus(t('games.discover.done', { name: s.repertoire.name }));
          }}
        >
          {t('games.discover.create')}
        </button>
      </div>
      {status && (
        <p className="small" aria-live="polite" style={{ margin: 0 }}>
          {status}
        </p>
      )}
    </section>
  );
}

/** Your games by the opening they reached (its family name) and the side you played. */
function OpeningsPanel({ games, table }: { games: readonly OpeningGame[]; table: OpeningTable }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(
    () =>
      openingResults(games, (keys) => {
        const o = openingOf(table, keys);
        return o ? { eco: o.eco, name: family(o.name) } : null;
      }),
    [games, table],
  );
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <section className="panel" aria-labelledby="games-openings">
      <h2 id="games-openings">{t('games.openings')}</h2>
      <div className="table-scroll">
        <table className="games-table">
          <thead>
            <tr>
              <th>{t('games.opening')}</th>
              <th>{t('train.side')}</th>
              <th>{t('games.games')}</th>
              <th>{t('games.score')}</th>
              <th dir="ltr">+ = −</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.side}|${r.name}`}>
                <td>
                  <bdi>{r.name}</bdi>
                </td>
                <td>{sideName(r.side)}</td>
                <td>{r.games}</td>
                <td>{pct((r.wins + r.draws / 2) / r.games)}</td>
                <td dir="ltr">
                  +{r.wins} ={r.draws} −{r.losses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <button type="button" className="link small" onClick={() => setAll(true)}>
          {t('games.showAll', { n: rows.length })}
        </button>
      )}
    </section>
  );
}
