import type { MoveRecord } from '../../core/chess/types';
import type { EngineLine } from '../../core/engine/types';
import { numberedLine, uciLineToSan } from '../../core/chess/lines';
import { formatScore } from '../../core/scoring/score';
import { CategoryBadge } from '../../components/CategoryBadge';
import { Spinner } from '../../components/Icon';
import type { MoveAnalysis } from '../analysis/types';
import type { PositionThreats, ThreatReport, WhyBadCause, WhyBadReport } from '../../core/explain/whyBad';
import type { Pending } from '../explain/useMoveExplainer';
import { categoryLabel } from '../../components/categoryText';
import { t } from '../../i18n';
import { useT } from '../../i18n/react';

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

const causeTitle = (kind: WhyBadCause['kind']): string => t(`why.cause.${kind}`);

const colourName = (c: 'w' | 'b') => (c === 'w' ? t('colour.white') : t('colour.black'));

/** "Qxf7# (forces mate in 1); if ignored the eval goes +1.19 → #-1". */
function ThreatItem({ threat }: { threat: ThreatReport }) {
  return (
    <li>
      <span className="arrow-swatch threat" aria-hidden="true" /> <strong dir="ltr">{threat.san}</strong>
      {threat.effect ? ` ${threat.effect}` : ''}.{' '}
      {t('threat.ifIgnored', { now: formatScore(threat.evalNow), ignored: formatScore(threat.evalIfIgnored) })}
      {threat.lowConfidence ? ` ${t('threat.lowConfidence')}` : ''}
    </li>
  );
}

function ArrowKey({ before }: { before: boolean }) {
  return (
    <div className="arrow-key small muted" aria-label={t('arrows.title')}>
      <span><span className="arrow-swatch threat" /> {t('arrows.threat')}</span>
      {before && <span><span className="arrow-swatch played" /> {t('arrows.yourMove')}</span>}
      {before && <span><span className="arrow-swatch best" /> {t('arrows.better')}</span>}
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
        <div className="segmented" role="group" aria-label={t('why.boardShows')}>
          <button type="button" aria-pressed={showingBefore} onClick={() => onShowBefore(true)}>
            {t('why.before', { san: move.san })}
          </button>
          <button type="button" aria-pressed={!showingBefore} onClick={() => onShowBefore(false)}>
            {t('why.after')}
          </button>
        </div>
      )}
      <div className="small">
        {t('why.evals', { best: formatScore(r.bestScore), bestSan: r.bestSan, played: formatScore(r.playedScore), playedSan: r.playedSan })}
      </div>
      <ul className="causes">
        {r.causes.map((c) => (
          <li key={c.kind}>
            <strong>{causeTitle(c.kind)}</strong>
            <div className="small">{c.text}</div>
          </li>
        ))}
      </ul>
      {r.inCheck && <div className="small muted">{t('why.inCheck')}</div>}
      {!r.inCheck && (
        <div className="small">
          {r.threats.length > 0 ? (
            <>
              {t('why.threatsBefore', { side: opp, san: r.playedSan })}
              {r.threatHandled && !ignored ? ` ${t('why.dealtWith', { san: r.playedSan })}` : ''}:
              <ul className="threats">
                {r.threats.map((x) => (
                  <ThreatItem key={x.uci} threat={x} />
                ))}
              </ul>
            </>
          ) : (
            <span className="muted">{t('why.noThreat', { side: opp, san: r.playedSan })}</span>
          )}
        </div>
      )}
      {showingBefore && <ArrowKey before />}
      <div className="row">
        <button type="button" className="small" onClick={() => onPlay(move.fenBefore, r.bestLine)}>
          ▶ {t('why.bestLine', { san: r.bestSan })}
        </button>
        <button type="button" className="small" onClick={() => onPlay(move.fenBefore, r.playedLine)}>
          ▶ {t('why.afterSan', { san: r.playedSan })}
        </button>
      </div>
    </div>
  );
}

function ThreatView({ threats, boardFen }: { threats: PositionThreats | null; boardFen: string }) {
  if (!threats) return <div className="small">{t('threat.inCheck')}</div>;
  const side = boardFen.split(' ')[1] === 'w' ? 'b' : 'w';
  if (threats.real.length === 0)
    return (
      <div className="small">
        {t('threat.none', { side: colourName(side), now: formatScore(threats.main.evalNow), ignored: formatScore(threats.main.evalIfIgnored) })}
      </div>
    );
  return (
    <div className="small">
      {t('threat.threatens', { side: colourName(side) })}
      <ul className="threats">
        {threats.real.map((x) => (
          <ThreatItem key={x.uci} threat={x} />
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
        {label}{' '}
        <strong className="line-score">
          <bdi dir="ltr">{formatScore(score)}</bdi>
        </strong>
      </div>
      <div className="line-moves" dir="ltr">{numberedLine(fen, san)}</div>
      <button type="button" className="small" onClick={onPlay}>
        ▶ {t('line.play')}
      </button>
    </div>
  );
}

/**
 * Feedback for the move just played, shown right under the board. Best moves and engine lines
 * stay hidden until the user asks, so they can think first.
 */
export function MoveFeedback(p: Props) {
  useT();
  const { move, analysis: a } = p;
  const notBest = !!a?.category && a.category !== 'best' && a.category !== 'brilliant' && a.category !== 'great' && !!a.bestMoveUci && a.bestMoveUci !== move?.uci;
  const showBetter = p.revealBetter || p.alwaysShow;
  const showHint = p.revealHint || p.alwaysShow;
  const bestLine = a?.lines.find((l) => l.pvUci[0] === a.bestMoveUci) ?? a?.lines[0];
  const playedLine = a?.playedPv ?? a?.lines.find((l) => l.pvUci[0] === move?.uci)?.pvUci;
  const bestSan = move && a?.bestMoveUci ? uciLineToSan(move.fenBefore, [a.bestMoveUci])[0] : undefined;
  const next = p.nextLines[0];

  return (
    <section className="panel move-feedback" aria-label={t('feedback.title')} aria-live="polite">
      {move && (
        <div className="row">
          <strong dir="ltr">
            {move.fullMoveNumber}
            {move.colour === 'w' ? '.' : '...'} {move.san}
          </strong>
          <CategoryBadge category={a?.category} candidate={a?.brilliance?.verdict === 'candidate'} />
          {a?.category && <span>{categoryLabel(a.category)}</span>}
          {a?.playedScore && (
            <span className="small muted">
              {t('feedback.eval')}{' '}
              <bdi dir="ltr">
                {notBest && a.bestScore ? `${formatScore(a.bestScore)} → ` : ''}
                {formatScore(a.playedScore)}
              </bdi>
            </span>
          )}
        </div>
      )}

      {move && a && notBest && (
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {!showBetter ? (
            <div className="row">
              <span className="small">{t('feedback.betterExists')}</span>
              <button type="button" onClick={p.onRevealBetter}>{t('feedback.showBetter')}</button>
            </div>
          ) : (
            <>
              <div className="small">
                {t('feedback.betterWas', { best: bestSan ?? a.bestMoveUci ?? '', bestEval: formatScore(a.bestScore), played: move.san, playedEval: formatScore(a.playedScore) })}
              </div>
              {bestLine && (
                <LineRow
                  label={t('line.best')}
                  fen={move.fenBefore}
                  uci={bestLine.pvUci}
                  score={bestLine.score}
                  onPlay={() => p.onPlayLine(move.fenBefore, bestLine.pvUci)}
                />
              )}
              {playedLine && (
                <LineRow
                  label={t('why.afterSan', { san: move.san })}
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
          label={t('line.expects')}
          fen={move.fenBefore}
          uci={playedLine}
          score={a.playedScore}
          onPlay={() => p.onPlayLine(move.fenBefore, playedLine)}
        />
      )}
      {move && a && !notBest && playedLine && playedLine.length > 1 && !showBetter && (
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="small" onClick={p.onRevealBetter}>{t('feedback.showContinuation')}</button>
        </div>
      )}

      {move && a && p.onWhyBad && (a.category === 'questionable' || a.category === 'mistake' || a.category === 'blunder') && (
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {!p.whyBad ? (
            <div className="row">
              <button type="button" onClick={p.onWhyBad}>{t('feedback.whyBad')}</button>
            </div>
          ) : p.whyBad.status === 'running' ? (
            <div className="row">
              <button type="button" className="busy" disabled aria-busy="true">
                <Spinner /> {t('feedback.whyBad.running')}
              </button>
            </div>
          ) : p.whyBad.status === 'error' ? (
            <div className="small error" role="alert">
              {t('feedback.whyBad.error', { error: p.whyBad.error })} <button type="button" className="link small" onClick={p.onWhyBad}>{t('common.retry')}</button>
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
          {a.brilliance.verdict === 'brilliant' ? t('feedback.whyBrilliant') : t('feedback.whyCandidate')}
        </button>
      ) : (
        a?.category === 'great' &&
        a.great && p.onExplainBrilliance && (
          <button type="button" className="link small" onClick={p.onExplainBrilliance}>
            {t('feedback.whyGreat')}
          </button>
        )
      )}
      {move?.comment && <div className="small muted">“{move.comment}”</div>}

      {next && (
        <div className="stack" style={{ gap: 6, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {!showHint ? (
            <div className="row">
              <span className="small">{t('feedback.think')}</span>
              <button type="button" onClick={p.onRevealHint}>{t('feedback.hint')}</button>
            </div>
          ) : (
            <LineRow
              label={t('line.bestFromHere')}
              fen={p.boardFen}
              uci={next.pvUci}
              score={next.score}
              onPlay={() => p.onPlayLine(p.boardFen, next.pvUci)}
            />
          )}
        </div>
      )}

      {p.onFindThreat && (!p.threat || p.threat.status === 'running') && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="small">{t('feedback.threatQuestion')}</span>
          {p.threat ? (
            <button type="button" className="busy" disabled aria-busy="true">
              <Spinner /> {t('feedback.threat.running')}
            </button>
          ) : (
            <button type="button" onClick={p.onFindThreat}>{t('feedback.showThreat')}</button>
          )}
        </div>
      )}
      {p.threat && p.threat.status !== 'running' && (
        <div style={{ marginTop: 6 }}>
          {p.threat.status === 'error' ? (
            <div className="small error" role="alert">{t('feedback.threat.error', { error: p.threat.error })}</div>
          ) : (
            <ThreatView threats={p.threat.value} boardFen={p.boardFen} />
          )}
        </div>
      )}

      <label className="row small muted" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={p.alwaysShow} onChange={(e) => p.onAlwaysShow(e.target.checked)} /> {t('feedback.alwaysShow')}
      </label>
    </section>
  );
}
