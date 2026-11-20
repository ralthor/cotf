import { useMemo, useState } from 'react';
import { Chessboard, type PieceDropHandlerArgs, type SquareHandlerArgs } from 'react-chessboard';
import { displayComments } from '../../core/repertoire/parse';
import { hintFor, positionLabel } from '../../core/repertoire/trainer';
import type { Chapter, Repertoire, ShapeColor, Side, TrainMode } from '../../core/repertoire/types';
import { getLocale, t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { getPref, setPref } from '../../storage/prefs';
import { legalMove } from '../explore/grade';
import { accepted, useTrainer, type Mistake, type Note, type Session } from './useTrainer';

const SHAPE: Record<ShapeColor, string> = {
  green: 'rgba(21,120,27,0.8)',
  red: 'rgba(136,32,32,0.8)',
  yellow: 'rgba(230,143,0,0.8)',
  blue: 'rgba(0,48,136,0.8)',
};
const LAST_MOVE = 'rgba(47,111,143,0.28)';
const HINT = 'rgba(230,143,0,0.45)';
const MOVE_ARROW = 'rgba(21,120,27,0.8)';
const SELECTED = 'rgba(47,111,143,0.5)';

/** "3… Bf5" for a note's move. */
function moveLabel(n: Note): string {
  const parts = n.parent.fen.split(' ');
  return `${parts[5] ?? '1'}${parts[1] === 'b' ? '…' : '.'} ${n.node.san ?? ''}`;
}

/** "in 3 days", "in 5 hours" in the page language. */
function relative(date: Date): string {
  const s = (date.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  if (s < 3600) return rtf.format(Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export function initialSide(chapters: readonly Chapter[]): Side {
  const saved = getPref('trainSide');
  const sides = new Set(chapters.map((c) => c.side));
  if ((saved === 'w' || saved === 'b') && sides.has(saved)) return saved;
  return chapters[0]?.side ?? 'w';
}

export function TrainerView({ repertoire, chapters }: { repertoire: Repertoire | null; chapters: readonly Chapter[] }) {
  useT();
  const [sideState, setSideState] = useState<Side | null>(null);
  const side = sideState ?? initialSide(chapters);
  const setSide = (s: Side) => {
    setSideState(s);
    setPref('trainSide', s);
  };
  const [scope, setScope] = useState<string>('');
  const sideChapters = useMemo(() => chapters.filter((c) => c.side === side), [chapters, side]);
  const scopeChapter = sideChapters.find((c) => c.id === scope);
  const inScope = useMemo(() => (scopeChapter ? [scopeChapter] : sideChapters), [scopeChapter, sideChapters]);
  const [noHints, setNoHintsState] = useState(() => getPref('trainNoHints') === '1');
  const setNoHints = (v: boolean) => {
    setNoHintsState(v);
    setPref('trainNoHints', v ? '1' : null);
  };

  const tr = useTrainer(repertoire?.id ?? null, inScope, side);
  const { session, counts } = tr;

  if (!repertoire) return <div className="panel">{t('repertoire.intro')}</div>;
  if (session) return <TrainingBoard tr={tr} session={session} side={side} noHints={noHints} />;

  const sideName = t(side === 'w' ? 'repertoire.white' : 'repertoire.black');
  const sides = new Set(chapters.map((c) => c.side));
  const modes: { mode: TrainMode; n: number; label: string }[] = [
    { mode: 'learn', n: counts.fresh, label: tn('train.learnCount', counts.fresh) },
    { mode: 'memorise', n: counts.due, label: tn('train.dueCount', counts.due) },
    { mode: 'review', n: Math.max(counts.weak, tr.mistakes.length), label: tn('train.weakCount', Math.max(counts.weak, tr.mistakes.length)) },
  ];

  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="train-title">
        <h2 id="train-title" style={{ margin: 0 }}>
          {t('train.title')} · <bdi>{repertoire.name}</bdi>
        </h2>
        <div className="row train-options">
          <div className="segmented" role="group" aria-label={t('train.side')}>
            {(['w', 'b'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={side === s} disabled={!sides.has(s)} onClick={() => setSide(s)}>
                {t(s === 'w' ? 'repertoire.white' : 'repertoire.black')}
              </button>
            ))}
          </div>
          <label className="row small">
            {t('train.scope')}
            <select value={scopeChapter?.id ?? ''} onChange={(e) => setScope(e.target.value)}>
              <option value="">{t('train.scopeAll')}</option>
              {sideChapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="row small">
            <input type="checkbox" checked={noHints} onChange={(e) => setNoHints(e.target.checked)} />
            {t('train.noHints')}
          </label>
        </div>
        {counts.cards === 0 ? (
          <p className="muted">{t('train.noCards', { side: sideName })}</p>
        ) : (
          <div className="train-modes">
            {modes.map(({ mode, n, label }) => (
              <button key={mode} type="button" className={`train-mode${n > 0 ? ' has-work' : ''}`} disabled={!tr.loaded || n === 0} onClick={() => tr.start(mode)}>
                <strong>{t(`train.${mode}`)}</strong>
                <span className="small">{label}</span>
                <span className="small muted">{t(`train.${mode}Help`)}</span>
              </button>
            ))}
          </div>
        )}
        {counts.cards > 0 && counts.due === 0 && counts.nextDue && <p className="small muted">{t('train.nextDue', { when: relative(counts.nextDue) })}</p>}
        <p className="small muted" style={{ margin: 0 }}>
          {tn('train.positions', counts.cards, { side: sideName })}
        </p>
      </section>
      <MistakeList mistakes={tr.mistakes} label={(k) => positionLabel(tr.graph, k)} onPractise={(k) => tr.start('review', k)} onPractiseAll={() => tr.start('review')} />
    </div>
  );
}

function MistakeList({
  mistakes,
  label,
  onPractise,
  onPractiseAll,
}: {
  mistakes: Mistake[];
  label: (posKey: string) => string;
  onPractise: (posKey: string) => void;
  onPractiseAll: () => void;
}) {
  const shown = mistakes.slice(0, 12);
  return (
    <section className="panel" aria-labelledby="mistakes-title">
      <div className="row">
        <h2 id="mistakes-title" style={{ margin: 0, flex: 1 }}>
          {t('train.mistakes.title')}
        </h2>
        {mistakes.length > 0 && (
          <button type="button" className="small" onClick={onPractiseAll}>
            {t('train.practiseAll')}
          </button>
        )}
      </div>
      {mistakes.length === 0 ? (
        <p className="small muted">{t('train.mistakes.none')}</p>
      ) : (
        <ul className="mistake-list">
          {shown.map((m) => (
            <li key={m.posKey}>
              <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <bdi dir="ltr" className="mistake-line">
                  {label(m.posKey) || '…'}
                </bdi>
                <span className="small muted">
                  {m.wrong.length
                    ? t('train.mistakes.row', { wrong: m.wrong.join(', '), expected: m.expected.join(', ') })
                    : t('train.mistakes.rowShown', { expected: m.expected.join(', ') })}{' '}
                  · {tn('train.mistakes.times', m.times)}
                </span>
              </div>
              <button type="button" className="small" onClick={() => onPractise(m.posKey)}>
                {t('train.practise')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TrainingBoard({ tr, session: s, side, noHints }: { tr: ReturnType<typeof useTrainer>; session: Session; side: Side; noHints: boolean }) {
  const ask = s.ask;
  const asking = s.phase === 'ask' && !!ask;
  // Click-to-move: the square picked first (forgotten when the position changes).
  const [picked, setPicked] = useState<{ fen: string; square: string } | null>(null);
  const selected = asking && picked?.fen === s.fen ? picked.square : null;
  // While you are asked (outside Learn's shown moves), the opponent's comments could give the answer away.
  const hideLatest = asking && !ask.intro;
  const notes = hideLatest ? s.notes.filter((n, i) => !(i === s.notes.length - 1 && !n.mine)) : s.notes;
  const latest = notes[notes.length - 1];

  const arrows = useMemo(() => {
    const out: { startSquare: string; endSquare: string; color: string }[] = [];
    if (latest && latest === s.notes[s.notes.length - 1]) {
      for (const sh of latest.node.shapes ?? []) if (sh.from !== sh.to) out.push({ startSquare: sh.from, endSquare: sh.to, color: SHAPE[sh.color] });
    }
    if (ask && (ask.intro || ask.shown)) {
      for (const m of accepted(ask)) out.push({ startSquare: m.uci.slice(0, 2), endSquare: m.uci.slice(2, 4), color: MOVE_ARROW });
    } else if (ask && ask.hint >= 3) {
      for (const [a, b] of hintFor(accepted(ask), 3).arrows) out.push({ startSquare: a, endSquare: b, color: HINT });
    }
    // One arrow per pair of squares (the board keys arrows by them): the trainer's arrow wins over the study's.
    return [...new Map(out.map((a) => [`${a.startSquare}${a.endSquare}`, a])).values()];
  }, [latest, s.notes, ask]);

  const squareStyles = useMemo(() => {
    const out: Record<string, React.CSSProperties> = {};
    if (s.lastUci) for (const sq of [s.lastUci.slice(0, 2), s.lastUci.slice(2, 4)]) out[sq] = { background: LAST_MOVE };
    if (latest && latest === s.notes[s.notes.length - 1]) {
      for (const sh of latest.node.shapes ?? []) if (sh.from === sh.to) out[sh.from] = { ...out[sh.from], boxShadow: `inset 0 0 0 4px ${SHAPE[sh.color]}`, borderRadius: '50%' };
    }
    if (ask && ask.hint > 0 && ask.hint < 3) for (const sq of hintFor(accepted(ask), ask.hint).squares) out[sq] = { ...out[sq], background: HINT };
    if (selected) out[selected] = { ...out[selected], background: SELECTED };
    return out;
  }, [s.lastUci, s.notes, latest, ask, selected]);

  const onPieceDrop = ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (!asking || !targetSquare || sourceSquare === targetSquare) return false;
    setPicked(null);
    const m = legalMove(s.fen, sourceSquare, targetSquare);
    return m ? tr.answer(m.uci, m.san) : false;
  };
  const onSquareClick = ({ square, piece }: SquareHandlerArgs) => {
    if (!asking) return;
    if (piece && piece.pieceType[0] === side) return setPicked(square === selected ? null : { fen: s.fen, square });
    if (!selected) return;
    setPicked(null);
    const m = legalMove(s.fen, selected, square);
    if (m) tr.answer(m.uci, m.san);
  };

  const good = s.results.filter((r) => r === 'good').length;
  const lineGood = s.lineResults.filter((r) => r === 'good').length;
  const expectedSan = ask ? accepted(ask).map((m) => m.san).join(', ') : '';

  let prompt: React.ReactNode = null;
  if (s.phase === 'done') {
    prompt = <p className="practice-msg success">{s.results.length ? t('train.done', { good, n: s.results.length }) : t('train.doneEmpty')}</p>;
  } else if (s.phase === 'lineEnd') {
    prompt = <p className="practice-msg success">{s.lineResults.length ? t('train.lineEnd', { good: lineGood, n: s.lineResults.length }) : t('train.lineEndNone')}</p>;
  } else if (s.phase === 'feedback') {
    const last = s.results[s.results.length - 1];
    prompt = <p className={`practice-msg ${last === 'good' ? 'success' : ''}`}>{last === 'good' ? t('train.correct') : t('train.correctAfter')}</p>;
  } else if (s.phase === 'opponent') {
    prompt = <p className="practice-msg muted">{t('train.opponent')}</p>;
  } else if (ask) {
    const base = ask.intro
      ? t('train.playShown', { san: ask.expected?.san ?? '' })
      : s.stage === 'replay' && s.replayIndex <= 1
        ? t('train.replay')
        : t('train.yourMove');
    prompt = (
      <>
        <p className="practice-msg">
          <bdi>{base}</bdi>
        </p>
        {ask.notice && (
          <p className={`practice-msg ${ask.notice.kind === 'wrong' ? 'fail' : ''}`}>
            {t(ask.notice.kind === 'wrong' ? 'train.wrong' : 'train.other', { san: ask.notice.san })}
          </p>
        )}
        {ask.shown && !ask.intro && <p className="practice-msg">{t('train.shownText', { san: expectedSan })}</p>}
        {!ask.shown && !ask.intro && ask.hint > 0 && <p className="small muted">{t(`train.hint${ask.hint}`)}</p>}
      </>
    );
  }

  const modeName = t(`train.${s.mode}`);
  const total = s.mode === 'review' ? s.queue.length : 0;

  return (
    <div className="stack">
      <div className="game-title row">
        <h2 style={{ margin: 0, fontSize: 18, flex: 1, minWidth: 0 }}>
          {modeName}
          {total > 1 && <span className="small muted"> · {t('practice.progress', { i: Math.min(s.queueIndex + 1, total), n: total })}</span>}
        </h2>
        <span className="small muted">{t('train.progress', { n: s.results.length, good })}</span>
        <button type="button" onClick={tr.stop}>
          {s.phase === 'done' ? t('train.back') : t('train.stop')}
        </button>
      </div>
      <div className="chapter-view">
        <div className="board-col">
          <div className="board-wrap" dir="ltr">
            <Chessboard
              options={{
                id: 'train-board',
                position: s.fen || 'start',
                boardOrientation: side === 'b' ? 'black' : 'white',
                allowDragging: asking,
                canDragPiece: ({ piece }) => piece.pieceType[0] === side,
                onPieceDrop,
                onSquareClick,
                arrows,
                squareStyles,
                lightSquareStyle: { backgroundColor: 'var(--board-light)' },
                darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
                animationDurationInMs: 200,
              }}
            />
          </div>
        </div>
        <div className="stack side">
          <section className="panel stack train-prompt" aria-live="polite">
            {prompt}
            <div className="row">
              {asking && !ask.intro && !noHints && !ask.shown && (
                <button type="button" onClick={tr.hint} disabled={ask.hint >= 3}>
                  {t('train.hint')}
                </button>
              )}
              {asking && !ask.intro && !ask.shown && (
                <button type="button" onClick={tr.show}>
                  {t('train.show')}
                </button>
              )}
              {(s.phase === 'lineEnd' || s.phase === 'feedback') && (
                <button type="button" className="primary" onClick={tr.next}>
                  {s.mode === 'review' ? (s.queueIndex + 1 < s.queue.length ? t('train.nextPosition') : t('train.finish')) : t('train.nextLine')}
                </button>
              )}
              {s.phase === 'done' && (
                <button type="button" className="primary" onClick={tr.stop}>
                  {t('train.back')}
                </button>
              )}
            </div>
          </section>
          {notes.length > 0 && (
            <section className="panel chapter-comment">
              {notes.map((n, i) => {
                const before = displayComments(n.node.commentsBefore);
                const after = displayComments(n.node.comments);
                return (
                  <div key={i}>
                    <h3 style={{ marginTop: i ? 12 : 0 }}>
                      <bdi dir="ltr">{moveLabel(n)}</bdi>
                    </h3>
                    {[...before, ...after].map((c, j) => (
                      <p key={j} dir="auto">
                        {c}
                      </p>
                    ))}
                    {!before.length && !after.length && <p className="small muted">{t('repertoire.noComment')}</p>}
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
