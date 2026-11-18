import { CATEGORY_LABELS, type MoveCategory } from '../core/classification/classify';
import { useT } from '../i18n/react';
import { categoryDescription, categoryLabel } from './categoryText';

export function CategoryBadge({ category, candidate }: { category?: MoveCategory; candidate?: boolean }) {
  const { t } = useT();
  if (candidate && category !== 'brilliant' && category !== 'great') {
    return (
      <span className="badge candidate" title={t('category.candidate.title')}>
        !?
        <span className="sr-only">{t('category.candidate')}</span>
      </span>
    );
  }
  if (!category) return null;
  const c = CATEGORY_LABELS[category];
  return (
    <span className={`badge ${category}`} title={`${categoryLabel(category)}: ${categoryDescription(category)}`}>
      <span aria-hidden="true">{c.glyph}</span>
      <span className="sr-only">{categoryLabel(category)}</span>
    </span>
  );
}
