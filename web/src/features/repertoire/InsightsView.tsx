import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chessboard } from 'react-chessboard';
import { openInAnalyse } from '../../app/openGame';
import { lichessAnalysisUrl } from '../../core/chess/links';
import { parseSingleGame } from '../../core/chess/pgn';
import { userScore, type OpeningGame } from '../../core/repertoire/games';
import {
  SHRINK_GAMES,
  dbMoves,
  isMainMove,
  lastMove,
  lossShare,
  moveLabel,
  orderLine,
  scoreOf,
  shrunkScore,
  type GamesTree,
  type Improvement,
  type NextMove,
  type PositionNode,
  type WeakSpot,
  walkGame,
} from '../../core/repertoire/insights';
import { DROP, dropLabel, winFor, type DropLabel, type LossMove, type OpeningLoss } from '../../core/repertoire/openingLoss';
import type { Side } from '../../core/repertoire/types';
import type { EngineScore } from '../../core/engine/types';
import { formatScore } from '../../core/scoring/score';
import { getPref, setPref } from '../../storage/prefs';
import { afterUci, fixPgn, growReplies, keyOfFen, linePly, MAX_FIX_LOOKUPS, sanOf, type Fix } from './fixes';
import { GamePlayer } from './GamePlayer';
import { PACE_MS } from './paced';
import { useOpeningLosses } from './useOpeningLosses';
import { getLocale, t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { useOpeningGames } from './useOpeningGames';
import { MAX_LOOKUPS, useInsights } from './useInsights';
import type { ExplorerDb } from './explorer';

const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'classical', 'daily'] as const;
const PAGE = 25;
const GAME_PAGE = 20;
const pct = (x: number) => new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(x);
const num1 = (x: number) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(x);
const sideName = (s: Side) => t(s === 'w' ? 'repertoire.white' : 'repertoire.black');
const moveNo = (n: PositionNode) => Math.ceil(n.ply / 2) || 1;

type Column<T> = { key: string; label: string; title?: string; sort: (r: T) => number | string; cell: (r: T) => ReactNode };

/** A table sorted by any column; clicking a header sorts by it, again reverses. */
function SortTable<T>({ rows, columns, initial, rowKey, onOpen, label, detail }: { rows: readonly T[]; columns: Column<T>[]; initial: string; rowKey: (r: T) => string; onOpen: (r: T) => void; label: string; detail?: (r: T) => ReactNode }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const [shown, setShown] = useState(PAGE);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0]!;
    const out = [...rows].sort((a, b) => {
      const x = col.sort(a);
      const y = col.sort(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -c : c;
    });
    return out;
  }, [rows, columns, sort]);
  return (
    <>
      <div className="table-scroll">
        <table className="games-table insight-table" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined} title={c.title}>
                  <button type="button" className="link" onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, shown).map((r) => (
              <Fragment key={rowKey(r)}>
                <tr className={`clickable${detail ? ' has-detail' : ''}`} onClick={() => onOpen(r)}>
                  {columns.map((c) => (
                    <td key={c.key}>{c.cell(r)}</td>
                  ))}
                </tr>
                {detail && (
                  <tr className="clickable detail-row" onClick={() => onOpen(r)}>
                    <td colSpan={columns.length} className="small">
                      {detail(r)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)}>
          {t('insights.showMore', { n: Math.min(PAGE, sorted.length - shown) })}
        </button>
      )}
    </>
  );
}

const lineCell = (n: PositionNode) => (
  <span>
    <strong dir="ltr">{lastMove(n) || t('insights.start')}</strong> <span className="small muted">{sideName(n.colour)}</span>
    <br />
    <span className="small muted" dir="ltr">
      {orderLine(n.orders[0]?.sans ?? [])}
    </span>
  </span>
);

function spotColumns(): Column<WeakSpot>[] {
  return [
    { key: 'move', label: t('insights.col.move'), sort: (r) => r.node.ply, cell: (r) => moveNo(r.node) },
    { key: 'position', label: t('insights.col.position'), sort: (r) => orderLine(r.node.orders[0]?.sans ?? []), cell: (r) => lineCell(r.node) },
    { key: 'reached', label: t('insights.col.reached'), title: t('insights.col.reachedHelp'), sort: (r) => r.reached, cell: (r) => `${pct(r.reached)} (${r.node.outcome.games})` },
    { key: 'lost', label: t('insights.col.lost'), sort: (r) => r.lost, cell: (r) => pct(r.lost) },
    { key: 'score', label: t('insights.col.score'), title: t('insights.col.scoreHelp'), sort: (r) => r.score - r.before, cell: (r) => <span dir="ltr">{pct(r.before)} → {pct(r.score)}</span> },
    { key: 'by', label: t('insights.col.by'), sort: (r) => r.movedBy, cell: (r) => t(r.movedBy === 'you' ? 'insights.byYou' : 'insights.byOpponent') },
    { key: 'points', label: t('insights.col.pointsLost'), title: t('insights.col.pointsLostHelp'), sort: (r) => r.pointsLost, cell: (r) => num1(r.pointsLost) },
  ];
}

/** Hides a finding ("Not a problem"); the button does not open the row. */
const hideCell = (onHide: () => void) => (
  <button
    type="button"
    className="link small nowrap"
    title={t('insights.hideHelp')}
    onClick={(e) => {
      e.stopPropagation();
      onHide();
    }}
  >
    {t('insights.hide')}
  </button>
);

const evalText = (s: EngineScore | undefined) => (s ? formatScore(s) : '—');

function improvementColumns(evalAfter: (n: PositionNode, uci: string) => EngineScore | undefined, onHide: (r: Improvement) => void): Column<Improvement>[] {
  const yourDb = (r: Improvement) => r.yoursDb?.score ?? -1;
  return [
    { key: 'move', label: t('insights.col.move'), sort: (r) => r.node.ply, cell: (r) => moveNo(r.node) },
    { key: 'position', label: t('insights.col.position'), sort: (r) => orderLine(r.node.orders[0]?.sans ?? []), cell: (r) => lineCell(r.node) },
    { key: 'reached', label: t('insights.col.reached'), title: t('insights.col.reachedHelp'), sort: (r) => r.reached, cell: (r) => `${pct(r.reached)} (${r.node.outcome.games})` },
    { key: 'yours', label: t('insights.col.yourMove'), sort: (r) => r.yours.outcome.games, cell: (r) => <span dir="ltr">{r.yours.san} <span className="small muted">×{r.yours.outcome.games}</span></span> },
    { key: 'yourScore', label: t('insights.col.yourScore'), title: t('insights.col.yourScoreHelp'), sort: (r) => scoreOf(r.yours.outcome), cell: (r) => pct(scoreOf(r.yours.outcome)) },
    { key: 'lost', label: t('insights.col.lostWith'), sort: (r) => r.lost, cell: (r) => pct(r.lost) },
    { key: 'dbYours', label: t('insights.col.dbYours'), title: t('insights.col.dbYoursHelp'), sort: yourDb, cell: (r) => (r.yoursDb ? pct(r.yoursDb.score) : <span className="muted" title={t('insights.col.rareHelp')}>{t('insights.col.rare')}</span>) },
    { key: 'better', label: t('insights.col.better'), sort: (r) => r.better.san, cell: (r) => <strong dir="ltr">{r.better.san}</strong> },
    { key: 'dbBetter', label: t('insights.col.dbBetter'), sort: (r) => r.better.score, cell: (r) => pct(r.better.score) },
    { key: 'gain', label: t('insights.col.gain'), title: t('insights.col.gainHelp'), sort: (r) => r.gain, cell: (r) => `+${pct(r.gain)}` },
    { key: 'points', label: t('insights.col.pointsToGain'), title: t('insights.col.pointsToGainHelp'), sort: (r) => r.pointsToGain, cell: (r) => num1(r.pointsToGain) },
    {
      key: 'engine',
      label: t('insights.col.engine'),
      title: t('insights.col.engineHelp'),
      sort: (r) => {
        const a = evalAfter(r.node, r.yours.uci);
        const b = evalAfter(r.node, r.better.uci);
        return a && b ? winFor(b, r.node.colour) - winFor(a, r.node.colour) : -2;
      },
      cell: (r) => {
        const chances = (s: EngineScore | undefined) => (s ? pct(winFor(s, r.node.colour)) : '—');
        const a = evalAfter(r.node, r.yours.uci);
        const b = evalAfter(r.node, r.better.uci);
        return (
          <span dir="ltr" className="nowrap" title={`${evalText(a)} → ${evalText(b)}`}>
            {chances(a)} → {chances(b)}
          </span>
        );
      },
    },
    { key: 'hide', label: '', sort: () => 0, cell: (r) => hideCell(() => onHide(r)) },
  ];
}

const improvementSentence = (imp: Improvement) =>
  t(imp.basis === 'database' ? 'insights.suggestDb' : 'insights.suggestYours', {
    games: tn('insights.nGames', imp.yours.outcome.games),
    yours: imp.yours.san,
    better: imp.better.san,
    yourScore: pct(imp.basis === 'database' ? imp.yoursDb!.score : scoreOf(imp.yours.outcome)),
    betterScore: pct(imp.better.score),
    gain: pct(imp.gain),
    points: num1(imp.pointsToGain),
  });

type LossRow = OpeningLoss & { worst: LossMove };

const fenBefore = (l: LossRow) => walkGame(l.game).fens[l.worst.ply - 1]!;
const bestSan = (l: LossRow) => (l.worst.best ? sanOf(fenBefore(l), l.worst.best) : null);

function lossColumns(onHide: (r: LossRow) => void, askedBefore: (r: LossRow) => boolean): Column<LossRow>[] {
  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' });
  return [
    { key: 'date', label: t('insights.g.date'), sort: (r) => r.game.playedAt, cell: (r) => <span className="nowrap">{date.format(new Date(r.game.playedAt))}</span> },
    {
      key: 'opponent',
      label: t('insights.g.opponent'),
      sort: (r) => r.game.opponentRating ?? 0,
      cell: (r) => (
        <span>
          <bdi>{r.game.userColour === 'w' ? r.game.black : r.game.white}</bdi>
          {r.game.opponentRating ? ` (${r.game.opponentRating})` : ''}
          <br />
          <span className="small muted">
            {sideName(r.game.userColour)} · {r.game.timeClass ?? ''}
          </span>
        </span>
      ),
    },
    {
      key: 'result',
      label: t('insights.result'),
      sort: (r) => userScore(r.game) ?? 0,
      cell: (r) => {
        const x = resultOf(r.game);
        return <span className={x === 'won' ? 'good-text' : x === 'lost' ? 'bad-text' : ''}>{t(`insights.${x}`)}</span>;
      },
    },
    {
      key: 'move',
      label: t('loss.col.move'),
      sort: (r) => r.worst.ply,
      cell: (r) => {
        const l = dropLabel(r.worst.drop);
        return (
          <span dir="ltr" className="nowrap">
            <strong>{moveLabel(r.worst.ply, r.worst.san)}</strong>
            {l ? <span className={l === 'inaccuracy' ? '' : 'bad-text'}> {LOSS_SUFFIX[l]}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'chances',
      label: t('loss.col.chances'),
      title: t('loss.col.chancesHelp'),
      sort: (r) => r.worst.afterWin,
      cell: (r) => (
        <span dir="ltr" className="nowrap">
          {pct(r.worst.beforeWin)} → {pct(r.worst.afterWin)}
          <br />
          <span className="small muted">
            {formatScore(r.worst.before)} → {formatScore(r.worst.after)}
          </span>
        </span>
      ),
    },
    { key: 'drop', label: t('loss.col.drop'), title: t('loss.col.dropHelp'), sort: (r) => r.worst.drop, cell: (r) => <strong>−{pct(r.worst.drop)}</strong> },
    {
      key: 'best',
      label: t('loss.col.best'),
      sort: (r) => bestSan(r) ?? '',
      cell: (r) => (
        <span dir="ltr">
          {bestSan(r) ?? (askedBefore(r) ? <span className="muted" title={t('loss.col.bestNone')}>—</span> : <span className="muted" title={t('loss.col.bestUnknown')}>?</span>)}
        </span>
      ),
    },
    { key: 'end', label: t('loss.col.end'), title: t('loss.col.endHelp'), sort: (r) => r.end?.win ?? 0, cell: (r) => (r.end ? pct(r.end.win) : '—') },
    { key: 'hide', label: '', sort: () => 0, cell: (r) => hideCell(() => onHide(r)) },
  ];
}

const LOSS_SUFFIX: Record<DropLabel, string> = { inaccuracy: '?!', mistake: '?', blunder: '??' };

const lossSentence = (r: LossRow) => {
  const best = bestSan(r);
  const l = dropLabel(r.worst.drop);
  return [
    t('loss.sentence', { move: moveLabel(r.worst.ply, r.worst.san), before: pct(r.worst.beforeWin), after: pct(r.worst.afterWin), label: l ? t(`loss.${l}`) : t('loss.small') }),
    r.worst.beforePly !== r.worst.ply - 1 ? t('loss.twoPlies') : '',
    best ? t('loss.bestWas', { best }) : '',
    r.end ? t('loss.endAt', { move: Math.ceil(r.end.ply / 2) || 1, win: pct(r.end.win) }) : '',
  ]
    .filter(Boolean)
    .join(' ');
};

const resultOf = (g: OpeningGame) => {
  const s = userScore(g);
  return s === 1 ? 'won' : s === 0 ? 'lost' : 'drawn';
};

function openGame(g: OpeningGame) {
  if (!g.pgn) return;
  openInAnalyse(parseSingleGame(g.pgn, { source: g.source, sourceUrl: g.url, providerData: { timeClass: g.timeClass } }));
}

/** The games behind a position, filterable by move order and result. */
export function GamesList({ node, tree, onPlay }: { node: PositionNode; tree: GamesTree; onPlay?: (g: OpeningGame) => void }) {
  const [order, setOrder] = useState(-1);
  const [result, setResult] = useState('');
  const [shown, setShown] = useState(GAME_PAGE);
  const orderOf = useMemo(() => {
    const m = new Map<string, number>();
    node.orders.forEach((o, i) => o.gameIds.forEach((id) => m.set(id, i)));
    return m;
  }, [node]);
  const games = (order < 0 ? node.gameIds : node.orders[order]!.gameIds)
    .map((id) => tree.games.get(id)!)
    .filter((g) => !result || resultOf(g) === result)
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' });
  return (
    <section className="stack" aria-labelledby="insight-games">
      <h3 id="insight-games">{tn('insights.gamesHere', node.gameIds.length)}</h3>
      <div className="row">
        <label className="field-inline">
          {t('insights.order')}
          <select value={order} onChange={(e) => setOrder(Number(e.target.value))}>
            <option value={-1}>{t('insights.allOrders')}</option>
            {node.orders.map((o, i) => (
              <option key={i} value={i}>
                #{i + 1} ({o.gameIds.length})
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          {t('insights.result')}
          <select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">{t('insights.allResults')}</option>
            <option value="won">{t('insights.won')}</option>
            <option value="drawn">{t('insights.drawn')}</option>
            <option value="lost">{t('insights.lost')}</option>
          </select>
        </label>
        <span className="small muted">{tn('insights.shownGames', games.length)}</span>
      </div>
      <div className="table-scroll">
        <table className="games-table">
          <thead>
            <tr>
              <th>{t('insights.g.date')}</th>
              <th>{t('insights.g.you')}</th>
              <th>{t('insights.g.opponent')}</th>
              <th>{t('insights.result')}</th>
              <th>{t('insights.g.time')}</th>
              <th>{t('insights.order')}</th>
              <th>
                <span className="sr-only">{t('insights.g.links')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {games.slice(0, shown).map((g) => {
              const r = resultOf(g);
              return (
                <tr key={g.id}>
                  <td>{date.format(new Date(g.playedAt))}</td>
                  <td>
                    {sideName(g.userColour)}
                    {g.userRating ? ` (${g.userRating})` : ''}
                  </td>
                  <td>
                    <bdi>{g.userColour === 'w' ? g.black : g.white}</bdi>
                    {g.opponentRating ? ` (${g.opponentRating})` : ''}
                  </td>
                  <td className={r === 'won' ? 'good-text' : r === 'lost' ? 'bad-text' : ''}>{t(`insights.${r}`)}</td>
                  <td>{g.timeClass ?? ''}</td>
                  <td>#{(orderOf.get(g.id) ?? 0) + 1}</td>
                  <td className="nowrap">
                    {onPlay && (
                      <>
                        <button type="button" className="link" onClick={() => onPlay(g)}>
                          {t('insights.play')}
                        </button>
                        {' · '}
                      </>
                    )}
                    {g.url && (
                      <a href={g.url} target="_blank" rel="noreferrer noopener">
                        {g.source === 'lichess' ? 'Lichess' : 'Chess.com'} ↗
                      </a>
                    )}
                    {g.pgn && (
                      <>
                        {' · '}
                        <button type="button" className="link" onClick={() => openGame(g)}>
                          {t('insights.analyse')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {games.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + GAME_PAGE)}>
          {t('insights.showMore', { n: Math.min(GAME_PAGE, games.length - shown) })}
        </button>
      )}
      {games.some((g) => !g.pgn) && <p className="small muted">{t('insights.noPgn')}</p>}
    </section>
  );
}

/** The numbers behind a position, worked out step by step. */
export function NumbersBlock({ node, tree, onOpen }: { node: PositionNode; tree: GamesTree; onOpen?: (id: string) => void }) {
  const score = scoreOf(node.outcome);
  const shrunk = shrunkScore(node.outcome, node.before);
  const lost = node.outcome.games * (node.before - shrunk);
  return (
    <>
    <p>
      {t('insights.numbersHere', { games: node.outcome.games, share: pct(node.outcome.games / Math.max(1, tree.totals[node.colour])), score: pct(score), lost: pct(lossShare(node.outcome)) })}{' '}
      <span dir="ltr" className="small muted">
        +{node.outcome.wins} ={node.outcome.draws} −{node.outcome.losses}
      </span>
    </p>
    {node.ply > 0 && (
      <>
        <p className="small">{t('insights.numbersBefore', { before: pct(node.before) })}</p>
        <p className="small">{t('insights.numbersShrunk', { k: SHRINK_GAMES, before: pct(node.before), shrunk: pct(shrunk) })}</p>
        <p className="small">
          <strong>{t('insights.pointsLostFormula', { games: node.outcome.games, before: pct(node.before), shrunk: pct(shrunk), points: num1(lost) })}</strong>
        </p>
      </>
    )}
    {node.parents.length > 0 && (
      <p className="small">
        {t('insights.earlier')}{' '}
        {node.parents.map((id, i) => {
          const p = tree.nodes.get(id);
          return p ? (
            <span key={id}>
              {i > 0 && ' · '}
              <button type="button" className="link" disabled={!onOpen} onClick={() => onOpen?.(id)}>
                <span dir="ltr">{lastMove(p) || t('insights.start')}</span>
              </button>
            </span>
          ) : null;
        })}
      </p>
    )}
    </>
  );
}

export type OrderStep = { order: number; ply: number };

/** Every move order that reached a position, with its games; a move can be clicked to show it. */
export function OrdersList({ node, step, onStep }: { node: PositionNode; step?: OrderStep | null; onStep?: (s: OrderStep) => void }) {
  return (
    <ol className="order-list">
      {node.orders.map((o, i) => (
        <li key={i}>
          <span className="small muted">#{i + 1}</span>{' '}
          <span dir="ltr" className="order-moves">
            {o.sans.map((san, j) => (
              <button key={j} type="button" className={`link move-chip${step?.order === i && step.ply === j + 1 ? ' current' : ''}`} disabled={!onStep} onClick={() => onStep?.({ order: i, ply: j + 1 })}>
                {j % 2 === 0 ? `${j / 2 + 1}. ` : ''}
                {san}
              </button>
            ))}
          </span>{' '}
          <span className="small">
            · {tn('insights.nGames', o.gameIds.length)} · {t('insights.scoreLost', { score: pct(scoreOf(o.outcome)), lost: pct(lossShare(o.outcome)) })}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The moves played next from a position, with their results. */
export function NextTable({ node, onPick }: { node: PositionNode; onPick: (m: NextMove) => void }) {
  return (
    <div className="table-scroll">
      <table className="games-table">
        <thead>
          <tr>
            <th>{t('insights.col.moveSan')}</th>
            <th>{t('insights.col.by')}</th>
            <th>{t('insights.db.games')}</th>
            <th>{t('insights.col.score')}</th>
            <th>{t('insights.col.lost')}</th>
          </tr>
        </thead>
        <tbody>
          {node.next.map((m) => (
            <tr key={m.uci} className="clickable" onClick={() => onPick(m)}>
              <td dir="ltr">
                <button type="button" className="link">
                  {moveLabel(node.ply + 1, m.san)}
                </button>
              </td>
              <td>{t(node.toMove === 'you' ? 'insights.byYou' : 'insights.byOpponent')}</td>
              <td>{m.outcome.games}</td>
              <td>{pct(scoreOf(m.outcome))}</td>
              <td>{pct(lossShare(m.outcome))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Everything behind one position: the numbers, move orders, next moves, database and games. */
function PositionDetail({
  node,
  ins,
  onOpen,
  onBack,
  onPlay,
  onAddFix,
  fixBusy,
}: {
  node: PositionNode;
  ins: ReturnType<typeof useInsights>;
  onOpen: (id: string) => void;
  onBack: () => void;
  onPlay: (g: OpeningGame) => void;
  onAddFix: (imp: Improvement) => void;
  fixBusy: boolean;
}) {
  const tree = ins.tree;
  // The move order played out on the board: [order, plies shown].
  const [step, setStep] = useState<{ order: number; ply: number } | null>(null);
  const shownFen = useMemo(() => {
    if (!step) return node.fen;
    const pos = Chess.default();
    for (const san of node.orders[step.order]!.sans.slice(0, step.ply)) {
      const m = parseSan(pos, san);
      if (!m) break;
      pos.play(m);
    }
    return makeFen(pos.toSetup());
  }, [step, node]);
  const lookup = node.toMove === 'you' ? ins.lookupOf(node) : undefined;
  const improvements = node.toMove === 'you' ? ins.improvementsOf(node) : [];
  const better = improvements[0]?.better;
  const arrows = !step && better ? [{ startSquare: better.uci.slice(0, 2), endSquare: better.uci.slice(2, 4), color: 'rgba(21,120,27,0.8)' }] : [];
  const orientation = node.colour === 'w' ? 'white' : 'black';
  const db = lookup ? dbMoves(lookup.result, node.colour) : [];
  const dbTotal = lookup ? lookup.result.white + lookup.result.draws + lookup.result.black : 0;
  const playedHere = new Map(node.next.map((m) => [m.uci, m]));
  const dbName = ins.db === 'masters' ? t('insights.db.masters') : t('insights.db.lichess', { ratings: ins.lichessFilter.ratings.join(', '), speeds: ins.lichessFilter.speeds.join(', ') });

  return (
    <div className="stack">
      <div className="row">
        <button type="button" onClick={onBack}>
          ← {t('insights.back')}
        </button>
        <h2 className="insight-title">
          <span dir="ltr">{lastMove(node) || t('insights.start')}</span> · {sideName(node.colour)}
        </h2>
      </div>
      <div className="chapter-view">
        <div className="board-col">
          <div className="board-wrap" dir="ltr">
            <Chessboard options={{ id: 'insight-board', position: shownFen, boardOrientation: orientation, allowDragging: false, arrows, lightSquareStyle: { backgroundColor: 'var(--board-light)' }, darkSquareStyle: { backgroundColor: 'var(--board-dark)' } }} />
          </div>
          {step && (
            <p className="small">
              {t('insights.showingOrder', { n: step.order + 1 })}{' '}
              <button type="button" className="link" onClick={() => setStep(null)}>
                {t('insights.backToPosition')}
              </button>
            </p>
          )}
          <p className="small">
            <a href={`${lichessAnalysisUrl(node.fen, orientation)}#explorer`} target="_blank" rel="noreferrer noopener">
              {t('insights.lichessLink')} ↗
            </a>
          </p>
        </div>
        <div className="stack side">
          <section className="panel stack" aria-labelledby="insight-numbers">
            <h3 id="insight-numbers">{t('insights.numbers')}</h3>
            <NumbersBlock node={node} tree={tree} onOpen={onOpen} />
          </section>

          {node.toMove === 'you' && (
            <section className="panel stack" aria-labelledby="insight-db">
              <h3 id="insight-db">{t('insights.database')}</h3>
              {lookup ? (
                <>
                  <p className="small muted">
                    {dbName} · {t('insights.lookedUp', { date: new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(lookup.at)) })}
                  </p>
                  <div className="table-scroll">
                    <table className="games-table">
                      <thead>
                        <tr>
                          <th>{t('insights.col.moveSan')}</th>
                          <th>{t('insights.db.games')}</th>
                          <th dir="ltr">W / D / L</th>
                          <th>{t('insights.db.scoreForYou')}</th>
                          <th>{t('insights.db.yours')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {db.map((m) => {
                          const mine = playedHere.get(m.uci);
                          const isBetter = better?.uci === m.uci;
                          return (
                            <tr key={m.uci} className={isBetter ? 'highlight' : undefined}>
                              <td dir="ltr">
                                {isBetter ? <strong>{m.san}</strong> : m.san}
                                {!isMainMove(m, dbTotal, ins.rule) && <span className="small muted"> *</span>}
                              </td>
                              <td>
                                {m.games.toLocaleString(getLocale())} <span className="small muted">({pct(m.games / Math.max(1, dbTotal))})</span>
                              </td>
                              <td dir="ltr" className="small">
                                {pct(m.white / Math.max(1, m.games))} / {pct(m.draws / Math.max(1, m.games))} / {pct(m.black / Math.max(1, m.games))}
                              </td>
                              <td>{pct(m.score)}</td>
                              <td>{mine ? t('insights.db.yoursCount', { n: mine.outcome.games, score: pct(scoreOf(mine.outcome)) }) : ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="small muted">{t('insights.rule', { games: ins.rule.minDbGames, share: pct(ins.rule.minShare), gain: pct(ins.rule.minGain) })}</p>
                  {improvements.length ? (
                    improvements.map((imp) => (
                      <div key={imp.yours.uci} className="stack">
                        <p className="practice-msg">{improvementSentence(imp)}</p>
                        <div>
                          <button type="button" disabled={fixBusy} onClick={() => onAddFix(imp)}>
                            {t('fixes.add', { san: imp.better.san })}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="small">{t('insights.noSuggestion')}</p>
                  )}
                </>
              ) : (
                <div className="row">
                  <button type="button" onClick={() => void ins.lookupOne(node)}>
                    {t('insights.lookUp')}
                  </button>
                  <span className="small muted">{dbName}</span>
                </div>
              )}
              {ins.error && <p className="small fail">{t(`explorer.error.${ins.error}`)}</p>}
            </section>
          )}
        </div>
      </div>

      <section className="panel stack" aria-labelledby="insight-orders">
        <h3 id="insight-orders">{tn('insights.orders', node.orders.length)}</h3>
        <OrdersList node={node} step={step} onStep={setStep} />
      </section>

      {node.next.length > 0 && (
        <section className="panel stack" aria-labelledby="insight-next">
          <h3 id="insight-next">{t('insights.next')}</h3>
          <NextTable node={node} onPick={(m) => tree.nodes.has(m.childId) && onOpen(m.childId)} />
        </section>
      )}

      <div className="panel">
        <GamesList key={node.id} node={node} tree={tree} onPlay={onPlay} />
      </div>
    </div>
  );
}

type List = 'losses' | 'spots' | 'improve';
type Hidden = ReadonlySet<string>;

function readHidden(): Set<string> {
  try {
    return new Set(JSON.parse(getPref('insightsHidden') ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

const lossId = (r: { game: OpeningGame }) => `loss:${r.game.id}`;
const impId = (r: Improvement) => `imp:${r.node.id}|${r.yours.uci}`;

export type InsightsProps = {
  onFetch: () => void;
  /** Adds a one-chapter PGN to the "My fixes" repertoire. */
  onAddFix: (pgn: string, colour: Side) => Promise<void>;
  /** Opens training on "My fixes". */
  onPractise: () => void;
  /** Whether "My fixes" exists yet. */
  hasFixes: boolean;
};

/** Building a fix: the database lookups for the replies, paced like the scans, then the import. */
function useFixBuilder(ins: ReturnType<typeof useInsights>, onAddFix: InsightsProps['onAddFix']) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const live = useRef(true);
  const build = useCallback(
    async (fix: Fix) => {
      setAdded(null);
      setBusy({ done: 0, total: MAX_FIX_LOOKUPS });
      let done = 0;
      const lookup = async (fen: string) => {
        const r = await ins.lookupFen(fen);
        if (r?.fetched) await new Promise((res) => setTimeout(res, PACE_MS));
        return r?.result ?? null;
      };
      try {
        const afterBetter = afterUci(fix.fen, fix.better);
        let replies = afterBetter ? await growReplies(afterBetter, fix.colour, lookup, ins.rule, 0, () => live.current && setBusy({ done: ++done, total: MAX_FIX_LOOKUPS })) : [];
        // No database games this deep: follow the engine's line instead.
        if (!replies.length && fix.line?.[0] === fix.better) replies = linePly(fix.fen, fix.line);
        const title = t('fixes.title', { played: moveLabel(fix.reachedBy.length + 1, fix.played) });
        await onAddFix(fixPgn(fix, replies, title), fix.colour);
        if (live.current) setAdded(sanOf(fix.fen, fix.better));
      } finally {
        if (live.current) setBusy(null);
      }
    },
    [ins, onAddFix],
  );
  return { busy, added, build };
}

/** What was just added to My fixes, with a way to train it now. */
function FixStatus({ fb, onPractise }: { fb: ReturnType<typeof useFixBuilder>; onPractise: () => void }) {
  if (fb.busy) return <p className="small">{t('fixes.building', { done: fb.busy.done, total: fb.busy.total })}</p>;
  if (!fb.added) return null;
  return (
    <p className="practice-msg">
      {t('fixes.added', { san: fb.added })}{' '}
      <button type="button" className="link" onClick={onPractise}>
        {t('fixes.practise')}
      </button>
    </p>
  );
}

/** Weak spots and better moves from your own games, each with the games and move orders behind it. */
export function InsightsView({ onFetch, onAddFix, onPractise, hasFixes }: InsightsProps) {
  useT();
  const og = useOpeningGames();
  const ins = useInsights(og.games);
  const f = ins.filters;
  const losses = useOpeningLosses(ins.filtered, f.maxMove * 2, f.scanGames);
  const fb = useFixBuilder(ins, onAddFix);
  const [list, setListState] = useState<List>(() => {
    const v = getPref('insightsList');
    return v === 'spots' || v === 'improve' ? v : 'losses';
  });
  const setList = (v: List) => {
    setListState(v);
    setPref('insightsList', v);
  };
  const [hidden, setHiddenState] = useState<Hidden>(readHidden);
  const [showHidden, setShowHidden] = useState(false);
  const hide = useCallback((id: string) => {
    setHiddenState((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPref('insightsHidden', next.size ? JSON.stringify([...next]) : null);
      return next;
    });
  }, []);
  // The positions opened, so Back returns through them; or a game in the player.
  const [path, setPath] = useState<string[]>([]);
  const [player, setPlayer] = useState<{ gameId: string; ply: number } | null>(null);

  const evalAfter = useCallback(
    (n: PositionNode, uci: string) => {
      const fen = afterUci(n.fen, uci);
      if (!fen) return undefined;
      return losses.cloud.get(keyOfFen(fen))?.score;
    },
    [losses.cloud],
  );
  const spotCols = useMemo(() => spotColumns(), []);
  const impCols = useMemo(() => improvementColumns(evalAfter, (r) => hide(impId(r))), [evalAfter, hide]);
  const askedBefore = useCallback((r: LossRow) => losses.cloud.has(keyOfFen(fenBefore(r))), [losses.cloud]);
  const lossCols = useMemo(() => lossColumns((r) => hide(lossId(r)), askedBefore), [hide, askedBefore]);

  const minDrop = DROP[f.minDrop];
  const lossRows = useMemo(
    () =>
      losses.losses.filter(
        (l): l is LossRow => !!l.worst && l.worst.drop >= minDrop && (!f.notWon || userScore(l.game) !== 1) && showHidden === hidden.has(lossId(l)),
      ),
    [losses.losses, minDrop, f.notWon, hidden, showHidden],
  );
  const hiddenLosses = losses.losses.filter((l) => hidden.has(lossId(l))).length;
  const impRows = useMemo(() => ins.improvements.filter((r) => showHidden === hidden.has(impId(r))), [ins.improvements, hidden, showHidden]);
  const hiddenImps = ins.improvements.length - ins.improvements.filter((r) => !hidden.has(impId(r))).length;

  // Engine evaluations for the better-moves table: the position after your move and after the better one.
  const impEvalTodo = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of ins.improvements) {
      for (const u of [r.yours.uci, r.better.uci]) {
        const fen = afterUci(r.node.fen, u);
        const k = fen ? keyOfFen(fen) : '';
        if (fen && k && !losses.cloud.has(k)) out.set(k, fen);
      }
    }
    return [...out].map(([key, fen]) => ({ key, fen }));
  }, [ins.improvements, losses.cloud]);

  if (!og.loaded) return null;
  if (!og.games.length) {
    return (
      <div className="panel stack">
        <p>{t('insights.noGames')}</p>
        <button type="button" onClick={onFetch}>
          {t('insights.goFetch')}
        </button>
      </div>
    );
  }

  const dbName = ins.db === 'masters' ? t('insights.db.masters') : t('insights.db.lichess', { ratings: ins.lichessFilter.ratings.join(', '), speeds: ins.lichessFilter.speeds.join(', ') });
  const playing = player ? ins.filtered.find((g) => g.id === player.gameId) ?? og.games.find((g) => g.id === player.gameId) : undefined;
  if (player && playing) {
    return (
      <div className="stack">
        <FixStatus fb={fb} onPractise={onPractise} />
        <GamePlayer
          key={`${player.gameId}@${player.ply}`}
          game={playing}
          startPly={player.ply}
          maxPly={f.maxMove * 2}
          losses={losses}
          lookupFen={ins.lookupFen}
          cachedFen={ins.cachedFen}
          dbName={dbName}
          rule={ins.rule}
          fixBusy={!!fb.busy}
          onAddFix={(fix) => void fb.build(fix)}
          onBack={() => setPlayer(null)}
        />
      </div>
    );
  }

  const openId = path[path.length - 1];
  const open = openId ? ins.tree.nodes.get(openId) : undefined;
  if (open) {
    return (
      <div className="stack">
        <FixStatus fb={fb} onPractise={onPractise} />
        <PositionDetail
          key={open.id}
          node={open}
          ins={ins}
          onOpen={(id) => setPath((p) => [...p, id])}
          onBack={() => setPath((p) => p.slice(0, -1))}
          onPlay={(g) => setPlayer({ gameId: g.id, ply: open.ply })}
          onAddFix={(imp) => void fb.build(improvementFix(imp))}
          fixBusy={!!fb.busy}
        />
      </div>
    );
  }

  const counted = ins.tree.totals.w + ins.tree.totals.b;
  const dbs: ExplorerDb[] = ['lichess', 'masters'];
  const minutes = (n: number) => Math.max(1, Math.round((n * PACE_MS) / 60_000));
  const hiddenToggle = (n: number) =>
    (n > 0 || showHidden) && (
      <button type="button" className="link small" onClick={() => setShowHidden((v) => !v)}>
        {showHidden ? t('insights.showFindings') : tn('insights.showHidden', n)}
      </button>
    );
  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="insights-title">
        <h2 id="insights-title">{t('insights.title')}</h2>
        <p className="small muted">{t('insights.help')}</p>
        <div className="row">
          <label className="field-inline">
            {t('insights.colour')}
            <select value={f.colour} onChange={(e) => ins.setFilters({ colour: e.target.value as '' | Side })}>
              <option value="">{t('insights.both')}</option>
              <option value="w">{sideName('w')}</option>
              <option value="b">{sideName('b')}</option>
            </select>
          </label>
          <label className="field-inline">
            {t('games.timeClass')}
            <select value={f.timeClass} onChange={(e) => ins.setFilters({ timeClass: e.target.value })}>
              <option value="">{t('games.allTimeClasses')}</option>
              {TIME_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {t(`games.tc.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline">
            {t('insights.upToMove')}
            <input type="number" min={2} max={40} value={f.maxMove} onChange={(e) => ins.setFilters({ maxMove: Math.max(2, Math.min(40, Number(e.target.value) || 15)) })} />
          </label>
          {list !== 'losses' && (
            <label className="field-inline">
              {t('insights.minGames')}
              <input type="number" min={1} max={50} value={f.minGames} onChange={(e) => ins.setFilters({ minGames: Math.max(1, Math.min(50, Number(e.target.value) || 3)) })} />
            </label>
          )}
        </div>
        <p className="small muted">{t('insights.counted', { n: counted, w: ins.tree.totals.w, b: ins.tree.totals.b })}</p>
        <div className="row">
          <div className="segmented" role="group" aria-label={t('insights.title')}>
            <button type="button" aria-pressed={list === 'losses'} onClick={() => setList('losses')}>
              {t('loss.title')} ({lossRows.length})
            </button>
            <button type="button" aria-pressed={list === 'spots'} onClick={() => setList('spots')}>
              {t('insights.spots')} ({ins.spots.length})
            </button>
            <button type="button" aria-pressed={list === 'improve'} onClick={() => setList('improve')}>
              {t('insights.improvements')} ({impRows.length})
            </button>
          </div>
          {hasFixes && (
            <button type="button" onClick={onPractise}>
              {t('fixes.practiseAll')}
            </button>
          )}
        </div>
      </section>

      {list === 'losses' ? (
        <section className="panel stack" aria-labelledby="insights-losses">
          <h2 id="insights-losses">{t('loss.title')}</h2>
          <p className="small muted">{t('loss.help')}</p>
          <div className="row">
            <label className="field-inline">
              {t('loss.games')}
              <select value={f.scanGames} onChange={(e) => ins.setFilters({ scanGames: Number(e.target.value) })}>
                {[50, 100, 200, 500, 2000].map((n) => (
                  <option key={n} value={n}>
                    {n === 2000 ? t('loss.allGames') : t('loss.lastN', { n })}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-inline">
              {t('loss.atLeast')}
              <select value={f.minDrop} onChange={(e) => ins.setFilters({ minDrop: e.target.value as DropLabel })}>
                {(Object.keys(DROP) as DropLabel[]).map((k) => (
                  <option key={k} value={k}>
                    {t(`loss.${k}`)} (−{pct(DROP[k])})
                  </option>
                ))}
              </select>
            </label>
            <label className="field-inline">
              <input type="checkbox" checked={f.notWon} onChange={(e) => ins.setFilters({ notWon: e.target.checked })} />
              {t('loss.notWon')}
            </label>
          </div>
          <div className="row">
            {losses.scan ? (
              <>
                <span className="small">{losses.scan.waiting ? t('insights.scanWaiting', { done: losses.scan.done, total: losses.scan.total }) : t('insights.scanning', { done: losses.scan.done, total: losses.scan.total })}</span>
                <button type="button" onClick={losses.stopScan}>
                  {t('insights.stop')}
                </button>
              </>
            ) : (
              losses.loaded &&
              losses.todo > 0 && (
                <button type="button" className="primary" onClick={() => void losses.startScan()}>
                  {tn('loss.scan', losses.todo, { min: minutes(losses.todo) })}
                </button>
              )
            )}
            {hiddenToggle(hiddenLosses)}
          </div>
          <p className="small muted">
            {t('loss.coverage', {
              games: losses.recent.length,
              known: losses.losses.reduce((a, l) => a + l.known, 0),
              wanted: losses.losses.reduce((a, l) => a + l.wanted, 0),
            })}
          </p>
          {losses.error && <p className="small fail">{t(`explorer.error.${losses.error}`)}</p>}
          {lossRows.length ? (
            <SortTable
              rows={lossRows}
              columns={lossCols}
              initial="drop"
              rowKey={(r) => r.game.id}
              onOpen={(r) => setPlayer({ gameId: r.game.id, ply: r.worst.ply - 1 })}
              label={t('loss.title')}
              detail={lossSentence}
            />
          ) : (
            <p>{losses.todo && !losses.scan ? t('loss.notScanned') : t('loss.none')}</p>
          )}
        </section>
      ) : list === 'spots' ? (
        <section className="panel stack" aria-labelledby="insights-spots">
          <h2 id="insights-spots">{t('insights.spots')}</h2>
          <p className="small muted">{t('insights.spotsHelp', { k: SHRINK_GAMES })}</p>
          {ins.spots.length ? (
            <SortTable rows={ins.spots} columns={spotCols} initial="points" rowKey={(r) => r.node.id} onOpen={(r) => setPath([r.node.id])} label={t('insights.spots')} />
          ) : (
            <p>{t('insights.noSpots')}</p>
          )}
        </section>
      ) : (
        <section className="panel stack" aria-labelledby="insights-improve">
          <h2 id="insights-improve">{t('insights.improvements')}</h2>
          <p className="small muted">{t('insights.improveHelp')}</p>
          <div className="row">
            <div className="segmented" role="group" aria-label={t('insights.database')}>
              {dbs.map((d) => (
                <button key={d} type="button" aria-pressed={ins.db === d} disabled={d === 'lichess' && !ins.hasToken} onClick={() => ins.chooseDb(d)}>
                  {t(`explorer.db.${d}`)}
                </button>
              ))}
            </div>
            {ins.scan ? (
              <>
                <span className="small">{ins.scan.waiting ? t('insights.scanWaiting', { done: ins.scan.done, total: ins.scan.total }) : t('insights.scanning', { done: ins.scan.done, total: ins.scan.total })}</span>
                <button type="button" onClick={ins.stopScan}>
                  {t('insights.stop')}
                </button>
              </>
            ) : (
              ins.looked < ins.points.length && (
                <button type="button" onClick={() => void ins.startScan()}>
                  {t('insights.scan', { n: ins.points.length - ins.looked })}
                </button>
              )
            )}
            {!losses.scan && impEvalTodo.length > 0 && (
              <button type="button" onClick={() => void losses.lookupMany(impEvalTodo)}>
                {t('insights.evalScan', { n: impEvalTodo.length })}
              </button>
            )}
            {losses.scan && list === 'improve' && <span className="small">{t('insights.scanning', { done: losses.scan.done, total: losses.scan.total })}</span>}
            {hiddenToggle(hiddenImps)}
          </div>
          <p className="small muted">
            {dbName}
            {ins.lichessFilter.rating !== null && ins.db === 'lichess' && <> · {t('insights.yourRating', { rating: ins.lichessFilter.rating })}</>}
            {' · '}
            {t('insights.looked', { done: ins.looked, total: ins.points.length, max: MAX_LOOKUPS })}
          </p>
          {!ins.hasToken && <p className="small">{t('insights.needToken')}</p>}
          <p className="small muted">{t('insights.rule', { games: ins.rule.minDbGames, share: pct(ins.rule.minShare), gain: pct(ins.rule.minGain) })}</p>
          {ins.error && <p className="small fail">{t(`explorer.error.${ins.error}`)}</p>}
          {impRows.length ? (
            <SortTable rows={impRows} columns={impCols} initial="points" rowKey={impId} onOpen={(r) => setPath([r.node.id])} label={t('insights.improvements')} detail={improvementSentence} />
          ) : (
            <p>{ins.looked ? t('insights.noImprovements') : t('insights.notLooked')}</p>
          )}
        </section>
      )}
    </div>
  );
}

/** A fix from a database suggestion: its position, reached by its most common move order. */
function improvementFix(imp: Improvement): Fix {
  const sans = imp.node.orders[0]?.sans ?? [];
  return {
    colour: imp.node.colour,
    fen: imp.node.fen,
    reachedBy: sans,
    played: imp.yours.san,
    better: imp.better.uci,
    why: improvementSentence(imp),
    context: t('fixes.contextDb', { line: sans.length ? orderLine(sans) : t('insights.start'), played: moveLabel(imp.node.ply + 1, imp.yours.san), games: imp.yours.outcome.games, score: pct(scoreOf(imp.yours.outcome)) }),
  };
}
