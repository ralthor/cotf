import { useEffect, useState } from 'react';
import { parseSingleGame } from '../../core/chess/pgn';
import type { GameRecord } from '../../core/chess/types';
import { api, ApiError, query, type ExternalAccount, type GameFilters, type Paginated, type ServerGame, type ServerGameDetail } from './api';
import { useAuth } from './AuthContext';
import { getLocale, t as translate, tOr } from '../../i18n';
import { useT } from '../../i18n/react';

export function serverGameToRecord(g: ServerGameDetail): GameRecord {
  const provider = g.provider === 'pgn' ? 'pgn-paste' : g.provider;
  const rec = parseSingleGame(g.pgn, {
    source: provider,
    sourceUrl: g.source_url || undefined,
    providerData: {
      accuracies: g.provider_accuracy ?? undefined,
      timeClass: g.time_class || undefined,
      endTime: g.played_at ? Math.floor(Date.parse(g.played_at) / 1000) : undefined,
    },
  });
  return { ...rec, serverId: g.id } as GameRecord & { serverId: number };
}

export function LoginForm() {
  const { login, register } = useAuth();
  const { t } = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="panel stack"
      style={{ maxWidth: 380 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          if (mode === 'login') await login(username, password);
          else await register(username, password);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{mode === 'login' ? t('auth.signIn') : t('auth.create')}</h2>
      <p className="small muted">
        {t('auth.note')}
      </p>
      <label className="stack small">
        {t('auth.username')}
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
      </label>
      <label className="stack small">
        {t('auth.password')}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          required
        />
      </label>
      {error && <p className="error small" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>{mode === 'login' ? t('auth.signIn') : t('auth.register')}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? t('auth.create') : t('auth.haveAccount')}
        </button>
      </div>
    </form>
  );
}

function LinkedAccounts() {
  const { me, refresh } = useAuth();
  const { t } = useT();
  const [provider, setProvider] = useState<'chesscom' | 'lichess'>('chesscom');
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState('');

  const link = async () => {
    setMsg('');
    try {
      await api('accounts/external/', { method: 'POST', body: { provider, username } });
      setUsername('');
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const sync = async (a: ExternalAccount) => {
    setMsg('');
    try {
      await api(`accounts/external/${a.id}/sync/`, { method: 'POST' });
      setMsg(t('library.syncQueued', { username: a.username }));
      setTimeout(() => void refresh(), 4000);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const unlink = async (a: ExternalAccount) => {
    await api(`accounts/external/${a.id}/`, { method: 'DELETE' }).catch(() => undefined);
    await refresh();
  };

  return (
    <section className="panel stack">
      <h2>{t('library.linked')}</h2>
      <ul className="small">
        {me?.external_accounts.map((a) => (
          <li key={a.id} className="row">
            <strong>{a.provider === 'chesscom' ? 'Chess.com' : 'Lichess'}</strong> {a.username}
            <span className="muted">
              {a.last_synced_at ? t('library.synced', { when: new Date(a.last_synced_at).toLocaleString(getLocale()) }) : t('library.neverSynced')} · {a.last_sync_status}
            </span>
            {a.last_sync_error && <span className="error">{a.last_sync_error}</span>}
            <button type="button" onClick={() => void sync(a)}>{t('library.syncNow')}</button>
            <button type="button" className="link" onClick={() => void unlink(a)}>{t('library.unlink')}</button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void link();
        }}
      >
        <select value={provider} onChange={(e) => setProvider(e.target.value as 'chesscom' | 'lichess')} aria-label={t('library.provider')}>
          <option value="chesscom">Chess.com</option>
          <option value="lichess">Lichess</option>
        </select>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('library.publicUsername')} aria-label={t('auth.username')} />
        <button type="submit" disabled={!username.trim()}>{t('library.link')}</button>
      </form>
      <p className="small muted">{t('library.syncNote')}</p>
      {msg && <p className="small" aria-live="polite">{msg}</p>}
    </section>
  );
}

export function LibraryView({ onOpenGame }: { onOpenGame: (games: GameRecord[]) => void }) {
  const { me, loading, logout } = useAuth();
  const { t } = useT();
  const [filters, setFilters] = useState<GameFilters>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ServerGame> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    let live = true;
    api<Paginated<ServerGame>>(`games/${query({ ...filters, page })}`).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError('');
      },
      (e) => live && setError(e instanceof ApiError ? e.message : translate('library.loadFailed')),
    );
    return () => {
      live = false;
    };
  }, [me, filters, page]);

  if (loading) return <p className="muted">{t('common.loading')}</p>;
  if (!me) return <LoginForm />;

  const open = async (id: number) => {
    try {
      const g = await api<ServerGameDetail>(`games/${id}/`);
      onOpenGame([serverGameToRecord(g)]);
      window.location.assign('#/analyse');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const set = (k: keyof GameFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{t('library.title', { username: me.username })}</h2>
        <button type="button" onClick={() => void logout()}>{t('auth.signOut')}</button>
      </div>
      <LinkedAccounts />
      <section className="panel stack">
        <div className="row small">
          <select value={filters.colour ?? ''} onChange={set('colour')} aria-label={t('stats.colour')}>
            <option value="">{t('library.anyColour')}</option>
            <option value="w">{t('stats.asWhite')}</option>
            <option value="b">{t('stats.asBlack')}</option>
          </select>
          <select value={filters.time_class ?? ''} onChange={set('time_class')} aria-label={t('stats.timeControl')}>
            <option value="">{t('library.anyTimeControl')}</option>
            {['bullet', 'blitz', 'rapid', 'classical', 'daily'].map((k) => <option key={k} value={k}>{t(`timeClass.${k}`)}</option>)}
          </select>
          <select value={filters.result ?? ''} onChange={set('result')} aria-label={t('library.result')}>
            <option value="">{t('library.anyResult')}</option>
            <option value="win">{t('library.wins')}</option>
            <option value="loss">{t('library.losses')}</option>
            <option value="draw">{t('library.draws')}</option>
          </select>
          <select value={filters.provider ?? ''} onChange={set('provider')} aria-label={t('library.source')}>
            <option value="">{t('library.anySource')}</option>
            <option value="chesscom">Chess.com</option>
            <option value="lichess">Lichess</option>
            <option value="pgn">PGN</option>
          </select>
          <input placeholder={t('library.opponent')} value={filters.opponent ?? ''} onChange={set('opponent')} aria-label={t('library.opponent')} />
          <label className="row">{t('library.from')} <input type="date" onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value ? `${e.target.value}T00:00:00Z` : '' }))} /></label>
          <label className="row">{t('library.to')} <input type="date" onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value ? `${e.target.value}T23:59:59Z` : '' }))} /></label>
        </div>
        {error && <p className="error small" role="alert">{error}</p>}
        {data && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('library.date')}</th><th>{t('library.opponent')}</th><th>{t('stats.colour')}</th><th>{t('library.result')}</th><th>{t('stats.type')}</th><th>{t('stats.opening')}</th><th>{t('library.ourAccuracy')}</th><th />
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((g) => {
                    const acc = g.user_colour === 'w' ? g.latest_accuracy?.white?.value : g.user_colour === 'b' ? g.latest_accuracy?.black?.value : undefined;
                    return (
                      <tr key={g.id}>
                        <td>{g.played_at ? new Date(g.played_at).toLocaleDateString(getLocale()) : '—'}</td>
                        <td>{g.opponent || t('import.players', { white: g.white, black: g.black })} {g.opponent_rating ? `(${g.opponent_rating})` : ''}</td>
                        <td>{g.user_colour === 'w' ? t('colour.white') : g.user_colour === 'b' ? t('colour.black') : '—'}</td>
                        <td>{g.user_result ? tOr(`result.${g.user_result}`, g.user_result) : g.result}</td>
                        <td>{g.time_class ? tOr(`timeClass.${g.time_class}`, g.time_class) : '—'}</td>
                        <td>{g.opening || g.eco || '—'}</td>
                        <td>{acc !== undefined ? acc.toFixed(1) : '—'}</td>
                        <td><button type="button" onClick={() => void open(g.id)}>{t('library.open')}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row small">
              <button type="button" disabled={!data.previous} onClick={() => setPage((p) => p - 1)}>{t('library.previous')}</button>
              <span>{t('library.page', { page, count: data.count })}</span>
              <button type="button" disabled={!data.next} onClick={() => setPage((p) => p + 1)}>{t('library.next')}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
