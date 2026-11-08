import { useEffect, useState } from 'react';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../core/classification/classify';
import { CategoryBadge } from '../../components/CategoryBadge';
import { api, query, type GameFilters, type Stats } from './api';
import { LoginForm } from './LibraryView';
import { useAuth } from './AuthContext';

function TrendChart({ points }: { points: Stats['accuracy_trend'] }) {
  if (points.length < 2) return <p className="small muted">Analyse at least two games to see a trend.</p>;
  const W = 600;
  const H = 160;
  const x = (i: number) => 8 + (i / (points.length - 1)) * (W - 16);
  const y = (a: number) => H - 8 - (a / 100) * (H - 16);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join('');
  // 5-game moving average
  const ma = points.map((_, i) => {
    const w = points.slice(Math.max(0, i - 4), i + 1);
    return w.reduce((s, p) => s + p.accuracy, 0) / w.length;
  });
  const dm = ma.map((a, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(a).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ height: 180 }} role="img" aria-label="Accuracy trend over analysed games">
      <rect width={W} height={H} fill="var(--surface-2)" />
      {[25, 50, 75].map((v) => (
        <g key={v}>
          <line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--border)" />
          <text x={4} y={y(v) - 2} fontSize={10} fill="var(--muted)">{v}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--muted)" strokeWidth={1} />
      <path d={dm} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
      {points.map((p, i) => (
        <circle key={p.game} cx={x(i)} cy={y(p.accuracy)} r={3} fill={p.result === 'win' ? 'var(--cat-best)' : p.result === 'loss' ? 'var(--cat-blunder)' : 'var(--muted)'}>
          <title>{`${p.played_at ? new Date(p.played_at).toLocaleDateString() : ''} vs ${p.opponent}: ${p.accuracy}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function StatsView() {
  const { me, loading } = useAuth();
  const [filters, setFilters] = useState<GameFilters>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    api<Stats>(`stats/${query(filters)}`).then(setStats, (e) => setError((e as Error).message));
  }, [me, filters]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!me) return <LoginForm />;

  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Your statistics</h2>
        <select value={filters.time_class ?? ''} onChange={(e) => setFilters((f) => ({ ...f, time_class: e.target.value }))} aria-label="Time control">
          <option value="">All time controls</option>
          {['bullet', 'blitz', 'rapid', 'classical', 'daily'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.colour ?? ''} onChange={(e) => setFilters((f) => ({ ...f, colour: e.target.value }))} aria-label="Colour">
          <option value="">Both colours</option>
          <option value="w">As White</option>
          <option value="b">As Black</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {stats && (
        <>
          <div className="stats-grid">
            <div className="stat"><div className="small muted">Games</div><div className="value">{stats.games}</div></div>
            <div className="stat"><div className="small muted">Analysed</div><div className="value">{stats.analysed_games}</div></div>
            <div className="stat"><div className="small muted">Avg. accuracy (ours)</div><div className="value">{stats.average_accuracy ?? '—'}</div></div>
            <div className="stat"><div className="small muted">W / D / L</div><div className="value">{stats.results.win} / {stats.results.draw} / {stats.results.loss}</div></div>
          </div>
          <section className="panel">
            <h2>Accuracy trend</h2>
            <TrendChart points={stats.accuracy_trend} />
            <p className="small muted">Thin line: per game. Thick line: 5-game moving average. Dots: green win, red loss.</p>
          </section>
          <div className="layout" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <section className="panel">
              <h2>Your move labels by phase</h2>
              <table className="summary-table">
                <thead>
                  <tr><th />{Object.keys(stats.by_phase).map((p) => <th key={p}>{p}</th>)}<th>total</th></tr>
                </thead>
                <tbody>
                  {CATEGORY_ORDER.map((c) => (
                    <tr key={c}>
                      <th scope="row"><CategoryBadge category={c} /> {CATEGORY_LABELS[c].label}</th>
                      {Object.values(stats.by_phase).map((p, i) => <td key={i}>{p[c] ?? 0}</td>)}
                      <td>{stats.categories[c] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="panel">
              <h2>By time control</h2>
              <table className="summary-table">
                <thead><tr><th>Type</th><th>Analysed</th><th>Accuracy</th></tr></thead>
                <tbody>
                  {Object.entries(stats.by_time_class).map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td>{v.games}</td><td>{v.accuracy ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
              <h3>Openings</h3>
              <table className="summary-table">
                <thead><tr><th>Opening</th><th>Games</th><th>Score</th><th>Accuracy</th></tr></thead>
                <tbody>
                  {stats.openings.map((o) => (
                    <tr key={o.opening}><td>{o.opening}</td><td>{o.games}</td><td>{o.score_pct}%</td><td>{o.accuracy ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <p className="small muted">{stats.notes}</p>
        </>
      )}
    </div>
  );
}
