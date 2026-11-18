import { useState } from 'react';
import { parsePgn, PGN_LIMITS } from '../../core/chess/pgn';
import type { GameRecord } from '../../core/chess/types';
import {
  chesscomFreshnessNote,
  ChessComClient,
  chessComToGameRecord,
  isChessComGameUrl,
  type ChessComGame,
} from './chesscom';
import { LichessClient, lichessToGameRecord, parseLichessGameId, type LichessGame } from './lichess';
import { ImportError } from './http';
import { getPref, setPref } from '../../storage/prefs';
import { getLocale, t, tn } from '../../i18n';
import { useT } from '../../i18n/react';

type Tab = 'pgn' | 'chesscom' | 'lichess';

const chesscom = new ChessComClient();
const lichess = new LichessClient();

function describeError(e: unknown): string {
  if (e instanceof ImportError) return e.message;
  if ((e as Error).name === 'AbortError') return t('import.cancelled');
  return t('import.failed', { reason: (e as Error).message });
}

function formatDate(seconds?: number): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

type ImportProps = { onImported: (games: GameRecord[]) => void; knownIds: ReadonlySet<string> };

/** Marks a fetched game that is already in the user's game list. */
function InList({ id, knownIds }: { id: string; knownIds: ReadonlySet<string> }) {
  return knownIds.has(id) ? <span className="in-list"> · ✓ {t('import.inList')}</span> : null;
}

export function ImportPanel({ onImported, knownIds }: ImportProps) {
  useT();
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = getPref('importTab');
    return saved === 'chesscom' || saved === 'lichess' || saved === 'pgn' ? saved : 'pgn';
  });
  const setTab = (next: Tab) => {
    setTabState(next);
    setPref('importTab', next);
  };
  return (
    <section className="panel" aria-labelledby="import-title">
      <h2 id="import-title">{t('import.title')}</h2>
      <div className="tabs" role="tablist">
        {(['pgn', 'chesscom', 'lichess'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {k === 'pgn' ? 'PGN' : k === 'chesscom' ? 'Chess.com' : 'Lichess'}
          </button>
        ))}
      </div>
      {tab === 'pgn' && <PgnImport onImported={onImported} />}
      {tab === 'chesscom' && <ChessComImport onImported={onImported} knownIds={knownIds} />}
      {tab === 'lichess' && <LichessImport onImported={onImported} knownIds={knownIds} />}
    </section>
  );
}

function PgnImport({ onImported }: { onImported: (g: GameRecord[]) => void }) {
  const [text, setText] = useState('');
  useT();
  const [messages, setMessages] = useState<string[]>([]);
  const [firstIsOk, setFirstIsOk] = useState(false);

  const load = (input: string, source: 'pgn-paste' | 'pgn-file') => {
    if (isChessComGameUrl(input.trim())) {
      setFirstIsOk(false);
      setMessages([t('import.pgn.chesscomUrl')]);
      return;
    }
    if (input.includes('lichess.org') && parseLichessGameId(input.trim()) && input.trim().length < 80) {
      setFirstIsOk(false);
      setMessages([t('import.pgn.lichessUrl')]);
      return;
    }
    const r = parsePgn(input, { source });
    const msgs = r.errors.map((e) =>
      e.headers?.White
        ? t('import.pgn.gameErrorPlayers', { n: e.index + 1, white: e.headers.White, black: e.headers.Black ?? '?', reason: e.message })
        : t('import.pgn.gameError', { n: e.index + 1, reason: e.message }),
    );
    if (r.truncated) msgs.push(t('import.pgn.truncated', { max: PGN_LIMITS.maxGames }));
    if (r.games.length) msgs.unshift(tn('import.pgn.imported', r.games.length));
    setFirstIsOk(r.games.length > 0);
    setMessages(msgs);
    if (r.games.length) onImported(r.games);
  };

  return (
    <div className="stack">
      <label className="stack small">
        {t('import.pgn.paste')}
        <textarea dir="ltr" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 ...'} />
      </label>
      <div className="row">
        <button type="button" className="primary" disabled={!text.trim()} onClick={() => load(text, 'pgn-paste')}>
          {t('import.pgn.importPasted')}
        </button>
        <label className="row small">
          <span>{t('import.pgn.upload')}</span>
          <input
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > PGN_LIMITS.maxBytes) {
                setFirstIsOk(false);
                return setMessages([t('import.pgn.tooLarge')]);
              }
              load(await f.text(), 'pgn-file');
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {messages.length > 0 && (
        <ul className="small" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className={i === 0 && firstIsOk ? '' : 'error'}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChessComImport({ onImported, knownIds }: ImportProps) {
  const [username, setUsername] = useState(() => getPref('chesscomUsername') ?? '');
  const [saved, setSaved] = useState(() => getPref('chesscomUsername'));
  useT();
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
      if (isChessComGameUrl(username)) throw new ImportError('unsupported', t('import.chesscom.gameUrl'));
      const r = await chesscom.recentGames(username, { monthsBack });
      setGames(r.games);
      setPref('chesscomUsername', r.username);
      setPref('chesscomMonths', String(monthsBack));
      setSaved(r.username);
      const months = r.months.map((m) => m.split('/games/')[1]).join(', ');
      const skipped = r.skipped.map((s) => `${s.count} ${s.reason}`).join(', ');
      setInfo(
        r.months.length === 0
          ? t('import.chesscom.noArchives')
          : `${tn('import.chesscom.found', r.games.length, { months })}${skipped ? ` ${t('import.skipped', { skipped })}` : ''}`,
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
        <label className="sr-only" htmlFor="cc-user">{t('import.chesscom.username')}</label>
        <input id="cc-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('import.chesscom.username')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <label className="small row">
          {t('import.chesscom.months')}
          <select value={monthsBack} onChange={(e) => setMonthsBack(Number(e.target.value))}>
            {[1, 2, 3, 6].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy || !username.trim()}>{busy ? t('common.loading') : t('import.fetch')}</button>
      </form>
      {saved && (
        <p className="small muted row">
          {t('import.remembered')} <strong>{saved}</strong>
          <button
            type="button"
            className="link"
            onClick={() => {
              setPref('chesscomUsername', null);
              setSaved(null);
              setUsername('');
            }}
          >
            {t('import.forget')}
          </button>
        </p>
      )}
      <p className="notice">{chesscomFreshnessNote()}</p>
      {error && <p className="error small" role="alert">{error}</p>}
      {info && <p className="small muted" aria-live="polite">{info}</p>}
      {games && games.length > 0 && (
        <>
          <p className="small">{t('import.chesscom.latest')} <strong>{formatDate(games[0]!.end_time)}</strong></p>
          <ul className="game-list">
            {games.slice(0, 100).map((g, i) => (
              <li key={g.url ?? i}>
                <button type="button" onClick={() => importOne(g)}>
                  {t('import.players', { white: `${g.white?.username} (${g.white?.rating ?? '?'})`, black: `${g.black?.username} (${g.black?.rating ?? '?'})` })}
                  <div className="meta">
                    {g.time_class} · {formatDate(g.end_time)} · {g.white?.result}/{g.black?.result}
                    {g.url && <InList id={`url:${g.url}`} knownIds={knownIds} />}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LichessImport({ onImported, knownIds }: ImportProps) {
  useT();
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
        setInfo(t('import.lichess.imported'));
      } else {
        const r = await lichess.recentGames(input, { max: 30 });
        setGames(r.games);
        setPref('lichessUsername', r.username);
        setSaved(r.username);
        const skipped = r.skipped.map((s) => `${s.count} ${s.reason}`).join(', ');
        setInfo(`${tn('import.lichess.found', r.games.length)}${skipped ? ` ${t('import.skipped', { skipped })}` : ''}`);
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
        <label className="sr-only" htmlFor="li-input">{t('import.lichess.input')}</label>
        <input id="li-input" style={{ flex: 1, minWidth: 200 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('import.lichess.input')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <button type="submit" className="primary" disabled={busy || !input.trim()}>
          {busy ? t('common.loading') : isGame ? t('import.lichess.importGame') : t('import.fetch')}
        </button>
      </form>
      {saved && (
        <p className="small muted row">
          {t('import.remembered')} <strong>{saved}</strong>
          {input !== saved && (
            <button type="button" className="link" onClick={() => setInput(saved)}>
              {t('import.useIt')}
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
            {t('import.forget')}
          </button>
        </p>
      )}
      <p className="notice">{t('import.lichess.note')}</p>
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
                {t('import.players', { white: `${g.white?.name ?? '?'} (${g.white?.rating ?? '?'})`, black: `${g.black?.name ?? '?'} (${g.black?.rating ?? '?'})` })}
                <div className="meta">
                  {g.speed} · {formatDate(g.lastMoveAt ? g.lastMoveAt / 1000 : undefined)} · {g.status}
                  {g.winner ? ` · ${t(g.winner === 'white' ? 'import.whiteWon' : 'import.blackWon')}` : ''}
                  <InList id={`url:https://lichess.org/${g.id}`} knownIds={knownIds} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
