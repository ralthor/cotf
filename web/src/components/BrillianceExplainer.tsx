import { useEffect, useRef, type ReactNode } from 'react';
import { ordinal, type BrillianceEvidence } from '../core/brilliancy/detector';
import type { GreatEvidence } from '../core/brilliancy/great';
import { t } from '../i18n';
import { useT } from '../i18n/react';

const n1 = (v: number | null) => (v === null ? '—' : v.toFixed(1));

export function BrillianceDetails({ evidence }: { evidence: BrillianceEvidence }) {
  useT();
  const s = evidence.signals;
  const verdict =
    evidence.verdict === 'brilliant'
      ? t('category.brilliant')
      : evidence.verdict === 'candidate'
        ? t('evidence.candidate')
        : t('evidence.notBrilliant');
  return (
    <div className="stack">
      <p>
        <strong>{verdict}</strong> · {t('evidence.score', { score: evidence.score })} · {t('evidence.confidence', { confidence: evidence.confidence })} · {evidence.version}
      </p>

      <h3>
        {t('evidence.shallowSees', { n: s.horizon })} <span className="muted small">{t('evidence.moverScore')}</span>
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t('game.depth')}</th>
              <th>{t('evidence.playedMove')}</th>
              <th>{t('evidence.rank')}</th>
              <th>{t('evidence.bestThere')}</th>
              <th>{t('evidence.looksWorse')}</th>
            </tr>
          </thead>
          <tbody>
            {s.shallowView.map((r) => (
              <tr key={r.depth}>
                <td>{r.depth}</td>
                <td>{r.playedPct === null ? '—' : `${r.playedPct.toFixed(1)}%`}</td>
                <td>{r.playedRank ? t('evidence.rankOf', { rank: ordinal(r.playedRank), total: r.legalMoves }) : '—'}</td>
                <td>
                  {r.bestUci} {r.bestPct.toFixed(1)}%
                </td>
                <td>{r.lossPct === null ? '—' : t('evidence.pts', { v: r.lossPct.toFixed(1) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>{t('evidence.fullDepth')}</h3>
      <table className="data">
        <tbody>
          <tr><th>{t('evidence.rank')}</th><td>{s.deepRank ? t('evidence.bestOrTied') : t('evidence.notBest')}</td></tr>
          <tr><th>{t('evidence.expected')}</th><td>{n1(s.deepExpectedPct)}%</td></tr>
          <tr><th>{t('evidence.gain')}</th><td>{t('evidence.pts', { v: n1(s.inversionPct) })}</td></tr>
          <tr><th>{t('evidence.leadSecond')}</th><td>{t('evidence.pts', { v: n1(s.uniquenessGapPct) })}</td></tr>
          <tr>
            <th>{t('evidence.engineFinds')}</th>
            <td>
              {s.discoveryInterval
                ? t('evidence.between', { a: s.discoveryInterval[0], b: s.discoveryInterval[1] })
                : s.discoveryDepth !== null
                  ? t('evidence.fromDepth', { d: s.discoveryDepth })
                  : '—'}
            </td>
          </tr>
          <tr><th>{t('evidence.sacrifice')}</th><td>{s.sacrifice ? (s.sacrificeSize ? t('evidence.sacrificeSize', { n: s.sacrificeSize }) : t('common.yes')) : t('common.no')}</td></tr>
          <tr><th>{t('evidence.stable')}</th><td>{s.stable === null ? t('evidence.notChecked') : s.stable ? t('common.yes') : t('common.no')}</td></tr>
        </tbody>
      </table>

      <h3>{t('evidence.checks')}</h3>
      <ul className="small">
        {evidence.gates.map((g) => (
          <li key={g.name}>
            <span className={g.passed ? 'pass' : 'fail'}>{g.passed ? '✔' : '✘'}</span> <strong>{g.name}</strong>: {g.detail}
          </li>
        ))}
      </ul>
      <p className="small muted">
        {t('evidence.brilliantNote', { n: s.horizon })}
      </p>
    </div>
  );
}

const signed = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);

export function GreatDetails({ evidence }: { evidence: GreatEvidence }) {
  useT();
  const s = evidence.signals;
  return (
    <div className="stack">
      <p>
        <strong>{evidence.verdict === 'great' ? t('evidence.great') : t('evidence.notGreat')}</strong> · {evidence.version}
      </p>
      <table className="data">
        <tbody>
          <tr>
            <th>{t('evidence.leadShallow', { n: s.horizon })}</th>
            <td>
              {t('evidence.pts', { v: signed(s.shallowLeadPct) })}{s.shallowRivalUci ? ` ${t('stats.vs', { opponent: s.shallowRivalUci })}` : ''}
              {s.shallowRank && s.legalMoves ? ` (${t('evidence.rankOf', { rank: ordinal(s.shallowRank), total: s.legalMoves })})` : ''}
            </td>
          </tr>
          <tr>
            <th>{t('evidence.leadDeep')}</th>
            <td>
              {t('evidence.pts', { v: signed(s.deepGapPct) })}{s.deepRivalUci ? ` ${t('stats.vs', { opponent: s.deepRivalUci })}` : ''}
            </td>
          </tr>
          <tr><th>{t('evidence.leadRecheck')}</th><td>{t('evidence.pts', { v: signed(s.recheckGapPct) })}</td></tr>
          <tr><th>{t('evidence.expected')}</th><td>{n1(s.deepExpectedPct)}%</td></tr>
        </tbody>
      </table>
      <h3>{t('evidence.checks')}</h3>
      <ul className="small">
        {evidence.gates.map((g) => (
          <li key={g.name}>
            <span className={g.passed ? 'pass' : 'fail'}>{g.passed ? '✔' : '✘'}</span> <strong>{g.name}</strong>: {g.detail}
          </li>
        ))}
      </ul>
      <p className="small muted">
        {t('evidence.greatNote', { n: s.horizon })}
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
          <button type="button" onClick={onClose}>{t('common.close')}</button>
        </div>
        {children}
      </div>
    </div>
  );
}
