import { useEffect, useRef, type ReactNode } from 'react';
import { ordinal, type BrillianceEvidence } from '../core/brilliancy/detector';
import type { GreatEvidence } from '../core/brilliancy/great';

const n1 = (v: number | null) => (v === null ? '—' : v.toFixed(1));

export function BrillianceDetails({ evidence }: { evidence: BrillianceEvidence }) {
  const s = evidence.signals;
  const verdict =
    evidence.verdict === 'brilliant' ? 'Brilliant' : evidence.verdict === 'candidate' ? 'Brilliant candidate (unconfirmed)' : 'Not brilliant';
  return (
    <div className="stack">
      <p>
        <strong>{verdict}</strong> · score {evidence.score}/100 · confidence {evidence.confidence} · {evidence.version}
      </p>

      <h3>
        What a {s.horizon}-ply look sees <span className="muted small">(mover's expected score)</span>
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Depth</th>
              <th>Played move</th>
              <th>Rank</th>
              <th>Best there</th>
              <th>Looks worse by</th>
            </tr>
          </thead>
          <tbody>
            {s.shallowView.map((r) => (
              <tr key={r.depth}>
                <td>{r.depth}</td>
                <td>{r.playedPct === null ? '—' : `${r.playedPct.toFixed(1)}%`}</td>
                <td>{r.playedRank ? `${ordinal(r.playedRank)} of ${r.legalMoves}` : '—'}</td>
                <td>
                  {r.bestUci} {r.bestPct.toFixed(1)}%
                </td>
                <td>{r.lossPct === null ? '—' : `${r.lossPct.toFixed(1)} pts`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>At full depth</h3>
      <table className="data">
        <tbody>
          <tr><th>Rank</th><td>{s.deepRank ? 'best (or tied)' : 'not best'}</td></tr>
          <tr><th>Expected score (mover)</th><td>{n1(s.deepExpectedPct)}%</td></tr>
          <tr><th>Gain vs. the shallow view of the same move</th><td>{n1(s.inversionPct)} pts</td></tr>
          <tr><th>Lead over the second-best move</th><td>{n1(s.uniquenessGapPct)} pts</td></tr>
          <tr>
            <th>Engine finds it</th>
            <td>
              {s.discoveryInterval
                ? `between depth ${s.discoveryInterval[0]} and ${s.discoveryInterval[1]}`
                : s.discoveryDepth !== null
                  ? `from depth ${s.discoveryDepth}`
                  : '—'}
            </td>
          </tr>
          <tr><th>Material sacrifice</th><td>{s.sacrifice ? (s.sacrificeSize ? `yes, ${s.sacrificeSize} pawn(s)` : 'yes') : 'no'}</td></tr>
          <tr><th>Stable on deeper recheck</th><td>{s.stable === null ? 'not checked' : s.stable ? 'yes' : 'no'}</td></tr>
        </tbody>
      </table>

      <h3>Checks</h3>
      <ul className="small">
        {evidence.gates.map((g) => (
          <li key={g.name}>
            <span className={g.passed ? 'pass' : 'fail'}>{g.passed ? '✔' : '✘'}</span> <strong>{g.name}</strong>: {g.detail}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Experimental: a move that looks like a mistake to a search limited to {s.horizon} plies, but is the best, decisive move at
        full depth. Engine depth is not the same as human difficulty; treat this as evidence, not a verdict.
      </p>
    </div>
  );
}

const signed = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);

export function GreatDetails({ evidence }: { evidence: GreatEvidence }) {
  const s = evidence.signals;
  return (
    <div className="stack">
      <p>
        <strong>{evidence.verdict === 'great' ? 'Great move' : 'Not great'}</strong> · {evidence.version}
      </p>
      <table className="data">
        <tbody>
          <tr>
            <th>Lead over the next move, {s.horizon}-ply look</th>
            <td>
              {signed(s.shallowLeadPct)} pts{s.shallowRivalUci ? ` vs ${s.shallowRivalUci}` : ''}
              {s.shallowRank && s.legalMoves ? ` (${ordinal(s.shallowRank)} of ${s.legalMoves})` : ''}
            </td>
          </tr>
          <tr>
            <th>Lead over the next move, full depth</th>
            <td>
              {signed(s.deepGapPct)} pts{s.deepRivalUci ? ` vs ${s.deepRivalUci}` : ''}
            </td>
          </tr>
          <tr><th>Lead on deeper recheck</th><td>{signed(s.recheckGapPct)} pts</td></tr>
          <tr><th>Expected score (mover)</th><td>{n1(s.deepExpectedPct)}%</td></tr>
        </tbody>
      </table>
      <h3>Checks</h3>
      <ul className="small">
        {evidence.gates.map((g) => (
          <li key={g.name}>
            <span className={g.passed ? 'pass' : 'fail'}>{g.passed ? '✔' : '✘'}</span> <strong>{g.name}</strong>: {g.detail}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Experimental: the best move, far better than every alternative at full depth, while a search limited to {s.horizon} plies
        cannot tell it apart from them. Treat this as evidence, not a verdict.
      </p>
    </div>
  );
}

export function EvidenceModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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
        {children}
      </div>
    </div>
  );
}
