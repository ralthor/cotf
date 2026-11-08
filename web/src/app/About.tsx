import { ACCURACY_VERSION } from '../core/scoring/accuracy';
import { BRILLIANCY_VERSION } from '../core/brilliancy/detector';
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
        A move is a brilliant candidate when the engine ranks it poorly at shallow depths but finds it best and sound at depth.
        The rank is measured over all legal moves, and the same move's score is tracked at every depth. The move must be best at the
        deep search, must not leave the mover losing, must stay sound for several depths, and must survive an independent deeper
        recheck. Material sacrifices and clear uniqueness strengthen the score. Engine depth is not human difficulty, so treat
        this as evidence, not a verdict.
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
