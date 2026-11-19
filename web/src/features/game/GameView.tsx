import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chessboard } from 'react-chessboard';
import { gameTitle } from '../../core/chess/pgn';
import { lichessAnalysisUrl } from '../../core/chess/links';
import { fenAfterLine, squarePosition, uciLineToSan } from '../../core/chess/lines';
import { getPref, setPref } from '../../storage/prefs';
import { MoveFeedback } from './MoveFeedback';
import { positionsOf, type GameRecord } from '../../core/chess/types';
import type { EngineLine, EngineScore } from '../../core/engine/types';
import { AVAILABLE_FLAVOURS, ENGINE_BUILDS, type EngineFlavour } from '../../core/engine/workerTransport';
import { expectedScore, formatScore } from '../../core/scoring/score';
import { useEngine } from '../../app/EngineContext';
import { CategoryBadge } from '../../components/CategoryBadge';
import { Icon, Spinner } from '../../components/Icon';
import { EvalBar } from '../../components/EvalBar';
import { EvalChart } from '../../components/EvalChart';
import { MoveList, type MoveFilter } from '../../components/MoveList';
import { Summary } from '../../components/Summary';
import { BrillianceDetails, EvidenceModal, GreatDetails } from '../../components/BrillianceExplainer';
import { annotatedPgn, analysisJson, downloadText, safeFilename } from '../analysis/export';
import { PRESETS, type GameAnalysis, type PresetId } from '../analysis/types';
import { useGameAnalysis } from '../analysis/useGameAnalysis';
import { useMoveExplainer, whyBadKey } from '../explain/useMoveExplainer';
import { tOr } from '../../i18n';
import { useT } from '../../i18n/react';

type PvPreview = { baseFen: string; moves: string[]; index: number };


function useBoardWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export type GameViewProps = {
  game: GameRecord;
  /** Extra actions (e.g. cloud analysis) rendered under the analysis controls. */
  renderExtra?: (ctx: { game: GameRecord; analysis: GameAnalysis | null; setAnalysis: (a: GameAnalysis) => void }) => ReactNode;
};

/** Arrow colours on the main board. */
const ARROW = {
  best: 'rgba(60,125,58,0.85)',
  threat: 'rgba(179,38,30,0.85)',
  played: 'rgba(208,102,28,0.85)',
};

export function GameView({ game, renderExtra }: GameViewProps) {
  const { t, locale } = useT();
  const positions = useMemo(() => positionsOf(game), [game]);
  // The parent keys this component by game id, so state resets when the game changes.
  const [pos, setPos] = useState(0);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [filter, setFilter] = useState<MoveFilter>('all');
  const [pv, setPv] = useState<PvPreview | null>(null);
  // Best moves stay hidden until asked for, so the user can think first.
  const [reveal, setReveal] = useState<{ pos: number; better: boolean; hint: boolean }>({ pos: 0, better: false, hint: false });
  const [alwaysShow, setAlwaysShowState] = useState(() => getPref('alwaysShowBest') === '1');
  const setAlwaysShow = (v: boolean) => {
    setAlwaysShowState(v);
    setPref('alwaysShowBest', v ? '1' : null);
  };
  const [explainPly, setExplainPly] = useState<number | null>(null);
  // "Why was this bad?" shows the position before the move on the main board (resets on navigation).
  const [beforeAt, setBeforeAt] = useState<number | null>(null);
  // Whether the running analysis was started from the "Analyse again" panel at the end of the page.
  const [fromBottom, setFromBottom] = useState(false);
  const { analysis, setAnalysis, running, start, cancel } = useGameAnalysis(game);
  const engine = useEngine();
  const explainer = useMoveExplainer();
  const { ref: boardRef, width: boardWidth } = useBoardWidth();

  const go = useCallback(
    (p: number) => {
      setPv(null);
      setBeforeAt(null);
      setPos(Math.max(0, Math.min(positions.length - 1, p)));
    },
    [positions.length],
  );

  /** One step back/forward: inside an engine-line preview when one is open, else through the game. */
  const step = useCallback(
    (delta: 1 | -1) => {
      if (pv) {
        const index = Math.max(0, Math.min(pv.moves.length, pv.index + delta));
        setPv({ ...pv, index });
      } else go(pos + delta);
    },
    [pv, go, pos],
  );

  // Horizontal swipe on the board steps through moves (phones).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') go(pos - 1);
      else if (e.key === 'ArrowRight') go(pos + 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(positions.length - 1);
      else if (e.key === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, pos, positions.length]);

  const lastMove = pos > 0 ? game.moves[pos - 1] : undefined;
  const lastAnalysis = pos > 0 ? analysis?.moves[pos - 1] : undefined;
  const nextAnalysis = analysis?.moves[pos]; // analysis of the position on the board (pre-move for ply pos+1)
  const currentLines: EngineLine[] = useMemo(() => nextAnalysis?.lines ?? [], [nextAnalysis]);
  const lastWhyBad = lastMove ? explainer.whyBad[whyBadKey(lastMove)] : undefined;
  const whyBadReport = lastWhyBad?.status === 'done' ? lastWhyBad.value : undefined;
  const showBefore = !pv && beforeAt === pos && !!lastMove && !!whyBadReport;
  const fen = pv ? fenAfterLine(pv.baseFen, pv.moves.slice(0, pv.index)) : showBefore ? lastMove!.fenBefore : positions[pos]!;

  // Reveals reset whenever the shown position changes.
  const revealBetter = reveal.pos === pos && reveal.better;
  const revealHint = reveal.pos === pos && reveal.hint;
  const showHintArrow = (revealHint || alwaysShow) && !pv;

  const boardThreat = explainer.threats[positions[pos]!];
  const arrows = useMemo(() => {
    const out: { startSquare: string; endSquare: string; color: string }[] = [];
    const add = (uci: string | undefined, color: string) => {
      if (uci) out.push({ startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color });
    };
    if (pv) return out;
    if (showBefore && whyBadReport && lastMove) {
      // Before the move: the opponent's threats (red), the move played (orange), the better move (green).
      for (const t of whyBadReport.threats) add(t.uci, ARROW.threat);
      add(lastMove.uci, ARROW.played);
      add(whyBadReport.bestUci, ARROW.best);
      return out;
    }
    if (showHintArrow) add(currentLines[0]?.pvUci[0], ARROW.best);
    if (boardThreat?.status === 'done') for (const t of boardThreat.value?.real ?? []) add(t.uci, ARROW.threat);
    return out;
  }, [showHintArrow, currentLines, boardThreat, pv, showBefore, whyBadReport, lastMove]);

  // Category badge on the square where the moved piece landed.
  const badge =
    !pv && !showBefore && lastMove && lastAnalysis?.category
      ? { ...squarePosition(lastMove.uci.slice(2, 4), orientation), category: lastAnalysis.category }
      : null;

  const squareStyles = useMemo(() => {
    if (!lastMove || pv || showBefore) return {};
    const color = lastAnalysis?.category ? `var(--cat-${lastAnalysis.category})` : 'var(--accent)';
    const style = { boxShadow: `inset 0 0 0 4px ${color}` };
    return { [lastMove.uci.slice(0, 2)]: { ...style, opacity: 0.9 }, [lastMove.uci.slice(2, 4)]: style };
  }, [lastMove, lastAnalysis, pv, showBefore]);

  const progressPct = analysis ? Math.round((analysis.progress.done / Math.max(1, analysis.progress.total)) * 100) : 0;
  const title = gameTitle(game);
  const explainMove = explainPly !== null ? analysis?.moves[explainPly - 1] : undefined;
  const analysisDone = analysis?.phase === 'done';
  // Before the first full analysis the big button sits under the board; re-runs start from the end of the page.
  const showAnalyseBlock = running ? !fromBottom : !analysisDone;
  const busyLabel = running
    ? `${progressPct}%`
    : boardThreat?.status === 'running' || lastWhyBad?.status === 'running'
      ? t('board.calculating')
      : null;

  // Tell the user when slow work finishes while the board is off-screen (or the tab is hidden).
  const [toast, setToast] = useState<string | null>(null);
  const boardVisible = useRef(true);
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      boardVisible.current = !!e?.isIntersecting;
      if (e?.isIntersecting) setToast(null);
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [boardRef]);
  const notify = useCallback((text: string) => {
    if (!boardVisible.current) setToast(text);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 10_000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const prevThreat = useRef(boardThreat?.status);
  useEffect(() => {
    const was = prevThreat.current;
    prevThreat.current = boardThreat?.status;
    if (was !== 'running' || boardThreat?.status !== 'done') return;
    const first = boardThreat.value?.real[0];
    notify(first ? t('toast.threatFound', { san: first.san }) : t('toast.noThreat'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable module function
  }, [boardThreat, notify]);

  const prevWhy = useRef(lastWhyBad?.status);
  useEffect(() => {
    const was = prevWhy.current;
    prevWhy.current = lastWhyBad?.status;
    if (was === 'running' && lastWhyBad?.status === 'done') notify(t('toast.whyReady'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable module function
  }, [lastWhyBad, notify]);

  // Page title: progress while analysing, "ready" if it finished in a background tab.
  useEffect(() => {
    document.title = running ? `${progressPct}% · ${t('app.title')}` : t('app.title');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable module function
  }, [running, progressPct, locale]);
  useEffect(() => () => void (document.title = t('app.title')), [t]);
  const prevRunning = useRef(running);
  useEffect(() => {
    const was = prevRunning.current;
    prevRunning.current = running;
    if (!was || running || analysis?.phase !== 'done') return;
    notify(t('toast.analysisReady'));
    if (document.hidden) {
      document.title = `✓ ${t('toast.analysisReady')} · ${t('app.title')}`;
      const onVisible = () => {
        if (!document.hidden) document.title = t('app.title');
      };
      document.addEventListener('visibilitychange', onVisible, { once: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable module function
  }, [running, analysis?.phase, notify]);

  return (
    <div className="stack">
      <div className="game-title row">
        <h2 style={{ margin: 0, fontSize: 18, flex: 1, minWidth: 0 }}>
          <bdi>{title}</bdi>
        </h2>
        {game.sourceUrl && (
          <a href={game.sourceUrl} target="_blank" rel="noreferrer noopener" className="small hide-mobile">
            {t('game.openSource')} ↗
          </a>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
          aria-label={t('game.flip')}
          title={t('game.flip')}
        >
          <Icon name="flip" size={18} />
        </button>
        <a
          className="button-link"
          href={lichessAnalysisUrl(fen, orientation)}
          target="_blank"
          rel="noreferrer noopener"
          title={t('game.lichessBoard')}
          dir="ltr"
        >
          Lichess ↗
        </a>
      </div>

      <div className="review">
        <div className="eval-bar-v">
          <EvalBar score={pv ? undefined : analysis?.positionEvals[showBefore ? pos - 1 : pos]} orientation={orientation} height={boardWidth} />
        </div>
        <div className="board-col">
          <EvalStrip score={pv ? undefined : analysis?.positionEvals[showBefore ? pos - 1 : pos]} />
          <div ref={boardRef} className="board-wrap" dir="ltr" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <Chessboard
              options={{
                id: 'review-board',
                position: fen,
                boardOrientation: orientation,
                allowDragging: false,
                arrows,
                squareStyles,
                lightSquareStyle: { backgroundColor: 'var(--board-light)' },
                darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
                animationDurationInMs: 150,
              }}
            />
            {badge && (
              <div className="square-badge" style={{ left: `${badge.left}%`, top: `${badge.top}%` }} aria-hidden="true">
                <CategoryBadge category={badge.category} />
              </div>
            )}
            {busyLabel && (
              <div className="board-busy" aria-hidden="true">
                <Spinner /> {busyLabel}
              </div>
            )}
          </div>
          <div className="controls" role="group" aria-label={t('game.nav')} dir="ltr">
            <button type="button" onClick={() => go(0)} aria-label={t('game.first')} title={t('game.first')} disabled={pos === 0 && !pv}>
              <Icon name="first" />
            </button>
            <button type="button" onClick={() => step(-1)} aria-label={t('game.prev')} title={t('game.prev')} disabled={pos === 0 && !pv}>
              <Icon name="prev" />
            </button>
            <button type="button" onClick={() => step(1)} aria-label={t('game.next')} title={t('game.next')} disabled={pos === positions.length - 1 && !pv}>
              <Icon name="next" />
            </button>
            <button type="button" onClick={() => go(positions.length - 1)} aria-label={t('game.last')} title={t('game.last')} disabled={pos === positions.length - 1 && !pv}>
              <Icon name="last" />
            </button>
          </div>
          {showAnalyseBlock && (
            <div className="analyse-cta" aria-live="polite">
              {running ? (
                <div className="analyse-progress">
                  <div
                    className="analyse-progress-bar"
                    role="progressbar"
                    aria-valuenow={progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('game.analysing', { pct: progressPct })}
                  >
                    <div style={{ width: `${progressPct}%` }} />
                    <span>
                      <Spinner /> {t('game.analysing', { pct: progressPct })}
                    </span>
                  </div>
                  <button type="button" onClick={cancel}>{t('common.cancel')}</button>
                </div>
              ) : (
                <div className="analyse-start">
                  <button
                    type="button"
                    className="primary big"
                    onClick={() => {
                      setFromBottom(false);
                      void start();
                    }}
                  >
                    {t('game.analyse')}
                  </button>
                  <select
                    aria-label={t('game.depth')}
                    title={tOr(`preset.${engine.presetId}`, PRESETS[engine.presetId].label)}
                    value={engine.presetId}
                    onChange={(e) => engine.setPresetId(e.target.value as PresetId)}
                  >
                    {/* Short names here ("Standard"); the settings panel shows the depths. */}
                    {Object.values(PRESETS).map((p) => (
                      <option key={p.id} value={p.id}>{tOr(`preset.${p.id}`, p.label).replace(/\s*\(.*\)\s*$/, '')}</option>
                    ))}
                  </select>
                </div>
              )}
              {analysis && !running && analysis.phase === 'cancelled' && <p className="small muted">{t('game.cancelled')}</p>}
              {analysis && !running && analysis.phase === 'error' && <p className="small error">{t('game.failed', { error: analysis.error ?? '' })}</p>}
              {running && analysis && <p className="small muted">{`${tOr(`phase.analysis.${analysis.phase}`, analysis.phase.replace('-', ' '))} · ${analysis.progress.label}`}</p>}
              {engine.status === 'loading' && <p className="small muted">{t('game.loadingEngine')}</p>}
              {engine.status === 'error' && <p className="small error">{t('game.engineFailed', { error: engine.error ?? '' })}</p>}
            </div>
          )}
          {pv && (
            <div className="notice row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <span>
                {t('game.previewLine')}{' '}
                <span dir="ltr">{uciLineToSan(pv.baseFen, pv.moves).slice(0, pv.index).join(' ') || t('game.lineStart')}</span>
              </span>
              <span className="row">
                <button type="button" onClick={() => setPv({ ...pv, index: Math.max(0, pv.index - 1) })}>◀</button>
                <button type="button" onClick={() => setPv({ ...pv, index: Math.min(pv.moves.length, pv.index + 1) })}>▶</button>
                <button type="button" onClick={() => setPv(null)}>{t('game.backToGame')}</button>
              </span>
            </div>
          )}
          <MoveFeedback
            move={lastMove}
            analysis={lastAnalysis}
            nextLines={currentLines}
            boardFen={positions[pos]!}
            revealBetter={revealBetter}
            revealHint={revealHint}
            alwaysShow={alwaysShow}
            onRevealBetter={() => setReveal({ pos, better: true, hint: revealHint })}
            onRevealHint={() => setReveal({ pos, better: revealBetter, hint: true })}
            onAlwaysShow={setAlwaysShow}
            onPlayLine={(baseFen, moves) => setPv({ baseFen, moves, index: 1 })}
            onExplainBrilliance={lastMove ? () => setExplainPly(lastMove.ply) : undefined}
            analysed={!!analysis}
            whyBad={lastWhyBad}
            onWhyBad={
              lastMove
                ? () => {
                    setBeforeAt(pos);
                    if (!lastWhyBad || lastWhyBad.status === 'error') void explainer.explainMove(lastMove);
                  }
                : undefined
            }
            showingBefore={showBefore}
            onShowBefore={(on) => {
              setPv(null);
              setBeforeAt(on ? pos : null);
            }}
            threat={boardThreat}
            onFindThreat={lastMove?.san.endsWith('#') ? undefined : () => void explainer.findThreat(positions[pos]!)}
          />
          {analysis && (
            <div className="panel" style={{ marginTop: 12, padding: 8 }}>
              <EvalChart
                evals={analysis.positionEvals}
                categories={analysis.moves.map((m) => m?.category)}
                current={pos}
                onSelect={go}
              />
            </div>
          )}
        </div>

        <div className="side stack">
          <section className="panel" aria-label={t('moves.list')}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ margin: 0 }}>{t('moves.list')}</h2>
              <label className="small row">
                {t('moves.show')}
                <select value={filter} onChange={(e) => setFilter(e.target.value as MoveFilter)}>
                  <option value="all">{t('moves.filter.all')}</option>
                  <option value="errors">{t('moves.filter.errors')}</option>
                  <option value="blunders">{t('moves.filter.blunders')}</option>
                  <option value="brilliant">{t('moves.filter.brilliant')}</option>
                </select>
              </label>
            </div>
            <MoveList moves={game.moves} analysis={analysis?.moves} current={pos} onSelect={go} filter={filter} />
          </section>

          {analysis?.summary && (
            <section className="panel" aria-label={t('summary.title')}>
              <h2>{t('summary.title')}</h2>
              <Summary game={game} analysis={analysis} />
              <div className="row">
                <button type="button" onClick={() => downloadText(`${safeFilename(title)}.annotated.pgn`, annotatedPgn(game, analysis), 'application/x-chess-pgn')}>
                  {t('summary.exportPgn')}
                </button>
                <button type="button" onClick={() => downloadText(`${safeFilename(title)}.analysis.json`, analysisJson(game, analysis), 'application/json')}>
                  {t('summary.exportJson')}
                </button>
                <button type="button" onClick={() => downloadText(`${safeFilename(title)}.pgn`, game.rawPgn, 'application/x-chess-pgn')}>
                  {t('summary.originalPgn')}
                </button>
              </div>
            </section>
          )}

          <section className="panel analysis-controls" aria-labelledby="analysis-settings-title">
            <h2 id="analysis-settings-title">{analysisDone ? t('game.analyseAgain') : t('game.settings')}</h2>
            <div className="row">
              <label className="small row">
                {t('game.depth')}
                <select value={engine.presetId} onChange={(e) => engine.setPresetId(e.target.value as PresetId)} disabled={running}>
                  {Object.values(PRESETS).map((p) => <option key={p.id} value={p.id}>{tOr(`preset.${p.id}`, p.label)}</option>)}
                </select>
              </label>
              <label className="small row">
                {t('game.engine')}
                <select value={engine.flavour} onChange={(e) => engine.setFlavour(e.target.value as EngineFlavour)} disabled={running}>
                  {AVAILABLE_FLAVOURS.map((k) => <option key={k} value={k}>{ENGINE_BUILDS[k].label} · {ENGINE_BUILDS[k].approxSize}</option>)}
                </select>
              </label>
              <label className="small row" title={t('game.parallel.title')}>
                {t('game.parallel')}
                <select value={engine.engineCount} onChange={(e) => engine.setEngineCount(Number(e.target.value))} disabled={running}>
                  {Array.from({ length: engine.maxEngineCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            {(running ? fromBottom : analysisDone) && (
              <div className="row" style={{ marginTop: 8 }}>
                {!running ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFromBottom(true);
                      void start();
                    }}
                  >
                    {t('game.reanalyse')}
                  </button>
                ) : (
                  <button type="button" className="danger" onClick={cancel}>{t('common.cancel')}</button>
                )}
              </div>
            )}
            {running && fromBottom && (
              <div className="progress" style={{ marginTop: 8 }} role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${progressPct}%` }} />
              </div>
            )}
            {renderExtra?.({ game, analysis, setAnalysis })}
          </section>
        </div>
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => {
              setToast(null);
              boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            {t('toast.showOnBoard')} <Icon name="up" size={16} />
          </button>
          <button type="button" className="toast-close" aria-label={t('common.dismiss')} onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}

      {explainMove && (explainMove.brilliance?.verdict ?? 'none') !== 'none' ? (
        <EvidenceModal title={t('evidence.brilliantTitle', { san: explainMove.san })} onClose={() => setExplainPly(null)}>
          <BrillianceDetails evidence={explainMove.brilliance!} />
        </EvidenceModal>
      ) : (
        explainMove?.great && (
          <EvidenceModal title={t('evidence.greatTitle', { san: explainMove.san })} onClose={() => setExplainPly(null)}>
            <GreatDetails evidence={explainMove.great} />
          </EvidenceModal>
        )
      )}
    </div>
  );
}

/** Horizontal evaluation strip shown above the board on narrow screens (CSS hides it on desktop). */
function EvalStrip({ score }: { score?: EngineScore }) {
  const white = score ? expectedScore(score, 'w') : 0.5;
  return (
    <div className="eval-strip" aria-hidden="true">
      <div className="eval-strip-fill" style={{ width: `${white * 100}%` }} />
      <span className="eval-strip-label">{formatScore(score)}</span>
    </div>
  );
}
