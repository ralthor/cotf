import type { EngineScore } from '../core/engine/types';
import type { MoveCategory } from '../core/classification/classify';
import { expectedScore, formatScore } from '../core/scoring/score';

type Props = {
  evals: (EngineScore | undefined)[];
  categories: (MoveCategory | undefined)[]; // per ply (index = ply - 1)
  current: number; // position index
  onSelect: (positionIndex: number) => void;
};

const W = 600;
const H = 120;

/** White's expected score across the game (0..1), with markers for serious errors. */
export function EvalChart({ evals, categories, current, onSelect }: Props) {
  const n = evals.length;
  if (n < 2) return null;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (s: EngineScore | undefined) => H - (s ? expectedScore(s, 'w') : 0.5) * H;
  let d = '';
  let started = false;
  evals.forEach((s, i) => {
    if (!s) {
      started = false;
      return;
    }
    d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(s).toFixed(1)}`;
    started = true;
  });
  const area = evals.every(Boolean) ? `${d}L${W},${H}L0,${H}Z` : '';

  const handle = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    onSelect(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={handle}
      role="img"
      aria-label={`Evaluation graph. Current position ${current}: ${formatScore(evals[current])}`}
    >
      <rect width={W} height={H} fill="var(--eval-black)" />
      {area && <path d={area} fill="var(--eval-white)" />}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--muted)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      {categories.map((c, i) =>
        c === 'blunder' || c === 'mistake' || c === 'brilliant' || c === 'great' ? (
          <circle key={i} cx={x(i + 1)} cy={y(evals[i + 1])} r={3.5} fill={`var(--cat-${c})`} vectorEffect="non-scaling-stroke" />
        ) : null,
      )}
      <line x1={x(current)} x2={x(current)} y1={0} y2={H} stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
