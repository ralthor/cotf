import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { lichessAnalysisUrl } from '../../core/chess/links';
import { nagKey, nagText } from '../../core/repertoire/nags';
import { openingOf } from '../../core/openings/names';
import { displayComments, nodeAt, nodesOnPath } from '../../core/repertoire/parse';
import type { Chapter, Eval, RepNode, ShapeColor } from '../../core/repertoire/types';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';
import { useT } from '../../i18n/react';
import { sideLabel } from './RepertoireList';
import { ExplorerPanel } from './ExplorerPanel';
import { YourGamesPanel } from './YourGamesPanel';
import { useOpenings } from './useOpenings';
import { VariationTree } from './VariationTree';

/** Lichess' study colours, so arrows look as they did in the study. */
const SHAPE: Record<ShapeColor, string> = {
  green: 'rgba(21,120,27,0.8)',
  red: 'rgba(136,32,32,0.8)',
  yellow: 'rgba(230,143,0,0.8)',
  blue: 'rgba(0,48,136,0.8)',
};
const LAST_MOVE = 'rgba(47,111,143,0.28)';

export function formatEval(e: Eval): string {
  if ('mate' in e) return `#${e.mate}`;
  return `${e.pawns > 0 ? '+' : ''}${e.pawns.toFixed(2)}`;
}

/** Move label such as "3... Bf5", from the position before it. */
function moveLabel(parent: RepNode, node: RepNode): string {
  const parts = parent.fen.split(' ');
  return `${parts[5] ?? '1'}${parts[1] === 'b' ? '…' : '.'} ${node.san}`;
}

/** Follows main moves from `path` to the end of the line. */
function lineEnd(root: RepNode, path: number[]): number[] {
  const out = [...path];
  let n = nodeAt(root, out);
  while (n && n.children.length) {
    out.push(0);
    n = n.children[0];
  }
  return out;
}

export function ChapterView({ chapter }: { chapter: Chapter }) {
  useT();
  const root = chapter.root;
  // The parent keys this view by chapter id (and import time), so the path resets on change.
  const [path, setPath] = useState<number[]>([]);
  const [orientation, setOrientation] = useState<'white' | 'black'>(chapter.side === 'b' ? 'black' : 'white');
  const node = nodeAt(root, path) ?? root;
  const parent = path.length ? nodeAt(root, path.slice(0, -1)) : undefined;

  const go = useCallback((p: number[]) => setPath(nodeAt(root, p) ? p : []), [root]);
  const prev = useCallback(() => setPath((p) => p.slice(0, -1)), []);
  const next = useCallback(() => setPath((p) => (nodeAt(root, p)?.children.length ? [...p, 0] : p)), [root]);
  /** Up/down: the previous or next alternative to the current move. */
  const sibling = useCallback(
    (delta: 1 | -1) =>
      setPath((p) => {
        if (!p.length) return p;
        const par = nodeAt(root, p.slice(0, -1));
        const i = p[p.length - 1]! + delta;
        return par && i >= 0 && i < par.children.length ? [...p.slice(0, -1), i] : p;
      }),
    [root],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowUp') sibling(-1);
      else if (e.key === 'ArrowDown') sibling(1);
      else if (e.key === 'Home') setPath([]);
      else if (e.key === 'End') setPath((p) => lineEnd(root, p));
      else if (e.key === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, sibling, root]);

  // Horizontal swipe on the board steps through moves (phones).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    touch.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    const p = e.changedTouches[0];
    touch.current = null;
    if (!start || !p) return;
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) (dx < 0 ? next : prev)();
  };

  const arrows = useMemo(
    () =>
      (node.shapes ?? [])
        .filter((s) => s.from !== s.to)
        .map((s) => ({ startSquare: s.from, endSquare: s.to, color: SHAPE[s.color] })),
    [node],
  );
  const squareStyles = useMemo(() => {
    const out: Record<string, React.CSSProperties> = {};
    if (node.uci) {
      out[node.uci.slice(0, 2)] = { background: LAST_MOVE };
      out[node.uci.slice(2, 4)] = { background: LAST_MOVE };
    }
    for (const s of node.shapes ?? []) {
      if (s.from === s.to) out[s.from] = { ...out[s.from], boxShadow: `inset 0 0 0 4px ${SHAPE[s.color]}`, borderRadius: '50%' };
    }
    return out;
  }, [node]);

  const atStart = path.length === 0;
  const atEnd = node.children.length === 0;
  const nags = nagText(node.nags);
  const lichessChapter = chapter.source.kind === 'lichess-study' ? chapter.source.url : null;
  const nextMoves = node.children;
  const before = displayComments(node.commentsBefore);
  const openings = useOpenings();
  const opening = useMemo(() => (openings ? openingOf(openings, nodesOnPath(root, path).map((n) => n.posKey)) : null), [openings, root, path]);
  const after = displayComments(node.comments);

  return (
    <div className="stack">
      <div className="game-title row">
        <h2 style={{ margin: 0, fontSize: 18, flex: 1, minWidth: 0 }}>
          <bdi>{chapter.title}</bdi>
        </h2>
        <span className="small muted">{sideLabel(chapter.side)}</span>
        {lichessChapter && (
          <a href={lichessChapter} target="_blank" rel="noreferrer noopener" className="small hide-mobile">
            {t('repertoire.openStudy')} ↗
          </a>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
          aria-label={t('game.flip')}
          title={t('game.flip')}
        >
          <Icon name="flip" size={18} />
        </button>
        <a className="button-link" href={lichessAnalysisUrl(node.fen, orientation)} target="_blank" rel="noreferrer noopener" title={t('game.lichessBoard')} dir="ltr">
          Lichess ↗
        </a>
      </div>

      {opening && (
        <p className="opening-name small" style={{ margin: '-4px 0 0' }}>
          <span className="muted" dir="ltr">
            {opening.eco}
          </span>{' '}
          <bdi>{opening.name}</bdi>
        </p>
      )}
      <div className="chapter-view">
        <div className="board-col">
          <div className="board-wrap" dir="ltr" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <Chessboard
              options={{
                id: 'chapter-board',
                position: node.fen,
                boardOrientation: orientation,
                allowDragging: false,
                arrows,
                squareStyles,
                lightSquareStyle: { backgroundColor: 'var(--board-light)' },
                darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
                animationDurationInMs: 150,
              }}
            />
          </div>
          <div className="controls" role="group" aria-label={t('game.nav')} dir="ltr">
            <button type="button" onClick={() => setPath([])} aria-label={t('game.first')} title={t('game.first')} disabled={atStart}>
              <Icon name="first" />
            </button>
            <button type="button" onClick={prev} aria-label={t('game.prev')} title={t('game.prev')} disabled={atStart}>
              <Icon name="prev" />
            </button>
            <button type="button" onClick={next} aria-label={t('game.next')} title={t('game.next')} disabled={atEnd}>
              <Icon name="next" />
            </button>
            <button type="button" onClick={() => setPath(lineEnd(root, path))} aria-label={t('game.last')} title={t('game.last')} disabled={atEnd}>
              <Icon name="last" />
            </button>
          </div>
        </div>

        <div className="stack side">
          <section className="panel chapter-comment" aria-live="polite" aria-labelledby="chapter-move">
            <h3 id="chapter-move" className="row" style={{ marginTop: 0 }}>
              {parent ? (
                <bdi dir="ltr">
                  {moveLabel(parent, node)}
                  {nags.move && (
                    <span className="tree-nag" title={node.nags?.map(nagKey).filter(Boolean).map((k) => t(k!)).join(', ')}>
                      {nags.move}
                    </span>
                  )}
                </bdi>
              ) : (
                <span>{t('repertoire.start')}</span>
              )}
              {nags.position && (
                <span className="tree-nag" title={node.nags?.map(nagKey).filter(Boolean).map((k) => t(k!)).join(', ')}>
                  {nags.position}
                </span>
              )}
              {node.eval && (
                <bdi dir="ltr" className="small muted">
                  {formatEval(node.eval)}
                </bdi>
              )}
            </h3>
            {before.map((c, i) => (
              <p key={`b${i}`} className="muted" dir="auto">
                {c}
              </p>
            ))}
            {after.length ? (
              after.map((c, i) => (
                <p key={i} dir="auto">
                  {c}
                </p>
              ))
            ) : (
              !before.length && <p className="small muted">{t('repertoire.noComment')}</p>
            )}
            {nextMoves.length > 1 && (
              <div className="row small next-moves">
                <span className="muted">{t('repertoire.nextMoves')}</span>
                {nextMoves.map((c, i) => (
                  <button key={i} type="button" className="small" onClick={() => go([...path, i])}>
                    <bdi dir="ltr">{c.san}</bdi>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="panel">
            <VariationTree root={root} current={path} onSelect={go} />
            <p className="small muted" style={{ marginBottom: 0 }}>
              {t('repertoire.keys')}
            </p>
          </section>
          <ExplorerPanel node={node} onPlay={(i) => go([...path, i])} />
          <YourGamesPanel node={node} side={chapter.side} onPlay={(i) => go([...path, i])} />
        </div>
      </div>
    </div>
  );
}
