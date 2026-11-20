import { uciLineToSan, fenAfterLine } from '../../core/chess/lines';
import type { MoveAnalysis } from '../analysis/types';
import type { Pending } from '../explain/useMoveExplainer';
import { formatScore } from '../../core/scoring/score';
import { CategoryBadge } from '../../components/CategoryBadge';
import { categoryLabel } from '../../components/categoryText';
import { Spinner } from '../../components/Icon';
import { useT } from '../../i18n/react';
import { GOOD_ENOUGH, gradeKey, type MoveGrade } from './grade';
import type { PracticeState } from './practice';
import type { LiveEval } from './useExplore';

type Grades = Record<string, Pending<MoveGrade>>;

/** Move-number prefixes for a line starting in `fen`: "12.", "12…" for a first black move, else "". */
function numbers(fen: string, count: number): string[] {
  const parts = fen.split(' ');
  let white = parts[1] !== 'b';
  let num = Number(parts[5] ?? '1');
  return Array.from({ length: count }, (_, i) => {
    const prefix = white ? `${num}.` : i === 0 ? `${num}…` : '';
    if (!white) num++;
    white = !white;
    return prefix;
  });
}

/** Grade shown next to a move: its badge, or a spinner while the engine checks it. */
function GradeMark({ grade }: { grade?: Pending<MoveGrade> }) {
  if (grade?.status === 'running') return <Spinner />;
  if (grade?.status === 'done') return <CategoryBadge category={grade.value.category} />;
  return null;
}

/** "Your line" / engine line on the board: its moves (each graded when the engine is on) and the way back. */
export function LinePanel({
  baseFen,
  moves,
  index,
  user,
  engineOn,
  grades,
  onIndex,
  onBack,
}: {
  baseFen: string;
  moves: string[];
  index: number;
  user: boolean;
  engineOn: boolean;
  grades: Grades;
  onIndex: (i: number) => void;
  onBack: () => void;
}) {
  const { t } = useT();
  const sans = uciLineToSan(baseFen, moves, moves.length);
  const nums = numbers(baseFen, sans.length);
  return (
    <div className="line-panel">
      <div className="row line-head">
        <strong>{user ? t('line.yours') : t('line.engine')}</strong>
        <button type="button" onClick={onBack}>
          {t('game.backToGame')}
        </button>
      </div>
      <div className="line-moves" dir="ltr">
        <button type="button" aria-current={index === 0 ? 'true' : undefined} onClick={() => onIndex(0)}>
          {t('game.lineStart')}
        </button>
        {sans.map((san, i) => (
          <button key={i} type="button" aria-current={index === i + 1 ? 'true' : undefined} onClick={() => onIndex(i + 1)}>
            {nums[i] && <span className="num">{nums[i]}</span>}
            <bdi dir="ltr">{san}</bdi>
            <GradeMark grade={grades[gradeKey(fenAfterLine(baseFen, moves.slice(0, i)), moves[i]!)]} />
          </button>
        ))}
      </div>
      {user && !engineOn && <p className="small muted line-tip">{t('line.tip')}</p>}
    </div>
  );
}

/** One row with the live engine's evaluation, depth and best line for the position on the board. */
export function LiveEngineRow({ live }: { live: LiveEval | null }) {
  const { t } = useT();
  const line = live?.line;
  const san = line ? uciLineToSan(live.fen, line.pvUci, 8) : [];
  const nums = live ? numbers(live.fen, san.length) : [];
  return (
    <div className="live-engine" aria-live="off">
      {!live?.done && <Spinner />}
      {line ? (
        <>
          <strong className="live-score">
            <bdi dir="ltr">{formatScore(line.score)}</bdi>
          </strong>
          <span className="muted small">{t('engine.depth', { d: live.depth })}</span>
          <span className="live-line" dir="ltr">
            {san.map((m, i) => `${nums[i] ? nums[i] + ' ' : ''}${m}`).join(' ')}
          </span>
        </>
      ) : (
        <span className="muted small">{t('engine.thinking')}</span>
      )}
    </div>
  );
}

/** "Learn from your mistakes": the current position's prompt, the verdict on the tried move, and the actions. */
export function PracticePanel({
  practice,
  move,
  fen,
  grade,
  onTryAgain,
  onHint,
  onSolution,
  onNext,
  onExit,
  onRestart,
}: {
  practice: PracticeState;
  /** Analysis of the mistake being practised and the position before it (undefined when finished). */
  move?: MoveAnalysis;
  fen?: string;
  grade?: Pending<MoveGrade>;
  onTryAgain: () => void;
  onHint: () => void;
  onSolution: () => void;
  onNext: (result: 'first' | 'retry' | 'skipped') => void;
  onExit: () => void;
  onRestart: () => void;
}) {
  const { t } = useT();
  const { plies, index, attempt, solution, tries } = practice;
  const finished = index >= plies.length;
  const side = practice.side === 'w' ? t('practice.white') : t('practice.black');
  const last = index === plies.length - 1;

  const dots = (
    <ol className="practice-dots" aria-label={t('practice.progress', { i: Math.min(index + 1, plies.length), n: plies.length })}>
      {plies.map((ply, i) => (
        <li
          key={ply}
          className={practice.results[i] ?? (i === index ? 'current' : '')}
          aria-current={i === index ? 'step' : undefined}
        />
      ))}
    </ol>
  );

  let body;
  if (finished) {
    const solved = practice.results.filter((r) => r === 'first').length;
    body = (
      <>
        <p className="practice-msg success">{t('practice.done', { solved, n: plies.length })}</p>
        <div className="row">
          <button type="button" className="primary" onClick={onRestart}>
            {t('practice.again')}
          </button>
        </div>
      </>
    );
  } else if (!move) {
    body = null;
  } else {
    const bestUci = move.bestMoveUci ?? move.lines[0]?.pvUci[0];
    const bestSan = bestUci && fen ? uciLineToSan(fen, [bestUci], 1)[0] : undefined;
    const nextLabel = last ? t('practice.finish') : t('practice.next');
    const ok = grade?.status === 'done' && GOOD_ENOUGH.includes(grade.value.category);
    let verdict;
    let actions;
    if (solution) {
      verdict = <p className="practice-msg">{t('practice.solutionText', { san: bestSan ?? '?' })}</p>;
      actions = (
        <button type="button" className="primary" onClick={() => onNext('skipped')}>
          {nextLabel}
        </button>
      );
    } else if (attempt && (!grade || grade.status === 'running')) {
      verdict = (
        <p className="practice-msg">
          <Spinner /> {t('practice.checking')}
        </p>
      );
    } else if (attempt && grade?.status === 'error') {
      verdict = <p className="practice-msg error">{t('practice.error', { error: grade.error })}</p>;
      actions = (
        <button type="button" onClick={onTryAgain}>
          {t('practice.tryAgain')}
        </button>
      );
    } else if (attempt && grade?.status === 'done') {
      const g = grade.value;
      verdict = ok ? (
        <p className="practice-msg success">
          <CategoryBadge category={g.category} /> {t('practice.correct', { san: g.san, category: categoryLabel(g.category) })}
        </p>
      ) : (
        <p className="practice-msg fail">
          <CategoryBadge category={g.category} />{' '}
          {attempt === move.uci
            ? t('practice.same', { san: g.san })
            : t('practice.wrong', { san: g.san, category: categoryLabel(g.category), eval: formatScore(g.played) })}
        </p>
      );
      actions = ok ? (
        <button type="button" className="primary" onClick={() => onNext(tries === 0 ? 'first' : 'retry')}>
          {nextLabel}
        </button>
      ) : (
        <>
          <button type="button" className="primary" onClick={onTryAgain}>
            {t('practice.tryAgain')}
          </button>
          <button type="button" onClick={onSolution}>
            {t('practice.solution')}
          </button>
        </>
      );
    } else {
      verdict = (
        <p className="practice-msg">
          {t('practice.prompt', { san: move.san, side })}
          {practice.hint && <span className="practice-hint"> {t('practice.hintText')}</span>}
        </p>
      );
      actions = (
        <>
          {!practice.hint && (
            <button type="button" onClick={onHint}>
              {t('practice.hint')}
            </button>
          )}
          <button type="button" onClick={onSolution}>
            {t('practice.solution')}
          </button>
          <button type="button" onClick={() => onNext('skipped')}>
            {t('practice.skip')}
          </button>
        </>
      );
    }
    body = (
      <>
        <div aria-live="polite">{verdict}</div>
        {actions && <div className="row">{actions}</div>}
      </>
    );
  }

  return (
    <section className="practice-panel" aria-labelledby="practice-title">
      <div className="row practice-head">
        <h2 id="practice-title">{t('practice.title')}</h2>
        <span className="small muted">{finished ? '' : t('practice.progress', { i: index + 1, n: plies.length })}</span>
        <button type="button" className="practice-exit" onClick={onExit}>
          {t('practice.exit')}
        </button>
      </div>
      {dots}
      {body}
    </section>
  );
}
