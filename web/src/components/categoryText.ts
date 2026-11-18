import type { MoveCategory } from '../core/classification/classify';
import { t } from '../i18n';

/** Category name and description in the current language (CATEGORY_LABELS stays English for exports). */
export const categoryLabel = (c: MoveCategory): string => t(`category.${c}`);
export const categoryDescription = (c: MoveCategory): string => t(`category.${c}.description`);
