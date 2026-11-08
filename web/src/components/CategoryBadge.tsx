import { CATEGORY_LABELS, type MoveCategory } from '../core/classification/classify';

export function CategoryBadge({ category, candidate }: { category?: MoveCategory; candidate?: boolean }) {
  if (candidate && category !== 'brilliant') {
    return (
      <span className="badge candidate" title="Brilliant candidate (not confirmed)">
        !?
        <span className="sr-only">Brilliant candidate</span>
      </span>
    );
  }
  if (!category) return null;
  const c = CATEGORY_LABELS[category];
  return (
    <span className={`badge ${category}`} title={`${c.label}: ${c.description}`}>
      <span aria-hidden="true">{c.glyph}</span>
      <span className="sr-only">{c.label}</span>
    </span>
  );
}
