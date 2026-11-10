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
import { EvalBar } from '../../components/EvalBar';
import { EvalChart } from '../../components/EvalChart';
import { MoveList, type MoveFilter } from '../../components/MoveList';
import { Summary } from '../../components/Summary';
import { BrillianceModal } from '../../components/BrillianceExplainer';
import { annotatedPgn, analysisJson, downloadText, safeFilename } from '../analysis/export';
import { PRESETS, type GameAnalysis, type PresetId } from '../analysis/types';
import { useGameAnalysis } from '../analysis/useGameAnalysis';

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

export function GameView({ game, renderExtra }: GameViewProps) {
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
  const { analysis, setAnalysis, running, start, cancel } = useGameAnalysis(game);
  const engine = useEngine();
  const { ref: boardRef, width: boardWidth } = useBoardWidth();

  const go = useCallback(
    (p: number) => {
      setPv(null);
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
  const fen = pv ? fenAfterLine(pv.baseFen, pv.moves.slice(0, pv.index)) : positions[pos]!;

  // Reveals reset whenever the shown position changes.
  const revealBetter = reveal.pos === pos && reveal.better;
  const revealHint = reveal.pos === pos && reveal.hint;
  const showHintArrow = (revealHint || alwaysShow) && !pv;

  const arrows = useMemo(() => {
    if (!showHintArrow) return [];
    const best = currentLines[0]?.pvUci[0];
    return best ? [{ startSquare: best.slice(0, 2), endSquare: best.slice(2, 4), color: 'rgba(60,125,58,0.8)' }] : [];
  }, [showHintArrow, currentLines]);

  // Category badge on the square where the moved piece landed.
  const badge =
    !pv && lastMove && lastAnalysis?.category
      ? { ...squarePosition(lastMove.uci.slice(2, 4), orientation), category: lastAnalysis.category }
      : null;

  const squareStyles = useMemo(() => {
    if (!lastMove || pv) return {};
    const color = lastAnalysis?.category ? `var(--cat-${lastAnalysis.category})` : 'var(--accent)';
    const style = { boxShadow: `inset 0 0 0 4px ${color}` };
    return { [lastMove.uci.slice(0, 2)]: { ...style, opacity: 0.9 }, [lastMove.uci.slice(2, 4)]: style };
  }, [lastMove, lastAnalysis, pv]);

  const progressPct = analysis ? Math.round((analysis.progress.done / Math.max(1, analysis.progress.total)) * 100) : 0;
  const title = gameTitle(game);
  const explainMove = explainPly !== null ? analysis?.moves[explainPly - 1] : undefined;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        {game.sourceUrl && (
          <a href={game.sourceUrl} target="_blank" rel="noreferrer noopener" className="small">
            Open source game ↗
          </a>
        )}
      </div>

      <div className="review">
        <div className="eval-bar-v">
          <EvalBar score={pv ? undefined : analysis?.positionEvals[pos]} orientation={orientation} height={boardWidth} />
        </div>
        <div className="board-col">
          <EvalStrip score={pv ? undefined : analysis?.positionEvals[pos]} />
          <div ref={boardRef} className="board-wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
          </div>
          <div className="controls" role="group" aria-label="Navigation">
            <button type="button" onClick={() => go(0)} aria-label="First position" disabled={pos === 0 && !pv}>⏮</button>
            <button type="button" onClick={() => step(-1)} aria-label="Previous move" disabled={pos === 0 && !pv}>◀</button>
            <button type="button" onClick={() => step(1)} aria-label="Next move" disabled={pos === positions.length - 1 && !pv}>▶</button>
            <button type="button" onClick={() => go(positions.length - 1)} aria-label="Last position">⏭</button>
            <button type="button" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} aria-label="Flip board">
              ⇅<span className="hide-mobile"> Flip</span>
            </button>
            <a
              className="button-link"
              href={lichessAnalysisUrl(fen, orientation)}
              target="_blank"
              rel="noreferrer noopener"
              title="Open this position on the Lichess analysis board"
            >
              Lichess ↗
            </a>
          </div>
          {pv && (
            <div className="notice row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <span>
                Previewing engine line: {uciLineToSan(pv.baseFen, pv.moves).slice(0, pv.index).join(' ') || '(start)'}
              </span>
              <span className="row">
                <button type="button" onClick={() => setPv({ ...pv, index: Math.max(0, pv.index - 1) })}>◀</button>
                <button type="button" onClick={() => setPv({ ...pv, index: Math.min(pv.moves.length, pv.index + 1) })}>▶</button>
                <button type="button" onClick={() => setPv(null)}>Back to game</button>
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
          <section className="panel analysis-controls" aria-label="Analysis controls">
            <div className="row">
              <label className="small row">
                Depth
                <select value={engine.presetId} onChange={(e) => engine.setPresetId(e.target.value as PresetId)} disabled={running}>
                  {Object.values(PRESETS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label className="small row">
                Engine
                <select value={engine.flavour} onChange={(e) => engine.setFlavour(e.target.value as EngineFlavour)} disabled={running}>
                  {AVAILABLE_FLAVOURS.map((k) => <option key={k} value={k}>{ENGINE_BUILDS[k].label} · {ENGINE_BUILDS[k].approxSize}</option>)}
                </select>
              </label>
              <label className="small row" title="Single-threaded engines analysing different positions at the same time.">
                Parallel engines
                <select value={engine.engineCount} onChange={(e) => engine.setEngineCount(Number(e.target.value))} disabled={running}>
                  {Array.from({ length: engine.maxEngineCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {!running ? (
                <button type="button" className="primary" onClick={() => void start()}>
                  {analysis ? 'Re-analyse' : 'Analyse game'}
                </button>
              ) : (
                <button type="button" className="danger" onClick={cancel}>Cancel</button>
              )}
              {engine.status === 'loading' && <span className="small muted">Loading Stockfish…</span>}
              {engine.status === 'error' && <span className="small error">Engine failed to load: {engine.error}</span>}
            </div>
            {analysis && analysis.phase !== 'done' && (
              <div style={{ marginTop: 8 }} aria-live="polite">
                <div className="progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${progressPct}%` }} />
                </div>
                <p className="small muted">
                  {analysis.phase === 'cancelled'
                    ? 'Cancelled — results so far are provisional. Re-run to resume (finished positions are cached).'
                    : analysis.phase === 'error'
                      ? <span className="error">Analysis failed: {analysis.error}</span>
                      : `${analysis.phase.replace('-', ' ')} · ${analysis.progress.label}`}
                </p>
              </div>
            )}
            {renderExtra?.({ game, analysis, setAnalysis })}
          </section>

          <section className="panel" aria-label="Moves">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ margin: 0 }}>Moves</h2>
              <label className="small row">
                Show
                <select value={filter} onChange={(e) => setFilter(e.target.value as MoveFilter)}>
                  <option value="all">All</option>
                  <option value="errors">Inaccuracies+</option>
                  <option value="blunders">Blunders</option>
                  <option value="brilliant">Brilliant / candidates</option>
                </select>
              </label>
            </div>
            <MoveList moves={game.moves} analysis={analysis?.moves} current={pos} onSelect={go} filter={filter} />
          </section>

          {analysis?.summary && (
            <section className="panel" aria-label="Summary">
              <h2>Summary</h2>
              <Summary game={game} analysis={analysis} />
              <div className="row">
                <button type="button" onClick={() => downloadText(`${safeFilename(title)}.annotated.pgn`, annotatedPgn(game, analysis), 'application/x-chess-pgn')}>
                  Export PGN
                </button>
                <button type="button" onClick={() => downloadText(`${safeFilename(title)}.analysis.json`, analysisJson(game, analysis), 'application/json')}>
                  Export JSON
                </button>
                <button type="button" onClick={() => downloadText(`${safeFilename(title)}.pgn`, game.rawPgn, 'application/x-chess-pgn')}>
                  Original PGN
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      {explainMove?.brilliance && (
        <BrillianceModal
          evidence={explainMove.brilliance}
          title={`${explainMove.san}: brilliancy evidence`}
          onClose={() => setExplainPly(null)}
        />
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
