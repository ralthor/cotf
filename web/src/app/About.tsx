import { ACCURACY_VERSION } from '../core/scoring/accuracy';
import { BRILLIANCY_VERSION } from '../core/brilliancy/detector';
import { GREAT_VERSION } from '../core/brilliancy/great';
import { CATEGORY_ORDER, DEFAULT_POLICY } from '../core/classification/classify';
import { CategoryBadge } from '../components/CategoryBadge';
import { categoryDescription, categoryLabel } from '../components/categoryText';
import { useT } from '../i18n/react';

export function Disclaimer() {
  const { t } = useT();
  return (
    <footer className="disclaimer">
      {t('about.disclaimer')}{' '}
      <a href="engines/STOCKFISH-COPYING.txt">{t('about.licence')}</a>, <a href="https://github.com/nmrugg/stockfish.js">{t('about.source')}</a>.
    </footer>
  );
}

export function About() {
  const { t } = useT();
  const p = DEFAULT_POLICY;
  return (
    <div className="panel stack" style={{ maxWidth: 820 }}>
      <h2>{t('about.title')}</h2>
      <p>{t('about.how')}</p>
      <h3>{t('about.labels.title', { version: p.version })}</h3>
      <p className="small">
        {t('about.labels.text', {
          best: p.bestMaxLossPct,
          good: p.goodMaxLossPct,
          inaccuracy: p.questionableMaxLossPct,
          mistake: p.mistakeMaxLossPct,
        })}
      </p>
      <ul className="small">
        {CATEGORY_ORDER.map((c) => (
          <li key={c}>
            <CategoryBadge category={c} /> <strong>{categoryLabel(c)}</strong> — {categoryDescription(c)}
          </li>
        ))}
      </ul>
      <h3>{t('about.accuracy.title', { version: ACCURACY_VERSION })}</h3>
      <p className="small">
        <span dir="ltr">100 · e<sup>−0.045 · loss</sup></span> — {t('about.accuracy.text')}
      </p>
      <h3>{t('about.brilliant.title', { version: BRILLIANCY_VERSION })}</h3>
      <p className="small">{t('about.brilliant.text')}</p>
      <h3>{t('about.great.title', { version: GREAT_VERSION })}</h3>
      <p className="small">{t('about.great.text')}</p>
      <h3>{t('about.imports.title')}</h3>
      <p className="small">{t('about.imports.text')}</p>
    </div>
  );
}
