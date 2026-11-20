import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { nagText } from '../../core/repertoire/nags';
import { displayComments } from '../../core/repertoire/parse';
import type { RepNode } from '../../core/repertoire/types';
import { t } from '../../i18n';

/** Variations nested this deep (or deeper) start collapsed. */
const COLLAPSE_DEPTH = 2;

const keyOf = (path: readonly number[]) => path.join('.');
const isPrefix = (prefix: string, of: string) => prefix === '' || of === prefix || of.startsWith(`${prefix}.`);

function moveNumber(parentFen: string, force: boolean): string {
  const parts = parentFen.split(' ');
  const n = parts[5] ?? '1';
  return parts[1] === 'b' ? (force ? `${n}… ` : '') : `${n}. `;
}

function countMoves(n: RepNode): number {
  return n.children.reduce((s, c) => s + 1 + countMoves(c), 0);
}

type Props = {
  root: RepNode;
  current: readonly number[];
  onSelect: (path: number[]) => void;
};

/**
 * The chapter's moves: main line inline, each alternative as an indented block under the move it
 * replaces, comments in between. Deep variations start collapsed and open when the current move
 * is inside them.
 */
export const VariationTree = memo(function VariationTree({ root, current, onSelect }: Props) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const box = useRef<HTMLDivElement>(null);
  const currentKey = keyOf(current);

  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[aria-current="true"]');
    const container = box.current;
    if (!el || !container) return;
    const top = el.offsetTop; // the tree is position: relative, so this is relative to it
    if (top < container.scrollTop || top > container.scrollTop + container.clientHeight - 30) {
      container.scrollTop = Math.max(0, top - container.clientHeight / 3);
    }
  }, [currentKey]);

  const comments = (texts: readonly string[] | undefined, key: string) =>
    displayComments(texts).map((c, i) => (
      <span key={`${key}-c${i}`} className="tree-comment" dir="auto">
        {c}
      </span>
    ));

  const move = (node: RepNode, path: number[], parentFen: string, force: boolean): ReactNode => {
    const key = keyOf(path);
    const nags = nagText(node.nags);
    return [
      ...(comments(node.commentsBefore, `${key}b`) ?? []),
      <button
        key={key}
        type="button"
        className="tree-move"
        data-path={key}
        aria-current={key === currentKey ? 'true' : undefined}
        onClick={() => onSelect(path)}
      >
        <bdi dir="ltr">
          {moveNumber(parentFen, force)}
          {node.san}
          {nags.move && <span className="tree-nag">{nags.move}</span>}
          {nags.position && <span className="tree-nag"> {nags.position}</span>}
        </bdi>
      </button>,
      ...(comments(node.comments, `${key}a`) ?? []),
    ];
  };

  /** The rest of a line after `parent` (whose path is `parentPath`), following main moves. */
  const line = (parent: RepNode, parentPath: number[], depth: number, forceFirst: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let node = parent;
    let path = parentPath;
    let force = forceFirst;
    while (node.children.length > 0) {
      const main = node.children[0]!;
      const mainPath = [...path, 0];
      out.push(move(main, mainPath, node.fen, force || !!main.commentsBefore?.length));
      force = !!main.comments?.length;
      if (node.children.length > 1) {
        out.push(
          <div key={`${keyOf(path)}-vars`} className="tree-variations">
            {node.children.slice(1).map((v, i) => variation(node, v, [...path, i + 1], depth + 1))}
          </div>,
        );
        force = true;
      }
      node = main;
      path = mainPath;
    }
    return out;
  };

  const variation = (parent: RepNode, start: RepNode, path: number[], depth: number): ReactNode => {
    const key = keyOf(path);
    const collapsed = depth >= COLLAPSE_DEPTH && !opened.has(key) && !isPrefix(key, currentKey);
    const rest = countMoves(start);
    return (
      <div key={key} className="tree-variation">
        {move(start, path, parent.fen, true)}
        {collapsed && rest > 0 ? (
          <button type="button" className="link small tree-expand" onClick={() => setOpened((s) => new Set(s).add(key))}>
            {t('repertoire.tree.more', { n: rest })}
          </button>
        ) : (
          line(start, path, depth, !!start.comments?.length)
        )}
      </div>
    );
  };

  return (
    <div className="variation-tree" dir="ltr" ref={box} aria-label={t('repertoire.tree.label')}>
      {comments(root.comments, 'root')}
      {line(root, [], 0, false)}
      {root.children.length === 0 && <p className="small muted">{t('repertoire.tree.noMoves')}</p>}
    </div>
  );
});
