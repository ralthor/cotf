import { CATEGORY_LABELS } from '../../core/classification/classify';
import type { MoveRecord } from '../../core/chess/types';
import type { EngineLine } from '../../core/engine/types';
import { numberedLine, uciLineToSan } from '../../core/chess/lines';
import { formatScore } from '../../core/scoring/score';
import { CategoryBadge } from '../../components/CategoryBadge';
import type { MoveAnalysis } from '../analysis/types';
import type { PositionThreats, ThreatReport, WhyBadCause, WhyBadReport } from '../../core/explain/whyBad';
import type { Pending } from '../explain/useMoveExplainer';

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
  /** "Why was this bad?" for the move just played (on demand, separate from the analysis). */
  whyBad?: Pending<WhyBadReport>;
  onWhyBad?: () => void;
  /** True while the main board shows the position before the move (with threat arrows). */
  showingBefore?: boolean;
  onShowBefore?: (on: boolean) => void;
  /** Opponent's threats in the position on the board (on demand, drawn as red arrows). */
  threat?: Pending<PositionThreats | null>;
  onFindThreat?: () => void;
};

const CAUSE_TITLES: Record<WhyBadCause['kind'], string> = {
  'ignored-threat': 'Ignored a threat',
  'only-move': 'Missed the only good move',
  'missed-opportunity': 'Missed an opportunity',
  'allowed-tactic': 'Allowed a tactic',
  positional: 'Positional',
};

const colourName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black');

/** "Qxf7# (forces mate in 1); if ignored the eval goes +1.19 → #-1". */
function ThreatItem({ t }: { t: ThreatReport }) {
  return (
    <li>
      <span className="arrow-swatch threat" aria-hidden="true" /> <strong>{t.san}</strong>
      {t.effect ? ` ${t.effect}` : ''}. If ignored, the eval goes {formatScore(t.evalNow)} → {formatScore(t.evalIfIgnored)}.
      {t.lowConfidence ? ' Few pieces are left, so this may be overstated.' : ''}
    </li>
  );
}

function ArrowKey({ before }: { before: boolean }) {
  return (
    <div className="arrow-key small muted" aria-label="Arrow colours">
      <span><span className="arrow-swatch threat" /> threat</span>
      {before && <span><span className="arrow-swatch played" /> your move</span>}
      {before && <span><span className="arrow-swatch best" /> better move</span>}
    </div>
  );
}

function WhyBadView({
  r,
  move,
  showingBefore,
  onShowBefore,
  onPlay,
}: {
  r: WhyBadReport;
  move: MoveRecord;
  showingBefore: boolean;
  onShowBefore?: (on: boolean) => void;
  onPlay: (fen: string, uci: string[]) => void;
}) {
  const opp = colourName(move.colour === 'w' ? 'b' : 'w');
  const ignored = r.causes.find((c) => c.kind === 'ignored-threat');
  return (
    <div className="stack why-bad" style={{ gap: 8 }}>
      {onShowBefore && (
        <div className="segmented" role="group" aria-label="Board shows">
          <button type="button" aria-pressed={showingBefore} onClick={() => onShowBefore(true)}>
            Before {move.san}
          </button>
          <button type="button" aria-pressed={!showingBefore} onClick={() => onShowBefore(false)}>
            After
          </button>
        </div>
      )}
      <div className="small">
        Eval {formatScore(r.bestScore)} with {r.bestSan}, {formatScore(r.playedScore)} after {r.playedSan}.
      </div>
      <ul className="causes">
        {r.causes.map((c) => (
          <li key={c.kind}>
            <strong>{CAUSE_TITLES[c.kind]}</strong>
            <div className="small">{c.text}</div>
          </li>
        ))}
      </ul>
      {r.inCheck && <div className="small muted">You were in check, so the move had to answer the check.</div>}
      {!r.inCheck && (
        <div className="small">
          {r.threats.length > 0 ? (
            <>
              {opp}&apos;s threats before {r.playedSan}
              {r.threatHandled && !ignored ? ` (${r.playedSan} dealt with them)` : ''}:
              <ul className="threats">
                {r.threats.map((t) => (
                  <ThreatItem key={t.uci} t={t} />
                ))}
              </ul>
            </>
          ) : (
            <span className="muted">{opp} had no real threat before {r.playedSan}.</span>
          )}
        </div>
      )}
      {showingBefore && <ArrowKey before />}
      <div className="row">
        <button type="button" className="small" onClick={() => onPlay(move.fenBefore, r.bestLine)}>
          ▶ Best line ({r.bestSan})
        </button>
        <button type="button" className="small" onClick={() => onPlay(move.fenBefore, r.playedLine)}>
          ▶ After {r.playedSan}
        </button>
      </div>
    </div>
  );
}

function ThreatView({ t, boardFen }: { t: PositionThreats | null; boardFen: string }) {
  if (!t) return <div className="small">You are in check: the threat is the check itself.</div>;
  const side = boardFen.split(' ')[1] === 'w' ? 'b' : 'w';
  if (t.real.length === 0)
    return (
      <div className="small">
        No real threat: even if {colourName(side)} could move again, the eval would only go {formatScore(t.main.evalNow)} →{' '}
        {formatScore(t.main.evalIfIgnored)}.
      </div>
    );
  return (
    <div className="small">
      {colourName(side)} threatens:
      <ul className="threats">
        {t.real.map((x) => (
          <ThreatItem key={x.uci} t={x} />
        ))}
      </ul>
      <ArrowKey before={false} />
    </div>
  );
}

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
          {a?.playedScore && (
            <span className="small muted">
              eval {notBest && a.bestScore ? `${formatScore(a.bestScore)} → ` : ''}
              {formatScore(a.playedScore)}
            </span>
          )}
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

      {move && a && p.onWhyBad && (a.category === 'questionable' || a.category === 'mistake' || a.category === 'blunder') && (
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {!p.whyBad ? (
            <div className="row">
              <button type="button" onClick={p.onWhyBad}>Why was this bad?</button>
            </div>
          ) : p.whyBad.status === 'running' ? (
            <div className="small muted">Looking at threats and alternatives…</div>
          ) : p.whyBad.status === 'error' ? (
            <div className="small error" role="alert">
              Could not explain this move: {p.whyBad.error} <button type="button" className="link small" onClick={p.onWhyBad}>Retry</button>
            </div>
          ) : (
            <WhyBadView
              r={p.whyBad.value}
              move={move}
              showingBefore={!!p.showingBefore}
              onShowBefore={p.onShowBefore}
              onPlay={p.onPlayLine}
            />
          )}
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

      {p.onFindThreat && !p.threat && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="small">What does the opponent threaten here?</span>
          <button type="button" onClick={p.onFindThreat}>Show threat</button>
        </div>
      )}
      {p.threat && (
        <div style={{ marginTop: 6 }}>
          {p.threat.status === 'running' ? (
            <div className="small muted">Looking for the opponent's threat…</div>
          ) : p.threat.status === 'error' ? (
            <div className="small error" role="alert">Could not find threats: {p.threat.error}</div>
          ) : (
            <ThreatView t={p.threat.value} boardFen={p.boardFen} />
          )}
        </div>
      )}

      <label className="row small muted" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={p.alwaysShow} onChange={(e) => p.onAlwaysShow(e.target.checked)} /> Always show best moves
      </label>
    </section>
  );
}
