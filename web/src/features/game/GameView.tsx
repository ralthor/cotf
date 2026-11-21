import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chessboard } from 'react-chessboard';
import { DRAG_ACTIVATION_PX, mergeSquareStyles, useClickToMove } from '../../components/useClickToMove';
import { gameTitle } from '../../core/chess/pgn';
import { lichessAnalysisUrl } from '../../core/chess/links';
import { fenAfterLine, squarePosition } from '../../core/chess/lines';
import { getPref, setPref } from '../../storage/prefs';
import { MoveFeedback } from './MoveFeedback';
import { positionsOf, type GameRecord } from '../../core/chess/types';
import type { EngineLine, EngineScore } from '../../core/engine/types';
import type { MoveCategory } from '../../core/classification/classify';
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
import { gradeKey, legalMove } from '../explore/grade';
import { useLiveEngine, useMoveGrader } from '../explore/useExplore';
import { knownLines, nextItem, practicePlies, startPractice, type PracticeState } from '../explore/practice';
import { LinePanel, LiveEngineRow, PracticePanel } from '../explore/ExplorePanels';
import { useT } from '../../i18n/react';

/** A line on the board instead of the game: an engine line, or moves the user played (`user`). */
type PvPreview = { baseFen: string; moves: string[]; index: number; user?: boolean };

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

/** Time each move stays on the board during autoplay. */
const AUTOPLAY_MS = 1200;

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
  const grader = useMoveGrader();
  // Live engine for positions without a stored evaluation (your own lines, or before the analysis).
  const [engineOn, setEngineOnState] = useState(() => getPref('engineOn') !== '0');
  const setEngineOn = (v: boolean) => {
    setEngineOnState(v);
    setPref('engineOn', v ? null : '0');
  };
  // "Learn from your mistakes": replays the board side's mistakes as puzzles.
  const [practice, setPractice] = useState<PracticeState | null>(null);
  const { ref: boardRef, width: boardWidth } = useBoardWidth();

  // Autoplay: steps forward through the game on a timer until paused, the end, or any manual navigation.
  const [playing, setPlaying] = useState(false);

  /** Shows game position `p` (closing any line preview or "before the move" view). */
  const show = useCallback(
    (p: number) => {
      setPv(null);
      setBeforeAt(null);
      setPos(Math.max(0, Math.min(positions.length - 1, p)));
    },
    [positions.length],
  );

  /** Navigation by the user: also stops autoplay. */
  const go = useCallback(
    (p: number) => {
      setPlaying(false);
      show(p);
    },
    [show],
  );

  /** One step back/forward: inside an engine-line preview when one is open, else through the game. */
  const step = useCallback(
    (delta: 1 | -1) => {
      if (pv) {
        setPlaying(false);
        const index = Math.max(0, Math.min(pv.moves.length, pv.index + delta));
        setPv({ ...pv, index });
      } else go(pos + delta);
    },
    [pv, go, pos],
  );

  // Play continues from what is on the board: through the open line (engine or your own), else
  // through the game. It starts over only when already at the end.
  const atEnd = pv ? pv.index >= pv.moves.length : pos === positions.length - 1;
  const togglePlay = useCallback(() => {
    if (playing) return setPlaying(false);
    if (pv) {
      if (atEnd) setPv({ ...pv, index: 0 });
    } else if (atEnd) show(0);
    else if (beforeAt === pos && pos > 0) show(pos - 1); // "before the move": play on from that position
    setPlaying(true);
  }, [playing, atEnd, pos, show, pv, beforeAt]);

  useEffect(() => {
    if (!playing || atEnd) return;
    const id = window.setTimeout(() => {
      if (pv) {
        setPv({ ...pv, index: pv.index + 1 });
        if (pv.index + 1 >= pv.moves.length) setPlaying(false); // reached the end of the line
      } else {
        show(pos + 1);
        if (pos + 1 >= positions.length - 1) setPlaying(false); // reached the last move
      }
    }, AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [playing, atEnd, pos, show, positions.length, pv]);

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
    if (practice) return;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (practice) return; // the practice board has its own buttons
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(positions.length - 1);
      else if (e.key === 'f' && !practice) setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else if (e.key === 'p') togglePlay();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, step, positions.length, togglePlay, practice]);

  const lastMove = pos > 0 ? game.moves[pos - 1] : undefined;
  const lastAnalysis = pos > 0 ? analysis?.moves[pos - 1] : undefined;
  const nextAnalysis = analysis?.moves[pos]; // analysis of the position on the board (pre-move for ply pos+1)
  const currentLines: EngineLine[] = useMemo(() => nextAnalysis?.lines ?? [], [nextAnalysis]);
  const lastWhyBad = lastMove ? explainer.whyBad[whyBadKey(lastMove)] : undefined;
  const whyBadReport = lastWhyBad?.status === 'done' ? lastWhyBad.value : undefined;
  const showBefore = !pv && beforeAt === pos && !!lastMove && !!whyBadReport;
  // Practice: the position before the current mistake (with the tried move on it).
  const practicePly = practice && practice.index < practice.plies.length ? practice.plies[practice.index]! : null;
  const practiceMove = practicePly !== null ? analysis?.moves[practicePly - 1] : undefined;
  const practiceFen = practicePly !== null ? positions[practicePly - 1]! : null;
  const practiceGrade = practice?.attempt && practiceFen ? grader.grades[gradeKey(practiceFen, practice.attempt)] : undefined;
  const practiceBest = practiceMove?.bestMoveUci ?? practiceMove?.lines[0]?.pvUci[0];

  const fen = practiceFen
    ? practice!.attempt
      ? fenAfterLine(practiceFen, [practice!.attempt])
      : practiceFen
    : pv
      ? fenAfterLine(pv.baseFen, pv.moves.slice(0, pv.index))
      : showBefore
        ? lastMove!.fenBefore
        : positions[pos]!;

  // The last move of a line on the board, with its grade if the engine checked it.
  const lineLast =
    pv && pv.index > 0 ? { fen: fenAfterLine(pv.baseFen, pv.moves.slice(0, pv.index - 1)), uci: pv.moves[pv.index - 1]! } : null;
  const lineLastGrade = lineLast ? grader.grades[gradeKey(lineLast.fen, lineLast.uci)] : undefined;

  const storedEval = pv || practiceFen ? undefined : analysis?.positionEvals[showBefore ? pos - 1 : pos];
  const liveWanted = engineOn && !practiceFen && !running && !storedEval;
  const live = useLiveEngine(fen, liveWanted);
  const shownEval = practiceFen ? undefined : (storedEval ?? live?.line?.score);

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
    if (practiceFen) {
      if (practice?.solution) add(practiceBest, ARROW.best);
      return out;
    }
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
  }, [showHintArrow, currentLines, boardThreat, pv, showBefore, whyBadReport, lastMove, practiceFen, practice?.solution, practiceBest]);

  // The move highlighted on the board, with its category: the tried move in practice (or the
  // opponent's move before it), the last move of a line, or the game's last move.
  const boardMove: { uci: string; category?: MoveCategory } | null = practiceFen
    ? practice!.attempt
      ? { uci: practice!.attempt, category: practiceGrade?.status === 'done' ? practiceGrade.value.category : undefined }
      : practicePly! > 1
        ? { uci: game.moves[practicePly! - 2]!.uci }
        : null
    : pv
      ? lineLast && { uci: lineLast.uci, category: lineLastGrade?.status === 'done' ? lineLastGrade.value.category : undefined }
      : showBefore || !lastMove
        ? null
        : { uci: lastMove.uci, category: lastAnalysis?.category };
  const boardMoveUci = boardMove?.uci;
  const boardMoveCategory = boardMove?.category;

  // Category badge on the square where the moved piece landed.
  const badge = boardMove?.category ? { ...squarePosition(boardMove.uci.slice(2, 4), orientation), category: boardMove.category } : null;

  const hintSquare = practiceFen && practice?.hint && !practice.attempt ? practiceBest?.slice(0, 2) : undefined;
  const squareStyles = useMemo(() => {
    const out: Record<string, React.CSSProperties> = {};
    if (boardMoveUci) {
      const color = boardMoveCategory ? `var(--cat-${boardMoveCategory})` : 'var(--accent)';
      const style = { boxShadow: `inset 0 0 0 4px ${color}` };
      out[boardMoveUci.slice(0, 2)] = { ...style, opacity: 0.9 };
      out[boardMoveUci.slice(2, 4)] = style;
    }
    if (hintSquare) out[hintSquare] = { background: 'radial-gradient(circle, rgba(60,125,58,0.6) 35%, transparent 72%)' };
    return out;
  }, [boardMoveUci, boardMoveCategory, hintSquare]);

  // Pieces can be moved at any time: in the game this starts your own line, in practice it is your answer.
  const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const canDrag = practiceFen ? !practice!.attempt && !practice!.solution : true;
  const playMove = (from: string, to: string): boolean => {
    const m = legalMove(fen, from, to);
    if (!m) return false;
    if (practice && practiceFen && practiceMove) {
      setPractice({ ...practice, attempt: m.uci });
      void grader.grade(practiceFen, m.uci, knownLines(practiceMove));
      return true;
    }
    setPlaying(false);
    // Lines the analysis already has for this position, so grading needs fewer searches.
    const known = pv ? undefined : showBefore ? lastAnalysis?.lines : currentLines;
    if (pv) {
      const moves = [...pv.moves.slice(0, pv.index), m.uci];
      setPv({ baseFen: pv.baseFen, moves, index: moves.length, user: true });
    } else if (!showBefore && game.moves[pos]?.uci === m.uci) {
      show(pos + 1); // the move from the game: just step forward
      return true;
    } else {
      setBeforeAt(null);
      setPv({ baseFen: fen, moves: [m.uci], index: 1, user: true });
    }
    if (engineOn) void grader.grade(fen, m.uci, known);
    return true;
  };
  const board = useClickToMove({ fen, enabled: canDrag, side: practiceFen ? practice!.side : sideToMove, move: playMove });
  const boardStyles = useMemo(() => mergeSquareStyles(squareStyles, board.squareStyles), [squareStyles, board.squareStyles]);

  const side = orientation === 'white' ? 'w' : 'b';
  const sideName = side === 'w' ? t('practice.white') : t('practice.black');
  const mistakes = useMemo(() => practicePlies(analysis?.moves, side), [analysis?.moves, side]);
  const startPracticeHere = () => {
    setPlaying(false);
    setPv(null);
    setBeforeAt(null);
    setPractice(startPractice(side, mistakes));
  };
  const exitPractice = () => {
    if (practicePly !== null) show(practicePly - 1);
    setPractice(null);
  };

  const progressPct = analysis ? Math.round((analysis.progress.done / Math.max(1, analysis.progress.total)) * 100) : 0;
  const title = gameTitle(game);
  const explainMove = explainPly !== null ? analysis?.moves[explainPly - 1] : undefined;
  const analysisDone = analysis?.phase === 'done';
  // Before the first full analysis the big button sits under the board; re-runs start from the end of the page.
  const showAnalyseBlock = running ? !fromBottom : !analysisDone;
  const busyLabel = running
    ? `${progressPct}%`
    : boardThreat?.status === 'running' || lastWhyBad?.status === 'running' || lineLastGrade?.status === 'running'
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
  }, [setToast]);
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
        <label className="engine-switch" title={t('engine.title')}>
          <input type="checkbox" role="switch" checked={engineOn} onChange={(e) => setEngineOn(e.target.checked)} />
          <span>{t('engine.toggle')}</span>
        </label>
        <button
          type="button"
          className="icon-button"
          onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
          disabled={!!practice}
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
          <EvalBar score={shownEval} orientation={orientation} height={boardWidth} />
        </div>
        <div className="board-col">
          <EvalStrip score={shownEval} />
          <div ref={boardRef} className="board-wrap" dir="ltr" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <Chessboard
              options={{
                id: 'review-board',
                position: fen,
                boardOrientation: orientation,
                allowDragging: canDrag,
                dragActivationDistance: DRAG_ACTIVATION_PX,
                canDragPiece: board.canDragPiece,
                onPieceDrop: board.onPieceDrop,
                onSquareClick: board.onSquareClick,
                arrows,
                squareStyles: boardStyles,
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
          {practice ? (
            <PracticePanel
              practice={practice}
              move={practiceMove}
              fen={practiceFen ?? undefined}
              grade={practiceGrade}
              onTryAgain={() => setPractice({ ...practice, attempt: null, tries: practice.tries + 1 })}
              onHint={() => setPractice({ ...practice, hint: true })}
              onSolution={() => setPractice({ ...practice, solution: true, attempt: null })}
              onNext={(r) => setPractice(nextItem(practice, r))}
              onExit={exitPractice}
              onRestart={() => setPractice(startPractice(practice.side, practice.plies))}
            />
          ) : (
            <>
            <div className="controls" role="group" aria-label={t('game.nav')} dir="ltr">
              <button type="button" onClick={() => go(0)} aria-label={t('game.first')} title={t('game.first')} disabled={pos === 0 && !pv}>
                <Icon name="first" />
              </button>
              <button type="button" onClick={() => step(-1)} aria-label={t('game.prev')} title={t('game.prev')} disabled={pos === 0 && !pv}>
                <Icon name="prev" />
              </button>
              <button
                type="button"
                className={playing ? 'play-button playing' : 'play-button'}
                onClick={togglePlay}
                aria-label={playing ? t('game.pause') : t('game.play')}
                aria-pressed={playing}
                title={`${playing ? t('game.pause') : t('game.play')} (P)`}
              >
                <Icon name={playing ? 'pause' : 'play'} />
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
            {liveWanted && <LiveEngineRow live={live} />}
            {pv && (
              <LinePanel
                baseFen={pv.baseFen}
                moves={pv.moves}
                index={pv.index}
                user={!!pv.user}
                engineOn={engineOn}
                grades={grader.grades}
                onIndex={(index) => {
                  setPlaying(false);
                  setPv({ ...pv, index });
                }}
                onBack={() => go(pos)}
              />
            )}
            {analysisDone && !pv && (mistakes.length > 0 ? (
              <button type="button" className="practice-start" onClick={startPracticeHere}>
                {t('practice.start', { n: mistakes.length, side: sideName })}
              </button>
            ) : (
              <p className="small muted practice-none">{t('practice.none', { side: sideName })}</p>
            ))}
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
              onPlayLine={(baseFen, moves) => {
                setPlaying(false);
                setPv({ baseFen, moves, index: 1 });
              }}
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
                setPlaying(false);
                setPv(null);
                setBeforeAt(on ? pos : null);
              }}
              threat={boardThreat}
              onFindThreat={lastMove?.san.endsWith('#') ? undefined : () => void explainer.findThreat(positions[pos]!)}
            />
            </>
          )}
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
            <MoveList moves={game.moves} analysis={analysis?.moves} evals={analysis?.positionEvals} current={pos} onSelect={go} filter={filter} />
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
