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
  return mergeSelectedRelationOptions(options, currentId ? [{ id: currentId, label: currentLabel }] : []);
}

/** Multi-select variant: every selected record missing from the options page is prepended in selection order. */
export function mergeSelectedRelationOptions(
  options: QiyRelationOption[] | undefined,
  selected: ReadonlyArray<{ id: string; label?: string }>,
): QiyRelationOption[] {
  const merged = options ? [...options] : [];
  const present = new Set(merged.flatMap((option) => (option.value === undefined ? [] : [String(option.value)])));
  const missing = selected.filter((item) => item.id && !present.has(item.id)).map((item) => ({ value: item.id, label: item.label || item.id }));
  return [...missing, ...merged];
}
