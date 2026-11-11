import { CATEGORY_LABELS } from '../../core/classification/classify';
import type { MoveRecord } from '../../core/chess/types';
import type { EngineLine } from '../../core/engine/types';
import { numberedLine, uciLineToSan } from '../../core/chess/lines';
import { formatScore } from '../../core/scoring/score';
import { CategoryBadge } from '../../components/CategoryBadge';
import type { MoveAnalysis } from '../analysis/types';

const LINE_PLIES = 6; // the move itself + 5 more

type Props = {
  move?: MoveRecord; // the move that led to the shown position
  analysis?: MoveAnalysis;
  /** Engine lines for the position on the board (the next move). */
  nextLines: EngineLine[];
  boardFen: string;
  revealBetter: boolean;
  revealHint: boolean;
  alwaysShow: boolean;
  onRevealBetter: () => void;
  onRevealHint: () => void;
  onAlwaysShow: (v: boolean) => void;
  /** Plays a line on the board, starting from `fen`. */
  onPlayLine: (fen: string, uci: string[]) => void;
  onExplainBrilliance?: () => void;
  analysed: boolean;
};

function LineRow({
  label,
  fen,
  uci,
  score,
  onPlay,
}: {
  label: string;
  fen: string;
  uci: string[];
  score?: Parameters<typeof formatScore>[0];
  onPlay: () => void;
}) {
  const san = uciLineToSan(fen, uci, LINE_PLIES);
  if (san.length === 0) return null;
  return (
    <div className="line-row">
      <div className="small muted">
        {label} <strong className="line-score">{formatScore(score)}</strong>
      </div>
      <div className="line-moves">{numberedLine(fen, san)}</div>
      <button type="button" className="small" onClick={onPlay}>
        ▶ Play on board
      </button>
    </div>
  );
}

/**
 * Feedback for the move just played, shown right under the board. Best moves and engine lines
 * stay hidden until the user asks, so they can think first.
 */
export function MoveFeedback(p: Props) {
  const { move, analysis: a } = p;
  const notBest = !!a?.category && a.category !== 'best' && a.category !== 'brilliant' && a.category !== 'great' && !!a.bestMoveUci && a.bestMoveUci !== move?.uci;
  const showBetter = p.revealBetter || p.alwaysShow;
  const showHint = p.revealHint || p.alwaysShow;
  const bestLine = a?.lines.find((l) => l.pvUci[0] === a.bestMoveUci) ?? a?.lines[0];
  const playedLine = a?.playedPv ?? a?.lines.find((l) => l.pvUci[0] === move?.uci)?.pvUci;
  const bestSan = move && a?.bestMoveUci ? uciLineToSan(move.fenBefore, [a.bestMoveUci])[0] : undefined;
  const next = p.nextLines[0];

  return (
    <section className="panel move-feedback" aria-label="Move feedback" aria-live="polite">
      {move ? (
        <div className="row">
          <strong>
            {move.fullMoveNumber}
            {move.colour === 'w' ? '.' : '...'} {move.san}
          </strong>
          <CategoryBadge category={a?.category} candidate={a?.brilliance?.verdict === 'candidate'} />
          {a?.category && <span>{CATEGORY_LABELS[a.category].label}</span>}
          {a?.loss && a.loss.expectedLossPct >= 0.5 && <span className="small muted">−{a.loss.expectedLossPct.toFixed(1)} pts</span>}
          {a?.playedScore && <span className="small muted">eval {formatScore(a.playedScore)}</span>}
        </div>
      ) : (
        <div className="small muted">Starting position.</div>
      )}

      {!p.analysed && <p className="small muted">Analyse the game to see how good each move was.</p>}

      {move && a && notBest && (
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {!showBetter ? (
            <div className="row">
              <span className="small">There was a better move. Can you find it?</span>
              <button type="button" onClick={p.onRevealBetter}>Show better move</button>
            </div>
          ) : (
            <>
              <div className="small">
                Better was <strong>{bestSan ?? a.bestMoveUci}</strong> ({formatScore(a.bestScore)}) instead of {move.san} ({formatScore(a.playedScore)}).
              </div>
              {bestLine && (
                <LineRow
                  label="Best line"
                  fen={move.fenBefore}
                  uci={bestLine.pvUci}
                  score={bestLine.score}
                  onPlay={() => p.onPlayLine(move.fenBefore, bestLine.pvUci)}
                />
              )}
              {playedLine && (
                <LineRow
                  label={`After ${move.san}`}
                  fen={move.fenBefore}
                  uci={playedLine}
                  score={a.playedScore}
                  onPlay={() => p.onPlayLine(move.fenBefore, playedLine)}
                />
              )}
            </>
          )}
        </div>
      )}

      {move && a && !notBest && playedLine && playedLine.length > 1 && showBetter && (
        <LineRow
          label="Engine expects"
          fen={move.fenBefore}
          uci={playedLine}
          score={a.playedScore}
          onPlay={() => p.onPlayLine(move.fenBefore, playedLine)}
        />
      )}
      {move && a && !notBest && playedLine && playedLine.length > 1 && !showBetter && (
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="small" onClick={p.onRevealBetter}>Show continuation</button>
        </div>
      )}

      {a?.brilliance && a.brilliance.verdict !== 'none' && p.onExplainBrilliance ? (
        <button type="button" className="link small" onClick={p.onExplainBrilliance}>
          Why {a.brilliance.verdict === 'brilliant' ? 'brilliant' : 'a candidate'}? See the evidence
        </button>
      ) : (
        a?.category === 'great' &&
        a.great && p.onExplainBrilliance && (
          <button type="button" className="link small" onClick={p.onExplainBrilliance}>
            Why great? See the evidence
          </button>
        )
      )}
      {move?.comment && <div className="small muted">“{move.comment}”</div>}

      {next && (
        <div className="stack" style={{ gap: 6, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {!showHint ? (
            <div className="row">
              <span className="small">Your turn to think: what's best here?</span>
              <button type="button" onClick={p.onRevealHint}>Hint: best move</button>
            </div>
          ) : (
            <LineRow
              label="Best from here"
              fen={p.boardFen}
              uci={next.pvUci}
              score={next.score}
              onPlay={() => p.onPlayLine(p.boardFen, next.pvUci)}
            />
          )}
        </div>
      )}

      <label className="row small muted" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={p.alwaysShow} onChange={(e) => p.onAlwaysShow(e.target.checked)} /> Always show best moves
      </label>
    </section>
  );
}
