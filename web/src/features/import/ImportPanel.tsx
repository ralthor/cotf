import { useState } from 'react';
import { parsePgn, PGN_LIMITS } from '../../core/chess/pgn';
import type { GameRecord } from '../../core/chess/types';
import {
  CHESSCOM_FRESHNESS_NOTE,
  ChessComClient,
  chessComToGameRecord,
  isChessComGameUrl,
  type ChessComGame,
} from './chesscom';
import { LichessClient, lichessToGameRecord, parseLichessGameId, type LichessGame } from './lichess';
import { ImportError } from './http';
import { getPref, setPref } from '../../storage/prefs';

type Tab = 'pgn' | 'chesscom' | 'lichess';

const chesscom = new ChessComClient();
const lichess = new LichessClient();

function describeError(e: unknown): string {
  if (e instanceof ImportError) return e.message;
  if ((e as Error).name === 'AbortError') return 'Cancelled.';
  return `Import failed: ${(e as Error).message}`;
}

function formatDate(seconds?: number): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function ImportPanel({ onImported }: { onImported: (games: GameRecord[]) => void }) {
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = getPref('importTab');
    return saved === 'chesscom' || saved === 'lichess' || saved === 'pgn' ? saved : 'pgn';
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    setPref('importTab', t);
  };
  return (
    <section className="panel" aria-labelledby="import-title">
      <h2 id="import-title">Import games</h2>
      <div className="tabs" role="tablist">
        {(['pgn', 'chesscom', 'lichess'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'pgn' ? 'PGN' : t === 'chesscom' ? 'Chess.com' : 'Lichess'}
          </button>
        ))}
      </div>
      {tab === 'pgn' && <PgnImport onImported={onImported} />}
      {tab === 'chesscom' && <ChessComImport onImported={onImported} />}
      {tab === 'lichess' && <LichessImport onImported={onImported} />}
    </section>
  );
}

function PgnImport({ onImported }: { onImported: (g: GameRecord[]) => void }) {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<string[]>([]);

  const load = (input: string, source: 'pgn-paste' | 'pgn-file') => {
    if (isChessComGameUrl(input.trim())) {
      setMessages([
        'Importing directly from a Chess.com game URL is not supported yet. On the game page, use Share → PGN → Download (or copy) and paste it here, or use the Chess.com tab.',
      ]);
      return;
    }
    if (input.includes('lichess.org') && parseLichessGameId(input.trim()) && input.trim().length < 80) {
      setMessages(['That looks like a Lichess game link — use the Lichess tab to import it.']);
      return;
    }
    const r = parsePgn(input, { source });
    const msgs = r.errors.map((e) => `Game ${e.index + 1}${e.headers?.White ? ` (${e.headers.White} vs ${e.headers.Black})` : ''}: ${e.message}`);
    if (r.truncated) msgs.push(`Only the first ${PGN_LIMITS.maxGames} games were imported.`);
    if (r.games.length) msgs.unshift(`Imported ${r.games.length} game${r.games.length > 1 ? 's' : ''}.`);
    setMessages(msgs);
    if (r.games.length) onImported(r.games);
  };

  return (
    <div className="stack">
      <label className="stack small">
        Paste PGN (one or more games)
        <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 ...'} />
      </label>
      <div className="row">
        <button type="button" className="primary" disabled={!text.trim()} onClick={() => load(text, 'pgn-paste')}>
          Import pasted PGN
        </button>
        <label className="row small">
          <span>or upload .pgn</span>
          <input
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > PGN_LIMITS.maxBytes) return setMessages(['That file is too large (max 5 MB).']);
              load(await f.text(), 'pgn-file');
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {messages.length > 0 && (
        <ul className="small" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className={i === 0 && m.startsWith('Imported') ? '' : 'error'}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChessComImport({ onImported }: { onImported: (g: GameRecord[]) => void }) {
  const [username, setUsername] = useState(() => getPref('chesscomUsername') ?? '');
  const [saved, setSaved] = useState(() => getPref('chesscomUsername'));
  const [monthsBack, setMonthsBack] = useState(() => Number(getPref('chesscomMonths')) || 1);
  const [games, setGames] = useState<ChessComGame[] | null>(null);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchGames = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (isChessComGameUrl(username)) throw new ImportError('unsupported', 'Game URLs are not supported yet — enter a username, or paste the PGN in the PGN tab.');
      const r = await chesscom.recentGames(username, { monthsBack });
      setGames(r.games);
      setPref('chesscomUsername', r.username);
      setPref('chesscomMonths', String(monthsBack));
      setSaved(r.username);
      const months = r.months.map((m) => m.split('/games/')[1]).join(', ');
      const skipped = r.skipped.map((s) => `${s.count} ${s.reason}`).join(', ');
      setInfo(
        r.months.length === 0
          ? 'No game archives found for this player.'
          : `${r.games.length} games from ${months}${skipped ? ` (skipped: ${skipped})` : ''}.`,
      );
    } catch (e) {
      setError(describeError(e));
      setGames(null);
    } finally {
      setBusy(false);
    }
  };

  const importOne = (g: ChessComGame) => {
    try {
      onImported([chessComToGameRecord(g)]);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void fetchGames();
        }}
      >
        <label className="sr-only" htmlFor="cc-user">Chess.com username</label>
        <input id="cc-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Chess.com username" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <label className="small row">
          Months
          <select value={monthsBack} onChange={(e) => setMonthsBack(Number(e.target.value))}>
            {[1, 2, 3, 6].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy || !username.trim()}>{busy ? 'Loading…' : 'Fetch games'}</button>
      </form>
      {saved && (
        <p className="small muted row">
          Remembered on this device: <strong>{saved}</strong>
          <button
            type="button"
            className="link"
            onClick={() => {
              setPref('chesscomUsername', null);
              setSaved(null);
              setUsername('');
            }}
          >
            Forget
          </button>
        </p>
      )}
      <p className="notice">{CHESSCOM_FRESHNESS_NOTE}</p>
      {error && <p className="error small" role="alert">{error}</p>}
      {info && <p className="small muted" aria-live="polite">{info}</p>}
      {games && games.length > 0 && (
        <>
          <p className="small">Latest published game: <strong>{formatDate(games[0]!.end_time)}</strong></p>
          <ul className="game-list">
            {games.slice(0, 100).map((g, i) => (
              <li key={g.url ?? i}>
                <button type="button" onClick={() => importOne(g)}>
                  {g.white?.username} ({g.white?.rating ?? '?'}) vs {g.black?.username} ({g.black?.rating ?? '?'})
                  <div className="meta">{g.time_class} · {formatDate(g.end_time)} · {g.white?.result}/{g.black?.result}</div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LichessImport({ onImported }: { onImported: (g: GameRecord[]) => void }) {
  const [input, setInput] = useState(() => getPref('lichessUsername') ?? '');
  const [saved, setSaved] = useState(() => getPref('lichessUsername'));
  const [games, setGames] = useState<LichessGame[] | null>(null);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // A bare 8-character string could be a username (e.g. "thibault"), so only URLs count as games.
  const isGame = input.includes('lichess.org') && parseLichessGameId(input) !== null;

  const go = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (isGame) {
        const g = await lichess.game(input);
        onImported([lichessToGameRecord(g)]);
        setInfo('Game imported.');
      } else {
        const r = await lichess.recentGames(input, { max: 30 });
        setGames(r.games);
        setPref('lichessUsername', r.username);
        setSaved(r.username);
        const skipped = r.skipped.map((s) => `${s.count} ${s.reason}`).join(', ');
        setInfo(`${r.games.length} recent finished games${skipped ? ` (skipped: ${skipped})` : ''}.`);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <label className="sr-only" htmlFor="li-input">Lichess username or game URL</label>
        <input id="li-input" style={{ flex: 1, minWidth: 200 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Lichess username or game URL" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <button type="submit" className="primary" disabled={busy || !input.trim()}>
          {busy ? 'Loading…' : isGame ? 'Import game' : 'Fetch games'}
        </button>
      </form>
      {saved && (
        <p className="small muted row">
          Remembered on this device: <strong>{saved}</strong>
          {input !== saved && (
            <button type="button" className="link" onClick={() => setInput(saved)}>
              Use it
            </button>
          )}
          <button
            type="button"
            className="link"
            onClick={() => {
              setPref('lichessUsername', null);
              setSaved(null);
            }}
          >
            Forget
          </button>
        </p>
      )}
      <p className="notice">Lichess games can be imported by URL as soon as they finish. Games in progress are refused.</p>
      {error && <p className="error small" role="alert">{error}</p>}
      {info && <p className="small muted" aria-live="polite">{info}</p>}
      {games && games.length > 0 && (
        <ul className="game-list">
          {games.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => {
                  try {
                    onImported([lichessToGameRecord(g)]);
                  } catch (e) {
                    setError(describeError(e));
                  }
                }}
              >
                {g.white?.name ?? '?'} ({g.white?.rating ?? '?'}) vs {g.black?.name ?? '?'} ({g.black?.rating ?? '?'})
                <div className="meta">
                  {g.speed} · {formatDate(g.lastMoveAt ? g.lastMoveAt / 1000 : undefined)} · {g.status}
                  {g.winner ? ` · ${g.winner} won` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
