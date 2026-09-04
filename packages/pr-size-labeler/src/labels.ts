/** Matches any label in the `size/*` family (e.g. `size/XS`, `size/M`, `size/XL`). */
const SIZE_LABEL_PATTERN = /^size\/(XS|S|M|L|XL)$/;

export interface LabelDiff {
  /** Existing `size/*` labels that should be removed (excludes `newLabel` itself, if present). */
  toRemove: string[];
  /** The size label that should be present on the PR after this diff is applied. */
  toAdd: string;
}

/**
 * Given the PR's current label names and the size label that should apply,
 * decides which existing `size/*` labels must be removed so that only one
 * size label is ever active, and confirms the label to add.
 *
 * If `newLabel` is already present, it is left in place (not included in
 * `toRemove`) and is still returned as `toAdd` so the caller can treat
 * "ensure this label is applied" uniformly, whether or not it already is.
 * Non-size labels (e.g. `bug`) are never touched.
 */
export function diffLabels(currentLabels: readonly string[], newLabel: string): LabelDiff {
  const toRemove = currentLabels.filter(
    (label) => SIZE_LABEL_PATTERN.test(label) && label !== newLabel,
  );
  return { toRemove, toAdd: newLabel };
}
