import { useRef, useState } from 'react';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { evaluateBrilliance, type BrillianceEvidence, type BrillianceInput } from '../../core/brilliancy/detector';
import type { MoveRecord } from '../../core/chess/types';
import type { EngineLine } from '../../core/engine/types';
import { expectedScore, formatScore } from '../../core/scoring/score';
import { useEngine } from '../../app/EngineContext';
import { BrillianceDetails } from '../../components/BrillianceExplainer';
import { IdbAnalysisCache } from '../../storage/db';
import { GameAnalyser } from '../analysis/orchestrator';
import { PRESETS } from '../analysis/types';

const cache = new IdbAnalysisCache();

/** Example from the handoff-style test set: Greek-gift style sacrifice position (White to move, Bxh7+). */
const EXAMPLE = { fen: 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8', move: 'Bxh7+' };

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
  const { getEngine } = useEngine();
  const [fen, setFen] = useState(DEFAULT_POSITION);
  const [moveText, setMoveText] = useState('');
  const [depth, setDepth] = useState(18);
  const [multiPv, setMultiPv] = useState(3);
  const [shallowDepth, setShallowDepth] = useState(8);
  const [deepDepth, setDeepDepth] = useState(20);
  const [recheckDepth, setRecheckDepth] = useState(22);
  const [live, setLive] = useState<{ depth: number; lines: EngineLine[]; done: boolean } | null>(null);
  const [evidence, setEvidence] = useState<{ input: BrillianceInput; result: BrillianceEvidence } | null>(null);
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
      setError('That move is not legal in this position (use SAN like Bxh7+ or UCI like d3h7).');
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
      setEvidence({ input, result: evaluateBrilliance(input) });
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
          <h2>Position</h2>
          <label className="stack small">
            FEN
            <input value={fen} onChange={(e) => setFen(e.target.value.trim())} aria-invalid={!fenValid} />
          </label>
          {!fenValid && <p className="error small">Invalid FEN.</p>}
          <div className="row">
            <button type="button" onClick={() => setFen(DEFAULT_POSITION)}>Start position</button>
            <button
              type="button"
              onClick={() => {
                setFen(EXAMPLE.fen);
                setMoveText(EXAMPLE.move);
              }}
            >
              Load example sacrifice
            </button>
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
          <h2>Single-position analysis</h2>
          <div className="row small">
            <label className="row">Depth <input type="number" min={1} max={40} value={depth} onChange={(e) => setDepth(Number(e.target.value))} style={{ width: 70 }} /></label>
            <label className="row">MultiPV <input type="number" min={1} max={10} value={multiPv} onChange={(e) => setMultiPv(Number(e.target.value))} style={{ width: 60 }} /></label>
            {busy === 'analyse' ? (
              <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>Stop</button>
            ) : (
              <button type="button" className="primary" disabled={!fenValid || !!busy} onClick={() => void analyse()}>Analyse</button>
            )}
          </div>
          {live && (
            <div aria-live="polite">
              <p className="small muted">Depth {live.depth}{live.done ? ' (complete)' : '…'}</p>
              <ol className="lines">
                {live.lines.map((l) => (
                  <li key={l.rank}><span className="score">{formatScore(l.score)}</span> {sanLine(l)}</li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section className="panel stack">
          <h2>Brilliancy research harness</h2>
          <p className="small muted">
            Measures the played move's rank at every shallow depth (MultiPV = all legal moves), its own score at every depth
            (<code>go … searchmoves</code>), verifies at depth and rechecks deeper. Hash is cleared before each search.
          </p>
          <div className="row small">
            <label className="row">Played move <input value={moveText} onChange={(e) => setMoveText(e.target.value)} placeholder="Bxh7+ or d3h7" style={{ width: 110 }} /></label>
            <label className="row">Shallow ≤ <input type="number" min={2} max={12} value={shallowDepth} onChange={(e) => setShallowDepth(Number(e.target.value))} style={{ width: 60 }} /></label>
            <label className="row">Deep <input type="number" min={8} max={40} value={deepDepth} onChange={(e) => setDeepDepth(Number(e.target.value))} style={{ width: 60 }} /></label>
            <label className="row">Recheck <input type="number" min={8} max={40} value={recheckDepth} onChange={(e) => setRecheckDepth(Number(e.target.value))} style={{ width: 60 }} /></label>
            {busy === 'brilliancy' ? (
              <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>Stop</button>
            ) : (
              <button type="button" className="primary" disabled={!fenValid || !moveText.trim() || !!busy} onClick={() => void runBrilliancy()}>
                Run detector
              </button>
            )}
          </div>
          {busy === 'brilliancy' && <p className="small muted">Running searches… deep depths can take a while in the browser.</p>}
          {error && <p className="error small" role="alert">{error}</p>}
          {evidence && (
            <>
              <BrillianceDetails evidence={evidence.result} />
              <h3>Depth trajectory (mover's perspective)</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="data">
                  <thead>
                    <tr><th>Depth</th><th>Played rank</th><th>Played score</th><th>Played exp.</th><th>Best at depth</th></tr>
                  </thead>
                  <tbody>
                    {evidence.input.trajectory.map((t) => {
                      const s = evidence.input.shallow.find((x) => x.depth === t.depth);
                      return (
                        <tr key={t.depth}>
                          <td>{t.depth}</td>
                          <td>{s ? (s.playedRank ? `#${s.playedRank} / ${s.legalMoves}` : `> ${s.sampledLines}`) : '—'}</td>
                          <td>{formatScore(t.score)}</td>
                          <td>{(expectedScore(t.score, evidence.input.mover) * 100).toFixed(1)}%</td>
                          <td>{s ? formatScore(s.bestScore) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                Deep (d{evidence.input.deep.depth}): best {evidence.input.deep.bestUci} {formatScore(evidence.input.deep.bestScore)}, second{' '}
                {formatScore(evidence.input.deep.secondScore)}; recheck d{evidence.input.recheck?.depth ?? '—'}. Scores shown White-relative
                except the expected-score column.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
