import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { useMemo, useState, type ReactNode } from 'react';
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
} from '../../core/repertoire/insights';
import type { Side } from '../../core/repertoire/types';
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
function SortTable<T>({ rows, columns, initial, rowKey, onOpen, label }: { rows: readonly T[]; columns: Column<T>[]; initial: string; rowKey: (r: T) => string; onOpen: (r: T) => void; label: string }) {
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
              <tr key={rowKey(r)} className="clickable" onClick={() => onOpen(r)}>
                {columns.map((c) => (
                  <td key={c.key}>{c.cell(r)}</td>
                ))}
              </tr>
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

function improvementColumns(): Column<Improvement>[] {
  return [
    { key: 'move', label: t('insights.col.move'), sort: (r) => r.node.ply, cell: (r) => moveNo(r.node) },
    { key: 'position', label: t('insights.col.position'), sort: (r) => orderLine(r.node.orders[0]?.sans ?? []), cell: (r) => lineCell(r.node) },
    { key: 'reached', label: t('insights.col.reached'), title: t('insights.col.reachedHelp'), sort: (r) => r.reached, cell: (r) => `${pct(r.reached)} (${r.node.outcome.games})` },
    { key: 'lost', label: t('insights.col.lostWith'), sort: (r) => r.lost, cell: (r) => `${pct(r.lost)} (${r.yours.outcome.games})` },
    {
      key: 'change',
      label: t('insights.col.change'),
      sort: (r) => r.yours.san,
      cell: (r) => (
        <span dir="ltr">
          {r.yours.san} → <strong>{r.better.san}</strong>
        </span>
      ),
    },
    { key: 'gain', label: t('insights.col.gain'), title: t('insights.col.gainHelp'), sort: (r) => r.gain, cell: (r) => `+${pct(r.gain)}` },
    { key: 'points', label: t('insights.col.pointsToGain'), title: t('insights.col.pointsToGainHelp'), sort: (r) => r.pointsToGain, cell: (r) => num1(r.pointsToGain) },
  ];
}

const resultOf = (g: OpeningGame) => {
  const s = userScore(g);
  return s === 1 ? 'won' : s === 0 ? 'lost' : 'drawn';
};

function openGame(g: OpeningGame) {
  if (!g.pgn) return;
  openInAnalyse(parseSingleGame(g.pgn, { source: g.source, sourceUrl: g.url, providerData: { timeClass: g.timeClass } }));
}

/** The games behind a position, filterable by move order and result. */
export function GamesList({ node, tree }: { node: PositionNode; tree: GamesTree }) {
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
function PositionDetail({ node, ins, onOpen, onBack }: { node: PositionNode; ins: ReturnType<typeof useInsights>; onOpen: (id: string) => void; onBack: () => void }) {
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
                      <p key={imp.yours.uci} className="practice-msg">
                        {t(imp.basis === 'database' ? 'insights.suggestDb' : 'insights.suggestYours', {
                          yours: imp.yours.san,
                          better: imp.better.san,
                          yourScore: pct(imp.basis === 'database' ? imp.yoursDb!.score : scoreOf(imp.yours.outcome)),
                          betterScore: pct(imp.better.score),
                          gain: pct(imp.gain),
                          games: imp.yours.outcome.games,
                          points: num1(imp.pointsToGain),
                        })}
                      </p>
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
        <GamesList key={node.id} node={node} tree={tree} />
      </div>
    </div>
  );
}

/** Weak spots and better moves from your own games, each with the games and move orders behind it. */
export function InsightsView({ onFetch }: { onFetch: () => void }) {
  useT();
  const og = useOpeningGames();
  const ins = useInsights(og.games);
  const [list, setList] = useState<'spots' | 'improve'>('spots');
  // The positions opened, so Back returns through them.
  const [path, setPath] = useState<string[]>([]);
  const spotCols = useMemo(() => spotColumns(), []);
  const impCols = useMemo(() => improvementColumns(), []);

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

  const openId = path[path.length - 1];
  const open = openId ? ins.tree.nodes.get(openId) : undefined;
  if (open) {
    return <PositionDetail key={open.id} node={open} ins={ins} onOpen={(id) => setPath((p) => [...p, id])} onBack={() => setPath((p) => p.slice(0, -1))} />;
  }

  const f = ins.filters;
  const counted = ins.tree.totals.w + ins.tree.totals.b;
  const dbs: ExplorerDb[] = ['lichess', 'masters'];
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
          <label className="field-inline">
            {t('insights.minGames')}
            <input type="number" min={1} max={50} value={f.minGames} onChange={(e) => ins.setFilters({ minGames: Math.max(1, Math.min(50, Number(e.target.value) || 3)) })} />
          </label>
        </div>
        <p className="small muted">{t('insights.counted', { n: counted, w: ins.tree.totals.w, b: ins.tree.totals.b })}</p>
        <div className="segmented" role="group" aria-label={t('insights.title')}>
          <button type="button" aria-pressed={list === 'spots'} onClick={() => setList('spots')}>
            {t('insights.spots')} ({ins.spots.length})
          </button>
          <button type="button" aria-pressed={list === 'improve'} onClick={() => setList('improve')}>
            {t('insights.improvements')} ({ins.improvements.length})
          </button>
        </div>
      </section>

      {list === 'spots' ? (
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
          </div>
          <p className="small muted">
            {ins.db === 'masters' ? t('insights.db.masters') : t('insights.db.lichess', { ratings: ins.lichessFilter.ratings.join(', '), speeds: ins.lichessFilter.speeds.join(', ') })}
            {ins.lichessFilter.rating !== null && ins.db === 'lichess' && <> · {t('insights.yourRating', { rating: ins.lichessFilter.rating })}</>}
            {' · '}
            {t('insights.looked', { done: ins.looked, total: ins.points.length, max: MAX_LOOKUPS })}
          </p>
          {!ins.hasToken && <p className="small">{t('insights.needToken')}</p>}
          <p className="small muted">{t('insights.rule', { games: ins.rule.minDbGames, share: pct(ins.rule.minShare), gain: pct(ins.rule.minGain) })}</p>
          {ins.error && <p className="small fail">{t(`explorer.error.${ins.error}`)}</p>}
          {ins.improvements.length ? (
            <SortTable rows={ins.improvements} columns={impCols} initial="points" rowKey={(r) => `${r.node.id}|${r.yours.uci}`} onOpen={(r) => setPath([r.node.id])} label={t('insights.improvements')} />
          ) : (
            <p>{ins.looked ? t('insights.noImprovements') : t('insights.notLooked')}</p>
          )}
        </section>
      )}
    </div>
  );
}
