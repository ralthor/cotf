import { useEffect, useRef } from 'react';
import type { MoveRecord } from '../core/chess/types';
import type { MoveAnalysis } from '../features/analysis/types';
import { CategoryBadge } from './CategoryBadge';

export type MoveFilter = 'all' | 'errors' | 'blunders' | 'brilliant';

function matches(a: MoveAnalysis | undefined, f: MoveFilter): boolean {
  if (f === 'all') return true;
  if (!a?.category) return false;
  if (f === 'blunders') return a.category === 'blunder';
  if (f === 'errors') return a.category === 'mistake' || a.category === 'blunder' || a.category === 'questionable';
  return a.category === 'brilliant' || a.brilliance?.verdict === 'candidate';
}

export function MoveList({
  moves,
  analysis,
  current,
  onSelect,
  filter,
}: {
  moves: MoveRecord[];
  analysis?: (MoveAnalysis | undefined)[];
  current: number;
  onSelect: (positionIndex: number) => void;
  filter: MoveFilter;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const rows: { num: number; w?: number; b?: number }[] = [];
  moves.forEach((m, i) => {
    if (m.colour === 'w' || rows.length === 0) rows.push({ num: m.fullMoveNumber });
    const row = rows[rows.length - 1]!;
    if (m.colour === 'w') row.w = i;
    else row.b = i;
  });

  const cell = (i?: number) => {
    if (i === undefined) return <span />;
    const m = moves[i]!;
    const a = analysis?.[i];
    return (
      <button
        type="button"
        aria-current={current === i + 1 ? 'true' : undefined}
        className={matches(a, filter) ? '' : 'dim'}
        onClick={() => onSelect(i + 1)}
        aria-label={`${m.fullMoveNumber}${m.colour === 'w' ? '.' : '...'} ${m.san}${a?.category ? `, ${a.category}` : ''}`}
      >
        <span>{m.san}</span>
        <CategoryBadge category={a?.category} candidate={a?.brilliance?.verdict === 'candidate'} />
      </button>
    );
  };

  return (
    <div className="move-list" ref={ref} role="list" aria-label="Moves">
      {rows.map((r) => (
        <div key={r.num} style={{ display: 'contents' }} role="listitem">
          <span className="num">{r.num}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}
