import { useEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { openInAnalyse } from '../../app/openGame';
import { EvalChart } from '../../components/EvalChart';
import { lichessAnalysisUrl } from '../../core/chess/links';
import { parseSingleGame } from '../../core/chess/pgn';
import { positionsOf } from '../../core/chess/types';
import type { MoveCategory } from '../../core/classification/classify';
import type { EngineScore } from '../../core/engine/types';
import { formatScore } from '../../core/scoring/score';
import { dbMoves, isMainMove, moveLabel, walkGame, type ImprovementRule } from '../../core/repertoire/insights';
import { dropLabel, winFor, type DropLabel, type LossMove } from '../../core/repertoire/openingLoss';
import type { OpeningGame } from '../../core/repertoire/games';
import { getLocale, t } from '../../i18n';
import type { ExplorerResult } from './explorer';
import { keyOfFen, sanLine, sanOf, type Fix } from './fixes';
import type { CloudEval } from './cloudEval';
import type { useOpeningLosses } from './useOpeningLosses';
import { evalAtFor } from './useOpeningLosses';

const pct = (x: number) => new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(x);
const ARROW = { played: 'rgba(47,111,143,0.85)', engine: 'rgba(21,120,27,0.85)', db: 'rgba(208,102,28,0.85)' };
const SUFFIX: Record<DropLabel, string> = { inaccuracy: '?!', mistake: '?', blunder: '??' };
const CATEGORY: Record<DropLabel, MoveCategory> = { inaccuracy: 'questionable', mistake: 'mistake', blunder: 'blunder' };

type Losses = ReturnType<typeof useOpeningLosses>;

export type PlayerProps = {
  game: OpeningGame;
  startPly: number;
  maxPly: number;
  losses: Losses;
  /** The database for a position (fetched when needed). */
  lookupFen: (fen: string) => Promise<unknown>;
  cachedFen: (fen: string) => ExplorerResult | undefined;
  dbName: string;
  rule: ImprovementRule;
  onAddFix: (fix: Fix) => void;
  fixBusy: boolean;
  onBack: () => void;
};

/**
 * One of your games, move by move: the evaluation (Lichess cloud, or the game's own when it was
 * analysed on Lichess), what you played, the engine's move and the database's moves, side by side.
 */
export function GamePlayer({ game, startPly, maxPly, losses, lookupFen, cachedFen, dbName, rule, onAddFix, fixBusy, onBack }: PlayerProps) {
  // The whole game when its PGN was kept, else its first moves.
  const full = useMemo(() => {
    if (game.pgn) {
      try {
        const rec = parseSingleGame(game.pgn, { source: game.source, sourceUrl: game.url, providerData: { timeClass: game.timeClass } });
        return { rec, fens: positionsOf(rec), moves: rec.moves.map((m) => ({ san: m.san, uci: m.uci })) };
      } catch {
        // fall through to the stored moves
      }
    }
    const w = walkGame(game);
    return { rec: null, fens: w.fens, moves: game.moves.slice(0, w.ucis.length).map((m, i) => ({ san: m.san, uci: w.ucis[i]! })) };
  }, [game]);
  const last = full.fens.length - 1;
  const [ply, setPly] = useState(() => Math.max(0, Math.min(last, startPly)));
  const go = (p: number) => setPly(Math.max(0, Math.min(last, p)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(last, p + 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  const fen = full.fens[ply]!;
  const next = full.moves[ply];
  const afterFen = next ? full.fens[ply + 1]! : null;
  const key = useMemo(() => keyOfFen(fen), [fen]);
  const afterKey = useMemo(() => (afterFen ? keyOfFen(afterFen) : ''), [afterFen]);
  const turn = fen.split(' ')[1] === 'w' ? 'w' : 'b';
  const mine = turn === game.userColour;

  // Look up what is missing for this position, once the user stops on it.
  const { lookupOne } = losses;
  useEffect(() => {
    const id = setTimeout(() => {
      void lookupOne(key, fen);
      if (afterFen) void lookupOne(afterKey, afterFen);
      if (mine) void lookupFen(fen);
    }, 350);
    return () => clearTimeout(id);
  }, [key, fen, afterKey, afterFen, mine, lookupOne, lookupFen]);

  const evalAt = useMemo(() => evalAtFor(game, maxPly, losses.cloud), [game, maxPly, losses.cloud]);
  const scoreOf = (p: number, k: string): { score: EngineScore; pv?: string[]; depth?: number; cloud?: CloudEval | null } | undefined => {
    const own = p <= maxPly ? evalAt(p) : undefined;
    const c = losses.cloud.get(k);
    if (own) return { ...own, depth: c?.depth };
    return c ? { score: c.score, pv: c.pv, depth: c.depth } : undefined;
  };
  const here = scoreOf(ply, key);
  const after = afterFen ? scoreOf(ply + 1, afterKey) : undefined;
  const asked = losses.cloud.has(key);

  const loss = losses.byGame.get(game.id);
  const measured = useMemo(() => new Map<number, LossMove>((loss?.moves ?? []).map((m) => [m.ply, m])), [loss]);

  const engineBest = here?.pv?.[0];
  const engineLine = here?.pv ? sanLine(fen, here.pv.slice(0, 8)) : [];
  const db = mine || next ? cachedFen(fen) : undefined;
  const dbList = db ? dbMoves(db, turn) : [];
  const dbTotal = db ? db.white + db.draws + db.black : 0;
  const dbMain = dbList.filter((m) => isMainMove(m, dbTotal, rule));
  const dbBest = dbMain.length ? dbMain.reduce((a, b) => (b.score > a.score ? b : a)) : undefined;
  const dbPlayed = next ? dbList.find((m) => m.uci === next.uci) : undefined;

  const arrows = [
    ...(next ? [{ startSquare: next.uci.slice(0, 2), endSquare: next.uci.slice(2, 4), color: ARROW.played }] : []),
    ...(engineBest && engineBest !== next?.uci ? [{ startSquare: engineBest.slice(0, 2), endSquare: engineBest.slice(2, 4), color: ARROW.engine }] : []),
    ...(dbBest && dbBest.uci !== next?.uci && dbBest.uci !== engineBest ? [{ startSquare: dbBest.uci.slice(0, 2), endSquare: dbBest.uci.slice(2, 4), color: ARROW.db }] : []),
  ];
  const prev = ply > 0 ? full.moves[ply - 1] : undefined;
  const squareStyles: Record<string, React.CSSProperties> = prev
    ? { [prev.uci.slice(0, 2)]: { background: 'rgba(255,214,10,0.35)' }, [prev.uci.slice(2, 4)]: { background: 'rgba(255,214,10,0.45)' } }
    : {};

  // The evaluation curve over the opening, with your measured drops marked.
  const chartPlies = Math.min(last, maxPly);
  const chartEvals = Array.from({ length: chartPlies + 1 }, (_, p) => evalAt(p)?.score);
  const chartCats = Array.from({ length: chartPlies }, (_, i) => {
    const m = measured.get(i + 1);
    const l = m ? dropLabel(m.drop) : null;
    return l ? CATEGORY[l] : undefined;
  });

  const win = (s: EngineScore | undefined) => (s ? winFor(s, game.userColour) : null);
  const winBefore = win(here?.score);
  const winAfter = win(after?.score);
  const drop = winBefore !== null && winAfter !== null && mine ? Math.max(0, winBefore - winAfter) : null;
  const label = drop !== null ? dropLabel(drop) : null;
  const orientation = game.userColour === 'w' ? 'white' : 'black';
  const lichessUrl = game.source === 'lichess' && game.url ? `${game.url}${game.userColour === 'b' ? '/black' : ''}#${ply}` : lichessAnalysisUrl(fen, orientation);
  const engineSan = engineBest ? sanOf(fen, engineBest) : null;
  const reachedBy = full.moves.slice(0, ply).map((m) => m.san);

  const fixFor = (better: string, why: string): Fix => ({
    line: here?.pv,
    colour: game.userColour,
    fen,
    reachedBy,
    played: next!.san,
    better,
    why,
    context: t('fixes.context', { line: reachedBy.length ? sanOrder(reachedBy) : t('insights.start'), played: moveLabel(ply + 1, next!.san), date: dateOf(game) }),
  });

  return (
    <div className="stack">
      <div className="row">
        <button type="button" onClick={onBack}>
          ← {t('insights.back')}
        </button>
        <h2 className="insight-title">
          <bdi>{game.userColour === 'w' ? game.black : game.white}</bdi>
          {game.opponentRating ? ` (${game.opponentRating})` : ''} · {dateOf(game)} · {t(`insights.${resultWord(game)}`)}
        </h2>
      </div>
      <div className="chapter-view">
        <div className="board-col">
          <div className="board-wrap" dir="ltr">
            <Chessboard options={{ id: 'player-board', position: fen, boardOrientation: orientation, allowDragging: false, arrows, squareStyles, lightSquareStyle: { backgroundColor: 'var(--board-light)' }, darkSquareStyle: { backgroundColor: 'var(--board-dark)' } }} />
          </div>
          <div className="row player-nav" dir="ltr">
            <button type="button" aria-label={t('player.first')} onClick={() => go(0)}>
              ⏮
            </button>
            <button type="button" aria-label={t('player.prev')} onClick={() => go(ply - 1)}>
              ◀
            </button>
            <span className="small">
              {ply}/{last}
            </span>
            <button type="button" aria-label={t('player.next')} onClick={() => go(ply + 1)}>
              ▶
            </button>
            <button type="button" aria-label={t('player.last')} onClick={() => go(last)}>
              ⏭
            </button>
          </div>
          <p className="small legend-row">
            <span className="swatch" style={{ background: ARROW.played }} /> {t('player.legendPlayed')} <span className="swatch" style={{ background: ARROW.engine }} /> {t('player.legendEngine')} <span className="swatch" style={{ background: ARROW.db }} /> {t('player.legendDb')}
          </p>
          {chartEvals.some(Boolean) && <EvalChart evals={chartEvals} categories={chartCats} current={Math.min(ply, chartPlies)} onSelect={go} />}
          <p className="small muted">{t('player.chartHelp', { n: Math.ceil(chartPlies / 2) })}</p>
        </div>

        <div className="stack side">
          <section className="panel stack" aria-labelledby="player-here">
            <h3 id="player-here">
              {next ? (
                <>
                  <span dir="ltr">{moveLabel(ply + 1, next.san)}</span>
                  {label && mine && <span className={label === 'inaccuracy' ? '' : 'bad-text'}> {SUFFIX[label]}</span>} · {t(mine ? 'player.yourMove' : 'player.theirMove')}
                </>
              ) : (
                t('player.end')
              )}
            </h3>
            <p>
              {here ? (
                <>
                  {t('player.evalHere', { eval: formatScore(here.score), win: pct(winBefore!) })}
                  {here.depth ? <span className="small muted"> · {t('player.depth', { d: here.depth })}</span> : null}
                </>
              ) : asked ? (
                t('player.noCloud')
              ) : (
                <span className="muted">{t('player.loading')}</span>
              )}
            </p>
            {next && (
              <p>
                {t(mine ? 'player.youPlayed' : 'player.theyPlayed', { san: next.san })}{' '}
                {after && winAfter !== null && (
                  <>
                    {t('player.evalAfter', { eval: formatScore(after.score), win: pct(winAfter) })}
                    {drop !== null && drop >= 0.01 && (
                      <strong className={label && label !== 'inaccuracy' ? 'bad-text' : undefined}> {t('player.drop', { drop: pct(drop) })}{label ? ` · ${t(`loss.${label}`)}` : ''}</strong>
                    )}
                  </>
                )}
              </p>
            )}
            {engineSan && (
              <p>
                <span className="swatch" style={{ background: ARROW.engine }} /> {t('player.engine', { san: engineSan })}{' '}
                {engineLine.length > 1 && (
                  <span className="small muted" dir="ltr">
                    ({t('player.then')} {engineLine.slice(1).join(' ')})
                  </span>
                )}
                {next && engineBest === next.uci && <span className="good-text"> · {t('player.sameAsEngine')}</span>}
              </p>
            )}
            {db && !dbList.length ? (
              <p className="small muted">
                {dbName}: {t('player.noDbGames')}
              </p>
            ) : db ? (
              <>
                <p className="small muted">{dbName}</p>
                <div className="table-scroll">
                  <table className="games-table">
                    <thead>
                      <tr>
                        <th>{t('insights.col.moveSan')}</th>
                        <th>{t('insights.db.games')}</th>
                        <th>{t(turn === game.userColour ? 'insights.db.scoreForYou' : 'player.scoreForThem')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbList.slice(0, 6).map((m) => (
                        <tr key={m.uci} className={m.uci === next?.uci ? 'highlight' : undefined}>
                          <td dir="ltr">
                            {m.uci === dbBest?.uci ? <strong>{m.san}</strong> : m.san}
                            {m.uci === next?.uci && <span className="small muted"> ← {t('player.played')}</span>}
                          </td>
                          <td>
                            {m.games.toLocaleString(getLocale())} <span className="small muted">({pct(m.games / Math.max(1, dbTotal))})</span>
                          </td>
                          <td>{pct(m.score)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {next && !dbPlayed && dbTotal > 0 && <p className="small">{t('player.notInDb', { san: next.san })}</p>}
              </>
            ) : (
              mine && <p className="small muted">{t('player.dbLoading')}</p>
            )}
            {next && mine && (engineBest || dbBest) && (
              <div className="row">
                {engineBest && engineBest !== next.uci && engineSan && (
                  <button type="button" disabled={fixBusy} onClick={() => onAddFix(fixFor(engineBest, t('fixes.whyEngine', { better: engineSan, played: next.san, before: winBefore !== null ? pct(winBefore) : '?', after: winAfter !== null ? pct(winAfter) : '?' })))}>
                    {t('fixes.add', { san: engineSan })}
                  </button>
                )}
                {dbBest && dbBest.uci !== next.uci && dbBest.uci !== engineBest && (
                  <button type="button" disabled={fixBusy} onClick={() => onAddFix(fixFor(dbBest.uci, t('fixes.whyDb', { better: dbBest.san, score: pct(dbBest.score), played: next.san, yours: dbPlayed ? pct(dbPlayed.score) : '—' })))}>
                    {t('fixes.add', { san: dbBest.san })}
                  </button>
                )}
              </div>
            )}
            <p className="small">
              <a href={lichessUrl} target="_blank" rel="noreferrer noopener">
                {t(game.source === 'lichess' ? 'player.onLichessGame' : 'player.onLichess')} ↗
              </a>
              {full.rec && (
                <>
                  {' · '}
                  <button type="button" className="link" onClick={() => openInAnalyse(full.rec!, ply)}>
                    {t('player.analyseHere')}
                  </button>
                </>
              )}
            </p>
          </section>

          <section className="panel" aria-label={t('player.moves')}>
            <ol className="player-moves" dir="ltr">
              {full.moves.map((m, i) => {
                const p = i + 1;
                const lm = measured.get(p);
                const l = lm ? dropLabel(lm.drop) : null;
                return (
                  <li key={i} className={i % 2 === 0 ? 'white-move' : undefined}>
                    {i % 2 === 0 && <span className="muted">{i / 2 + 1}.</span>}
                    <button type="button" className={`link move-chip${p === ply ? ' current' : ''}${l && l !== 'inaccuracy' ? ' bad-text' : ''}`} onClick={() => go(p)}>
                      {m.san}
                      {l ? SUFFIX[l] : ''}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

const sanOrder = (sans: readonly string[]) => sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ');
const dateOf = (g: OpeningGame) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(g.playedAt));
const resultWord = (g: OpeningGame) => {
  if (g.result === '1/2-1/2') return 'drawn';
  const won = (g.result === '1-0') === (g.userColour === 'w');
  return won ? 'won' : 'lost';
};
