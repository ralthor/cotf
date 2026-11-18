import { CATEGORY_ORDER } from '../core/classification/classify';
import { useT } from '../i18n/react';
import { categoryLabel } from './categoryText';
import type { GameRecord } from '../core/chess/types';
import type { GameAnalysis } from '../features/analysis/types';
import { CategoryBadge } from './CategoryBadge';

export function Summary({ game, analysis }: { game: GameRecord; analysis: GameAnalysis }) {
  const { t } = useT();
  const s = analysis.summary;
  if (!s) return null;
  const provisional = analysis.phase !== 'done';
  const acc = (v?: number) => (v === undefined ? '—' : v.toFixed(1));
  const provider = game.source === 'chesscom' ? 'Chess.com' : game.source === 'lichess' ? 'Lichess' : t('summary.provider');
  return (
    <div>
      <table className="summary-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">{game.headers.White ?? t('colour.white')}</th>
            <th scope="col">{game.headers.Black ?? t('colour.black')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" title={t('summary.accuracy.title', { version: analysis.accuracyVersion })}>
              {provisional ? t('summary.accuracy.provisional') : t('summary.accuracy')}
            </th>
            <td>{acc(s.white.accuracy.value)}</td>
            <td>{acc(s.black.accuracy.value)}</td>
          </tr>
          <tr>
            <th scope="row">{t('summary.acpl')}</th>
            <td>{s.white.averageCpLoss ?? '—'}</td>
            <td>{s.black.averageCpLoss ?? '—'}</td>
          </tr>
          {CATEGORY_ORDER.map((c) => (
            <tr key={c}>
              <th scope="row">
                <CategoryBadge category={c} /> {categoryLabel(c)}
              </th>
              <td>{s.white.counts[c]}</td>
              <td>{s.black.counts[c]}</td>
            </tr>
          ))}
          {(s.white.providerAccuracy !== undefined || s.black.providerAccuracy !== undefined) && (
            <tr>
              <th scope="row" title={t('summary.providerAccuracy.title')}>
                {t('summary.providerAccuracy', { provider })}
              </th>
              <td>{acc(s.white.providerAccuracy)}</td>
              <td>{acc(s.black.providerAccuracy)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="small muted">
        {t('summary.scored', {
          scored: s.white.accuracy.scoredMoves + s.black.accuracy.scoredMoves,
          total: s.white.accuracy.totalMoves + s.black.accuracy.totalMoves,
        })}{' '}
        · {analysis.engineId} · {analysis.policyVersion}
      </p>
    </div>
  );
}
