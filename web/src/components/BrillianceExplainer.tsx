import { useEffect, useRef } from 'react';
import type { BrillianceEvidence } from '../core/brilliancy/detector';

export function BrillianceDetails({ evidence }: { evidence: BrillianceEvidence }) {
  const s = evidence.signals;
  const n = (v: number | null, d = 1) => (v === null ? '—' : v.toFixed(d));
  return (
    <div className="stack">
      <p>
        Verdict: <strong>{evidence.verdict === 'candidate' ? 'Brilliant candidate (unconfirmed)' : evidence.verdict}</strong> · score{' '}
        {evidence.score}/100 · confidence {evidence.confidence} · {evidence.version}
      </p>
      <table className="data">
        <tbody>
          <tr><th>Worst shallow rank</th><td>{s.shallowWorstRank === null ? '—' : `#${s.shallowWorstRank}${s.shallowRankIsExact ? '' : '+ (lower bound)'}`}</td></tr>
          <tr><th>Deep rank</th><td>{s.deepRank ? '#1 / tied' : 'not best'}</td></tr>
          <tr><th>Worst shallow expected score (mover)</th><td>{n(s.shallowWorstExpectedPct)}%</td></tr>
          <tr><th>Deep expected score (mover)</th><td>{n(s.deepExpectedPct)}%</td></tr>
          <tr><th>Depth inversion (same move)</th><td>{n(s.inversionPct)} pts</td></tr>
          <tr><th>Gap to second-best</th><td>{n(s.uniquenessGapPct)} pts</td></tr>
          <tr><th>Discovery</th><td>{s.discoveryInterval ? `between depth ${s.discoveryInterval[0]} and ${s.discoveryInterval[1]}` : n(s.discoveryDepth, 0)}</td></tr>
          <tr><th>Material sacrifice</th><td>{s.sacrifice ? 'yes' : 'no'}</td></tr>
          <tr><th>Stable on recheck</th><td>{s.stable === null ? 'not checked' : s.stable ? 'yes' : 'no'}</td></tr>
        </tbody>
      </table>
      <h3>Gates</h3>
      <ul className="small">
        {evidence.gates.map((g) => (
          <li key={g.name}>
            <span className={g.passed ? 'pass' : 'fail'}>{g.passed ? '✔' : '✘'}</span> <strong>{g.name}</strong>: {g.detail}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Experimental heuristic: a move that the engine underrates at shallow depth but finds best and sound at depth. Engine
        depth does not measure human difficulty; treat this as evidence, not a verdict.
      </p>
    </div>
  );
}

export function BrillianceModal({ evidence, title, onClose }: { evidence: BrillianceEvidence; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <BrillianceDetails evidence={evidence} />
      </div>
    </div>
  );
}
