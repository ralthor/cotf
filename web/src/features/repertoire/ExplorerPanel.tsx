import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { RepNode } from '../../core/repertoire/types';
import { getLocale, t } from '../../i18n';
import { useT } from '../../i18n/react';
import { getPref, setPref } from '../../storage/prefs';
import { explorer, ExplorerError, needsToken, type ExplorerDb, type ExplorerResult } from './explorer';

const TOKEN_URL = 'https://lichess.org/account/oauth/token/create?description=Chess+on+the+Fly+explorer';
const count = (n: number) =>
  new Intl.NumberFormat(getLocale(), {
    notation: n >= 10_000 ? 'compact' : 'standard',
  }).format(n);

/** One row's results as a three-part bar: white wins, draws, black wins. */
function ResultBar({ w, d, b }: { w: number; d: number; b: number }) {
  const n = w + d + b || 1;
  const pc = (x: number) => Math.round((x / n) * 100);
  return (
    <div className="result-bar" dir="ltr" aria-label={t('explorer.results', { w: pc(w), d: pc(d), b: pc(b) })}>
      <span className="rb-w" style={{ width: `${pc(w)}%` }}>
        {pc(w) >= 12 ? `${pc(w)}%` : ''}
      </span>
      <span className="rb-d" style={{ width: `${pc(d)}%` }}>
        {pc(d) >= 12 ? `${pc(d)}%` : ''}
      </span>
      <span className="rb-b" style={{ width: `${pc(b)}%` }}>
        {pc(b) >= 12 ? `${pc(b)}%` : ''}
      </span>
    </div>
  );
}

/**
 * Popularity and results of the moves in the current position, from the Lichess opening explorer.
 * Folded by default; needs the user's own Lichess token.
 */
export function ExplorerPanel({ node, onPlay }: { node: RepNode; onPlay: (childIndex: number) => void }) {
  useT();
  const [open, setOpen] = useState(() => getPref('explorerOpen') === '1');
  const [db, setDb] = useState<ExplorerDb>(() => (getPref('explorerDb') === 'lichess' ? 'lichess' : 'masters'));
  const [token, setToken] = useState(() => getPref('lichessToken') ?? '');
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<{
    key: string;
    result?: ExplorerResult;
    error?: string;
  } | null>(null);
  const key = `${db}|${node.fen}`;
  const current = state?.key === key ? state : null;

  useEffect(() => {
    if (!open || (needsToken(db) && !token)) return;
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      explorer.get(db, node.fen, token, ctl.signal).then(
        (result) => setState({ key, result }),
        (e: unknown) => {
          if ((e as Error).name !== 'AbortError')
            setState({
              key,
              error: t(`explorer.error.${e instanceof ExplorerError ? e.code : 'network'}`),
            });
        },
      );
    }, 250);
    return () => {
      window.clearTimeout(id);
      ctl.abort();
    };
  }, [open, token, db, node.fen, key]);

  const toggle = () => {
    setOpen(!open);
    setPref('explorerOpen', open ? null : '1');
  };
  const r = current?.result;
  const total = r ? r.white + r.draws + r.black : 0;

  return (
    <section className="panel stack" aria-labelledby="explorer-title" style={{ gap: 8 }}>
      <h2 id="explorer-title" style={{ margin: 0 }}>
        <button type="button" className="fold-toggle" aria-expanded={open} aria-controls="explorer-body" onClick={toggle}>
          {t('explorer.title')} <Icon name="chevronDown" size={16} />
        </button>
      </h2>
      {open && (
        <div id="explorer-body" className="stack" style={{ gap: 8 }}>
          <div className="row">
            <div className="segmented" role="group" aria-label={t('explorer.db')}>
              {(['masters', 'lichess'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={db === d}
                  onClick={() => {
                    setDb(d);
                    setPref('explorerDb', d);
                  }}
                >
                  {t(`explorer.db.${d}`)}
                </button>
              ))}
            </div>
            {token && (
              <button
                type="button"
                className="link small"
                onClick={() => {
                  setPref('lichessToken', null);
                  setToken('');
                }}
              >
                {t('explorer.removeToken')}
              </button>
            )}
          </div>
          {needsToken(db) && !token ? (
            <form
              className="stack"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim();
                if (!v) return;
                setPref('lichessToken', v);
                setToken(v);
                setDraft('');
              }}
            >
              <p className="small muted" style={{ margin: 0 }}>
                {t('explorer.needToken')}{' '}
                <a href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
                  {t('explorer.createToken')} ↗
                </a>
              </p>
              <div className="row">
                <label className="sr-only" htmlFor="explorer-token">
                  {t('explorer.token')}
                </label>
                <input
                  id="explorer-token"
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('explorer.token')}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                />
                <button type="submit" disabled={!draft.trim()}>
                  {t('explorer.save')}
                </button>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {t('explorer.privacy')}
              </p>
            </form>
          ) : (
            <>
              {current?.error && <p className="small error">{current.error}</p>}
              {!current && <p className="small muted">{t('common.loading')}</p>}
              {r && total === 0 && <p className="small muted">{t('explorer.noGames')}</p>}
              {r && total > 0 && (
                <table className="games-table explorer-table">
                  <thead>
                    <tr>
                      <th>{t('explorer.move')}</th>
                      <th>{t('games.games')}</th>
                      <th>{t('explorer.resultsHead')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.moves.map((m) => {
                      const n = m.white + m.draws + m.black;
                      const mine = node.children.findIndex((c) => c.uci === m.uci);
                      return (
                        <tr key={m.uci} className={mine >= 0 ? 'in-rep' : undefined}>
                          <td dir="ltr">
                            {mine >= 0 ? (
                              <button type="button" className="link" onClick={() => onPlay(mine)} title={t('explorer.inRepertoire')}>
                                {m.san} ✓
                              </button>
                            ) : (
                              m.san
                            )}
                          </td>
                          <td>
                            {count(n)} <span className="muted small">({Math.round((n / total) * 100)}%)</span>
                          </td>
                          <td style={{ width: '45%' }}>
                            <ResultBar w={m.white} d={m.draws} b={m.black} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="small muted" style={{ margin: 0 }}>
                {t('explorer.source')}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
