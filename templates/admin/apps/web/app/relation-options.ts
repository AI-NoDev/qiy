import type { ReactNode } from "react";

/**
 * Option merging for foreign-key selects.
 *
 * `useSelect` paginates the target resource, so the record currently selected in
 * an edit form may not be in the first page of options. The select still has to
 * render its label instead of a raw id, so the selected record is merged in
 * explicitly. Kept as a pure function so the generated test suite can cover the
 * behaviour without mounting React.
 */
export interface QiyRelationOption {
  value?: string | number;
  label?: ReactNode;
}

export function mergeRelationOptions(
  options: QiyRelationOption[] | undefined,
  currentId: string | undefined,
  currentLabel: string | undefined,
): QiyRelationOption[] {
  const merged = options ? [...options] : [];
  if (!currentId) return merged;
  const present = merged.some((option) => option.value !== undefined && String(option.value) === currentId);
  if (present) return merged;
  return [{ value: currentId, label: currentLabel || currentId }, ...merged];
}
