import { ACCURACY_VERSION } from '../core/scoring/accuracy';
import { BRILLIANCY_VERSION } from '../core/brilliancy/detector';
import { GREAT_VERSION } from '../core/brilliancy/great';
import { CATEGORY_LABELS, CATEGORY_ORDER, DEFAULT_POLICY } from '../core/classification/classify';
import { CategoryBadge } from '../components/CategoryBadge';

export function Disclaimer() {
  return (
    <footer className="disclaimer">
      This is an independent project. It is not affiliated with, endorsed by or connected to Chess.com or Lichess. Move
      labels and accuracy are our own estimates, not either site's classifications. Engine: Stockfish.js (GPL-3.0) —{' '}
      <a href="engines/STOCKFISH-COPYING.txt">licence</a>, <a href="https://github.com/nmrugg/stockfish.js">source</a>.
    </footer>
  );
}

export function About() {
  return (
    <div className="panel stack" style={{ maxWidth: 820 }}>
      <h2>How the analysis works</h2>
      <p>
        Each position is searched by Stockfish running as WebAssembly in a Web Worker in your browser. The played move is
        compared with the engine's best move in the same position, at the same depth, and from the same player's point of
        view. If the played move is not among the top lines, it gets its own restricted search (<code>go … searchmoves</code>).
      </p>
      <h3>Move labels ({DEFAULT_POLICY.version})</h3>
      <p className="small">
        Labels use the drop in the mover's expected score (0–100 points, derived from the engine evaluation). Thresholds: best ≤{' '}
        {DEFAULT_POLICY.bestMaxLossPct}, good ≤ {DEFAULT_POLICY.goodMaxLossPct}, inaccuracy ≤ {DEFAULT_POLICY.questionableMaxLossPct},
        mistake ≤ {DEFAULT_POLICY.mistakeMaxLossPct}, blunder above. Allowing an avoidable mate is always a blunder; missing a mate is
        at least a mistake.
      </p>
      <ul className="small">
        {CATEGORY_ORDER.map((c) => (
          <li key={c}>
            <CategoryBadge category={c} /> <strong>{CATEGORY_LABELS[c].label}</strong> — {CATEGORY_LABELS[c].description}
          </li>
        ))}
      </ul>
      <h3>Accuracy ({ACCURACY_VERSION})</h3>
      <p className="small">
        Per move: 100 · e<sup>−0.045 · loss</sup>, averaged over each player's non-forced moves. It is shown only after at least five
        scored moves and is marked provisional until the analysis finishes. Provider accuracy (when supplied) is shown separately.
      </p>
      <h3>Brilliant moves ({BRILLIANCY_VERSION}, experimental)</h3>
      <p className="small">
        The idea: look at the position the way a player who calculates only 1–3 plies would. A move is brilliant when that
        shallow look rates it a clear mistake (at least 10 points worse than the best move at that depth), yet a full-depth
        search finds it is the best move, clearly better than the alternatives, sound from a depth beyond the shallow look,
        and still best on a deeper recheck. Without the recheck it is shown as a candidate. Because hardly anyone looks
        past giving up their queen, a queen-sized sacrifice only has to look bad within 1 ply, so a queen sacrifice
        followed by a quick mate can be brilliant. Engine depth is not human
        difficulty, so treat this as evidence, not a verdict.
      </p>
      <h3>Great moves ({GREAT_VERSION}, experimental)</h3>
      <p className="small">
        A great move is the best move, far better than every alternative at full depth (at least 12 points of expected score
        ahead of the next move, and still clearly ahead on a deeper recheck), while a 1–3 ply look cannot tell it apart from
        the alternatives (it leads them by less than 4 points there, or even looks worse). An obvious recapture is far
        better than the alternatives too, but even a 1-ply look sees that, so it stays "best". It uses the same searches as
        the brilliancy check. A brilliant move is also great, but is shown as brilliant.
      </p>
      <h3>Imports</h3>
      <p className="small">
        Chess.com: public monthly archives by username. The newest games can take up to ~12 hours to appear; paste the PGN for
        instant analysis. Lichess: by username, or by game URL immediately after a game ends. Only finished standard-chess games
        are analysed.
      </p>
    </div>
  );
}
