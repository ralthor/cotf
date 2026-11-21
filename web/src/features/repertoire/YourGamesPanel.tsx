import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { GAME_PLIES } from '../../core/repertoire/games';
import { buildGamesTree, nodeId, type GamesTree } from '../../core/repertoire/insights';
import type { OpeningGame } from '../../core/repertoire/games';
import type { RepNode, Side } from '../../core/repertoire/types';
import { t, tn } from '../../i18n';
import { useT } from '../../i18n/react';
import { getPref, setPref } from '../../storage/prefs';
import { GamesList, NextTable, NumbersBlock, OrdersList } from './InsightsView';
import { useOpeningGames } from './useOpeningGames';

// The last tree built, kept while the same games are stored (building it from 2,000 games takes about a second).
let cached: { sig: string; tree: GamesTree } | null = null;
function treeFor(games: readonly OpeningGame[]): GamesTree {
  const sig = `${games.length}|${games[0]?.id}|${games[games.length - 1]?.id}`;
  if (cached?.sig !== sig) cached = { sig, tree: buildGamesTree(games, GAME_PLIES) };
  return cached.tree;
}

/** Your fetched games at this position of a chapter, with the side the chapter is for. */
function Body({ node, side, onPlay }: { node: RepNode; side: Side; onPlay: (childIndex: number) => void }) {
  const og = useOpeningGames();
  const tree = useMemo(() => treeFor(og.games), [og.games]);
  if (!og.loaded) return null;
  if (!og.games.length) return <p className="small">{t('yourGames.noGames')}</p>;
  const here = tree.nodes.get(nodeId(side, node.posKey));
  if (!here) return <p className="small">{t('yourGames.none', { side: t(side === 'w' ? 'repertoire.white' : 'repertoire.black') })}</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <NumbersBlock node={here} tree={tree} />
      <h3 className="small" style={{ margin: 0 }}>
        {tn('insights.orders', here.orders.length)}
      </h3>
      <OrdersList node={here} />
      {here.next.length > 0 && (
        <>
          <h3 className="small" style={{ margin: 0 }}>
            {t('insights.next')}
          </h3>
          <NextTable
            node={here}
            onPick={(m) => {
              const i = node.children.findIndex((c) => c.uci === m.uci);
              if (i >= 0) onPlay(i);
            }}
          />
        </>
      )}
      <GamesList key={here.id} node={here} tree={tree} />
    </div>
  );
}

/** Folded panel under the chapter's tree: how this position went in your own games. */
export function YourGamesPanel({ node, side, onPlay }: { node: RepNode; side: Side; onPlay: (childIndex: number) => void }) {
  useT();
  const [open, setOpen] = useState(() => getPref('yourGamesOpen') === '1');
  const toggle = () => {
    setOpen(!open);
    setPref('yourGamesOpen', open ? null : '1');
  };
  return (
    <section className="panel stack" aria-labelledby="your-games-title" style={{ gap: 8 }}>
      <h2 id="your-games-title" style={{ margin: 0 }}>
        <button type="button" className="fold-toggle" aria-expanded={open} aria-controls="your-games-body" onClick={toggle}>
          {t('yourGames.title')} <Icon name="chevronDown" size={16} />
        </button>
      </h2>
      {open && (
        <div id="your-games-body">
          <Body node={node} side={side} onPlay={onPlay} />
        </div>
      )}
    </section>
  );
}
