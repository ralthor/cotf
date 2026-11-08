import { useEffect, useRef, useState } from 'react';
import type { GameRecord } from '../../core/chess/types';
import type { GameAnalysis } from '../analysis/types';
import { api, type CloudJob } from '../library/api';
import { useAuth } from '../library/AuthContext';

type Props = { game: GameRecord; analysis: GameAnalysis | null; setAnalysis: (a: GameAnalysis) => void };
type Profiles = { enabled: boolean; profiles: { id: string; label: string }[]; remaining_positions_today: number };

/** Makes sure the game exists in the user's server library (idempotent: the server dedupes) and returns its id. */
async function ensureServerGame(game: GameRecord): Promise<number> {
  const known = (game as GameRecord & { serverId?: number }).serverId;
  if (known) return known;
  const r = await api<{ created: number[]; existing: number[] }>('imports/pgn/', { method: 'POST', body: { pgn: game.rawPgn } });
  const id = r.created[0] ?? r.existing[0];
  if (!id) throw new Error('The server could not import this game.');
  (game as GameRecord & { serverId?: number }).serverId = id;
  return id;
}

/** Phase 2/3 actions shown under the analysis controls: save browser analysis, run deep cloud analysis. */
export function CloudAnalysisPanel({ game, analysis, setAnalysis }: Props) {
  const { me } = useAuth();
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [profile, setProfile] = useState('cloud-standard');
  const [job, setJob] = useState<CloudJob | null>(null);
  const [msg, setMsg] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!me) return;
    api<Profiles>('engine-profiles/').then(setProfiles, () => setProfiles(null));
  }, [me]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!me) {
    return <p className="small muted" style={{ marginTop: 8 }}>Sign in on the Library tab to save analyses or request deeper cloud analysis.</p>;
  }

  const poll = (id: number) => {
    timer.current = window.setTimeout(async () => {
      try {
        const j = await api<CloudJob>(`analysis-jobs/${id}/`);
        setJob(j);
        if (j.status === 'done' && j.analysis) {
          setAnalysis({ ...j.analysis, gameId: game.id });
          setMsg('Cloud analysis loaded.');
        } else if (j.status === 'queued' || j.status === 'running') poll(id);
      } catch (e) {
        setMsg((e as Error).message);
      }
    }, 2000);
  };

  const requestCloud = async () => {
    setMsg('');
    try {
      const id = await ensureServerGame(game);
      const j = await api<CloudJob>(`games/${id}/analyse/`, { method: 'POST', body: { profile } });
      setJob(j);
      poll(j.id);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const save = async () => {
    if (!analysis) return;
    setMsg('');
    try {
      const id = await ensureServerGame(game);
      await api(`games/${id}/analysis/`, { method: 'POST', body: analysis });
      setMsg('Analysis saved to your library.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const cancel = async () => {
    if (!job) return;
    window.clearTimeout(timer.current);
    setJob(await api<CloudJob>(`analysis-jobs/${job.id}/cancel/`, { method: 'POST' }));
  };

  const active = job && (job.status === 'queued' || job.status === 'running');
  return (
    <div className="stack" style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div className="row small">
        <button type="button" disabled={!analysis || analysis.phase !== 'done' || analysis.presetId === 'cloud'} onClick={() => void save()}>
          Save to library
        </button>
        {profiles?.enabled && (
          <>
            <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Cloud profile" disabled={!!active}>
              {profiles.profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {active ? (
              <button type="button" className="danger" onClick={() => void cancel()}>Cancel cloud job</button>
            ) : (
              <button type="button" onClick={() => void requestCloud()}>Deep cloud analysis</button>
            )}
          </>
        )}
      </div>
      {profiles?.enabled && (
        <p className="small muted">
          Native Stockfish on a server; deeper and slower than your browser. Remaining today: {profiles.remaining_positions_today} positions.
        </p>
      )}
      {job && (
        <p className="small" aria-live="polite">
          Cloud job #{job.id}: {job.status}
          {job.progress_label ? ` · ${job.progress_label}` : ''}
          {job.error ? <span className="error"> · {job.error}</span> : null}
        </p>
      )}
      {msg && <p className="small" aria-live="polite">{msg}</p>}
    </div>
  );
}
