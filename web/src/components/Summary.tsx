import { CATEGORY_LABELS, CATEGORY_ORDER } from '../core/classification/classify';
import type { GameRecord } from '../core/chess/types';
import type { GameAnalysis } from '../features/analysis/types';
import { CategoryBadge } from './CategoryBadge';

export function Summary({ game, analysis }: { game: GameRecord; analysis: GameAnalysis }) {
  const s = analysis.summary;
  if (!s) return null;
  const provisional = analysis.phase !== 'done';
  const acc = (v?: number) => (v === undefined ? '—' : v.toFixed(1));
  const provider = game.source === 'chesscom' ? 'Chess.com' : game.source === 'lichess' ? 'Lichess' : 'Provider';
  return (
    <div>
      <table className="summary-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">{game.headers.White ?? 'White'}</th>
            <th scope="col">{game.headers.Black ?? 'Black'}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" title={`Our own estimate (${analysis.accuracyVersion}); not any provider's accuracy.`}>
              Analyser accuracy{provisional ? ' (provisional)' : ''}
            </th>
            <td>{acc(s.white.accuracy.value)}</td>
            <td>{acc(s.black.accuracy.value)}</td>
          </tr>
          <tr>
            <th scope="row">Avg. centipawn loss</th>
            <td>{s.white.averageCpLoss ?? '—'}</td>
            <td>{s.black.averageCpLoss ?? '—'}</td>
          </tr>
          {CATEGORY_ORDER.map((c) => (
            <tr key={c}>
              <th scope="row">
                <CategoryBadge category={c} /> {CATEGORY_LABELS[c].label}
              </th>
              <td>{s.white.counts[c]}</td>
              <td>{s.black.counts[c]}</td>
            </tr>
          ))}
          {(s.white.providerAccuracy !== undefined || s.black.providerAccuracy !== undefined) && (
            <tr>
              <th scope="row" title="Supplied by the provider; shown separately, never mixed with our analysis.">
                {provider} accuracy (provider data)
              </th>
              <td>{acc(s.white.providerAccuracy)}</td>
              <td>{acc(s.black.providerAccuracy)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="small muted">
        Scored {s.white.accuracy.scoredMoves + s.black.accuracy.scoredMoves} of{' '}
        {s.white.accuracy.totalMoves + s.black.accuracy.totalMoves} non-forced moves · {analysis.engineId} · {analysis.policyVersion}
      </p>
    </div>
  );
}
