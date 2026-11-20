import { useMemo, useState } from 'react';
import { computeStats, type DayCount } from '../../core/repertoire/stats';
import { positionLabel } from '../../core/repertoire/trainer';
import type { Chapter, Repertoire, Side } from '../../core/repertoire/types';
import { getLocale, t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { setPref } from '../../storage/prefs';
import { initialSide, TrainingBoard } from './TrainerView';
import { useTrainer } from './useTrainer';

const pct = (x: number) => new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(x);
const dayLabel = (day: string) => new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00`));

function Tile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <strong dir="auto">{value}</strong>
      <span className="small">{label}</span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

/** Answers per day: one bar per day; hovering or focusing a bar shows its numbers above the chart. */
function DayChart({ days }: { days: DayCount[] }) {
  const [active, setActive] = useState<DayCount | null>(null);
  const max = Math.max(1, ...days.map((d) => d.answers));
  const total = days.reduce((s, d) => s + d.answers, 0);
  const shown = active ?? null;
  return (
    <figure className="day-chart" style={{ margin: 0 }}>
      <figcaption className="small muted" aria-live="polite">
        {shown
          ? t('progress.dayDetail', { day: dayLabel(shown.day), n: shown.answers, good: shown.good })
          : tn('progress.last30', total)}
      </figcaption>
      <div className="day-bars" dir="ltr" onMouseLeave={() => setActive(null)}>
        {days.map((d) => (
          <div
            key={d.day}
            className="day-bar"
            tabIndex={0}
            aria-label={t('progress.dayDetail', { day: dayLabel(d.day), n: d.answers, good: d.good })}
            onMouseEnter={() => setActive(d)}
            onFocus={() => setActive(d)}
            onBlur={() => setActive(null)}
          >
            <div style={{ height: d.answers ? `${Math.max(6, (d.answers / max) * 100)}%` : 0 }} data-active={active === d ? '' : undefined} />
          </div>
        ))}
      </div>
      <div className="row small muted day-axis" dir="ltr">
        <span>{dayLabel(days[0]!.day)}</span>
        <span>{dayLabel(days[days.length - 1]!.day)}</span>
      </div>
      <div className="sr-only">
        <table>
          <caption>{t('progress.perDay')}</caption>
          <thead>
            <tr>
              <th>{t('progress.day')}</th>
              <th>{t('progress.answers')}</th>
              <th>{t('progress.firstTime')}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td>{dayLabel(d.day)}</td>
                <td>{d.answers}</td>
                <td>{d.good}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** The Progress sub-tab: what is learnt and mastered, accuracy, activity, chapters, hardest positions. */
export function ProgressView({ repertoire, chapters }: { repertoire: Repertoire | null; chapters: readonly Chapter[] }) {
  useT();
  const [sideState, setSideState] = useState<Side | null>(null);
  const side = sideState ?? initialSide(chapters);
  const sideChapters = useMemo(() => chapters.filter((c) => c.side === side), [chapters, side]);
  const tr = useTrainer(repertoire?.id ?? null, sideChapters, side);
  const stats = useMemo(() => computeStats(tr.graph.cards, sideChapters, tr.cards, tr.log), [tr.graph, sideChapters, tr.cards, tr.log]);

  if (!repertoire) return <div className="panel">{t('repertoire.intro')}</div>;
  if (tr.session) return <TrainingBoard tr={tr} session={tr.session} side={side} noHints={false} />;

  const sides = new Set(chapters.map((c) => c.side));
  const sideName = t(side === 'w' ? 'repertoire.white' : 'repertoire.black');
  const change =
    stats.accuracy !== null && stats.previousAccuracy !== null
      ? t('progress.change', { delta: `${stats.accuracy >= stats.previousAccuracy ? '+' : '−'}${pct(Math.abs(stats.accuracy - stats.previousAccuracy))}` })
      : undefined;

  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="progress-title">
        <div className="row">
          <h2 id="progress-title" style={{ margin: 0, flex: 1 }}>
            {t('progress.title')} · <bdi>{repertoire.name}</bdi>
          </h2>
          <div className="segmented" role="group" aria-label={t('train.side')}>
            {(['w', 'b'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={side === s}
                disabled={!sides.has(s)}
                onClick={() => {
                  setSideState(s);
                  setPref('trainSide', s);
                }}
              >
                {t(s === 'w' ? 'repertoire.white' : 'repertoire.black')}
              </button>
            ))}
          </div>
        </div>
        {stats.positions === 0 ? (
          <p className="muted">{t('train.noCards', { side: sideName })}</p>
        ) : (
          <>
            <div className="stat-tiles">
              <Tile value={`${stats.learnt} / ${stats.positions}`} label={t('progress.learnt')} sub={pct(stats.learnt / stats.positions)} />
              <Tile value={String(stats.mastered)} label={t('progress.mastered')} sub={t('progress.masteredHelp')} />
              <Tile value={String(stats.due)} label={t('progress.due')} />
              <Tile value={stats.accuracy === null ? '–' : pct(stats.accuracy)} label={t('progress.accuracy')} sub={change} />
            </div>
            <DayChart days={stats.days} />
            <div className="stat-tiles">
              <Tile value={tn('progress.days', stats.streak)} label={t('progress.streak')} />
              <Tile value={tn('progress.days', stats.bestStreak)} label={t('progress.bestStreak')} />
              <Tile value={String(stats.bestDay?.answers ?? 0)} label={t('progress.bestDay')} sub={stats.bestDay ? dayLabel(stats.bestDay.day) : undefined} />
              <Tile value={String(stats.bestRun)} label={t('progress.bestRun')} />
            </div>
          </>
        )}
      </section>

      {stats.chapters.length > 0 && (
        <section className="panel" aria-labelledby="progress-chapters">
          <h2 id="progress-chapters">{t('progress.chapters')}</h2>
          <ul className="chapter-progress">
            {stats.chapters.map((c) => (
              <li key={c.chapter.id}>
                <div className="row">
                  <bdi style={{ flex: 1, minWidth: 0 }}>{c.chapter.title}</bdi>
                  <span className="small muted">
                    {t('progress.chapterLine', { learnt: c.learnt, n: c.positions, mastered: c.mastered })}
                    {c.answers > 0 && ` · ${t('progress.chapterAccuracy', { pct: pct(c.good / c.answers) })}`}
                  </span>
                </div>
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={c.positions} aria-valuenow={c.learnt} aria-label={c.chapter.title}>
                  <div style={{ width: `${c.positions ? (c.learnt / c.positions) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel" aria-labelledby="progress-hardest">
        <h2 id="progress-hardest">{t('progress.hardest')}</h2>
        {stats.hardest.length === 0 ? (
          <p className="small muted">{t('progress.hardestNone')}</p>
        ) : (
          <ul className="mistake-list">
            {stats.hardest.map((h) => (
              <li key={h.posKey}>
                <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <bdi dir="ltr" className="mistake-line">
                    {positionLabel(tr.graph, h.posKey) || '…'}
                  </bdi>
                  <span className="small muted">{t('progress.failed', { failed: h.failed, n: h.answers })}</span>
                </div>
                <button type="button" className="small" onClick={() => tr.start('review', h.posKey)}>
                  {t('train.practise')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
