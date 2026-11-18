import { useRef, useState } from 'react';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { evaluateBrilliance, ordinal, type BrillianceEvidence, type BrillianceInput } from '../../core/brilliancy/detector';
import type { MoveRecord } from '../../core/chess/types';
import type { EngineLine } from '../../core/engine/types';
import { expectedScore, formatScore } from '../../core/scoring/score';
import { useEngine } from '../../app/EngineContext';
import { BrillianceDetails, GreatDetails } from '../../components/BrillianceExplainer';
import { evaluateGreat, type GreatEvidence } from '../../core/brilliancy/great';
import { IdbAnalysisCache } from '../../storage/db';
import { GameAnalyser } from '../analysis/orchestrator';
import { PRESETS } from '../analysis/types';
import { useT } from '../../i18n/react';

const cache = new IdbAnalysisCache();

/**
 * Légal's trap: 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6 5.Nxe5! "hangs" the queen, but 5...Bxd1? loses to
 * 6.Bxf7+ Ke7 7.Nd5#. A shallow look sees only the lost queen.
 */
const EXAMPLES = [
  { label: "Légal's trap: 5.Nxe5!", fen: 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5', move: 'Nxe5', horizon: 3 },
  { label: 'Opera Game: 16.Qb8+!!', fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16', move: 'Qb8+', horizon: 1 },
  // brill-v3: a queen sacrifice uses a 1-ply horizon even when 3 plies are searched.
  { label: "Philidor's smothered mate: Qg8+!!", fen: '3r3k/6pp/7N/8/2Q5/8/6PP/6K1 w - - 0 1', move: 'Qg8+', horizon: 3 },
];

function toMove(fen: string, moveText: string): MoveRecord {
  const c = new Chess(fen);
  const legalMoveCount = c.moves().length;
  const t = moveText.trim();
  const m = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)
    ? c.move({ from: t.slice(0, 2), to: t.slice(2, 4), promotion: t[4] })
    : c.move(t);
  return {
    ply: 1,
    fullMoveNumber: Number(fen.split(' ')[5] ?? 1),
    colour: m.color,
    san: m.san,
    uci: m.lan,
    fenBefore: m.before,
    fenAfter: m.after,
    isCheck: c.inCheck(),
    isCheckmate: c.isCheckmate(),
    legalMoveCount,
  };
}

/**
 * Research harness: (1) single-position analysis with live MultiPV lines and cancel;
 * (2) the depth-reversal brilliancy detector for one FEN + played move, with all raw evidence.
 */
export function ResearchView() {
  const { t } = useT();
  const { getEngine } = useEngine();
  const [fen, setFen] = useState(DEFAULT_POSITION);
  const [moveText, setMoveText] = useState('');
  const [depth, setDepth] = useState(18);
  const [multiPv, setMultiPv] = useState(3);
  const [shallowDepth, setShallowDepth] = useState(3);
  const [deepDepth, setDeepDepth] = useState(20);
  const [recheckDepth, setRecheckDepth] = useState(22);
  const [live, setLive] = useState<{ depth: number; lines: EngineLine[]; done: boolean } | null>(null);
  const [evidence, setEvidence] = useState<{ input: BrillianceInput; result: BrillianceEvidence; great: GreatEvidence } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'analyse' | 'brilliancy'>('');
  const abortRef = useRef<AbortController | null>(null);

  let fenValid = true;
  try {
    new Chess(fen);
  } catch {
    fenValid = false;
  }

  const analyse = async () => {
    setError('');
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy('analyse');
    try {
      const engine = await getEngine();
      const r = await engine.analyse(
        { fen, depth, multiPv },
        { signal: ac.signal, onProgress: (p) => setLive({ depth: p.depth, lines: p.lines, done: false }) },
      );
      setLive({ depth: r.completedDepth, lines: r.lines, done: true });
    } catch (e) {
      if ((e as { code?: string }).code !== 'cancelled') setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const runBrilliancy = async () => {
    setError('');
    setEvidence(null);
    let mv: MoveRecord;
    try {
      mv = toMove(fen, moveText);
    } catch {
      setError(t('research.illegal'));
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy('brilliancy');
    try {
      const engine = await getEngine();
      const preset = {
        ...PRESETS.deep,
        brilliancyShallowDepth: shallowDepth,
        brilliancyDeepDepth: deepDepth,
        recheckDepth,
      };
      const input = await new GameAnalyser(engine, cache, preset).collectBrillianceInput(mv, ac.signal);
      setEvidence({ input, result: evaluateBrilliance(input), great: evaluateGreat(input) });
    } catch (e) {
      if ((e as { code?: string }).code !== 'cancelled') setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const sanLine = (l: EngineLine) => {
    const c = new Chess(fen);
    const out: string[] = [];
    for (const u of l.pvUci.slice(0, 10)) {
      try {
        out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
      } catch {
        break;
      }
    }
    return out.join(' ');
  };

  return (
    <div className="layout">
      <div className="stack">
        <section className="panel stack">
          <h2>{t('research.position')}</h2>
          <label className="stack small">
            FEN
            <input value={fen} onChange={(e) => setFen(e.target.value.trim())} aria-invalid={!fenValid} />
          </label>
          {!fenValid && <p className="error small">{t('research.invalidFen')}</p>}
          <div className="row">
            <button type="button" onClick={() => setFen(DEFAULT_POSITION)}>{t('research.startPosition')}</button>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setFen(ex.fen);
                  setMoveText(ex.move);
                  setShallowDepth(ex.horizon);
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
          {fenValid && (
            <div style={{ maxWidth: 320 }}>
              <Chessboard
                options={{
                  id: 'research-board',
                  position: fen,
                  allowDragging: false,
                  lightSquareStyle: { backgroundColor: 'var(--board-light)' },
                  darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
                }}
              />
            </div>
          )}
        </section>
      </div>

      <div className="stack">
        <section className="panel stack">
          <h2>{t('research.single')}</h2>
          <div className="row small">
            <label className="row">{t('game.depth')} <input type="number" min={1} max={40} value={depth} onChange={(e) => setDepth(Number(e.target.value))} style={{ width: 70 }} /></label>
            <label className="row">MultiPV <input type="number" min={1} max={10} value={multiPv} onChange={(e) => setMultiPv(Number(e.target.value))} style={{ width: 60 }} /></label>
            {busy === 'analyse' ? (
              <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>{t('research.stop')}</button>
            ) : (
              <button type="button" className="primary" disabled={!fenValid || !!busy} onClick={() => void analyse()}>{t('research.analyse')}</button>
            )}
          </div>
          {live && (
            <div aria-live="polite">
              <p className="small muted">{t('research.depth', { d: live.depth })}{live.done ? ` ${t('research.complete')}` : '…'}</p>
              <ol className="lines">
                {live.lines.map((l) => (
                  <li key={l.rank}><span className="score">{formatScore(l.score)}</span> <span dir="ltr">{sanLine(l)}</span></li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section className="panel stack">
          <h2>{t('research.harness')}</h2>
          <p className="small muted">
            {t('research.harness.note')}
          </p>
          <div className="row small">
            <label className="row">{t('evidence.playedMove')} <input value={moveText} onChange={(e) => setMoveText(e.target.value)} placeholder={t('research.movePlaceholder')} style={{ width: 110 }} /></label>
            <label className="row" title={t('research.shallow.title')}>{t('research.shallow')} <input type="number" min={1} max={6} value={shallowDepth} onChange={(e) => setShallowDepth(Number(e.target.value))} style={{ width: 60 }} /></label>
            <label className="row">{t('research.deep')} <input type="number" min={8} max={40} value={deepDepth} onChange={(e) => setDeepDepth(Number(e.target.value))} style={{ width: 60 }} /></label>
            <label className="row">{t('research.recheck')} <input type="number" min={8} max={40} value={recheckDepth} onChange={(e) => setRecheckDepth(Number(e.target.value))} style={{ width: 60 }} /></label>
            {busy === 'brilliancy' ? (
              <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>{t('research.stop')}</button>
            ) : (
              <button type="button" className="primary" disabled={!fenValid || !moveText.trim() || !!busy} onClick={() => void runBrilliancy()}>
                {t('research.run')}
              </button>
            )}
          </div>
          {busy === 'brilliancy' && <p className="small muted">{t('research.running')}</p>}
          {error && <p className="error small" role="alert">{error}</p>}
          {evidence && (
            <>
              <BrillianceDetails evidence={evidence.result} />
              <h3>{t('research.greatQ')}</h3>
              <GreatDetails evidence={evidence.great} />
              <h3>{t('research.trajectory')}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="data">
                  <thead>
                    <tr><th>{t('game.depth')}</th><th>{t('research.playedRank')}</th><th>{t('research.playedScore')}</th><th>{t('research.playedExp')}</th><th>{t('research.bestAtDepth')}</th></tr>
                  </thead>
                  <tbody>
                    {evidence.input.trajectory.map((tr) => {
                      const s = evidence.input.shallow.find((x) => x.depth === tr.depth);
                      return (
                        <tr key={tr.depth}>
                          <td>{tr.depth}</td>
                          <td>{s?.playedRank ? t('evidence.rankOf', { rank: ordinal(s.playedRank), total: s.legalMoves }) : '—'}</td>
                          <td>{formatScore(tr.score)}</td>
                          <td>{(expectedScore(tr.score, evidence.input.mover) * 100).toFixed(1)}%</td>
                          <td>{s ? formatScore(s.bestScore) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                {t('research.deepSummary', {
                  depth: evidence.input.deep.depth,
                  best: `${evidence.input.deep.bestUci} ${formatScore(evidence.input.deep.bestScore)}`,
                  second: formatScore(evidence.input.deep.secondScore),
                  recheck: evidence.input.recheck?.depth ?? '—',
                })}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
