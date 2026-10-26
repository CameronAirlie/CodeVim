/** A range of whole lines, 0-based and inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * The lines hidden by collapsed folds, derived from an editor's visible ranges:
 * VS Code splits the viewport into one visible range per run of unfolded lines,
 * so every gap between two ranges is a collapsed fold (its header line stays visible).
 * Returns `[first, last]` pairs, sorted.
 */
export function hiddenLines(visible: readonly LineRange[]): [number, number][] {
  const sorted = [...visible].sort((a, b) => a.start - b.start);
  const hidden: [number, number][] = [];
  for (let i = 1; i < sorted.length; i++) {
    const first = sorted[i - 1].end + 1;
    const last = sorted[i].start - 1;
    if (first <= last) hidden.push([first, last]);
  }
  return hidden;
}
