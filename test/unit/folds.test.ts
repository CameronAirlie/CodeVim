import { describe, expect, it } from 'vitest';
import { hiddenLines } from '../../src/sync/folds';

describe('hiddenLines', () => {
  it('is empty without folds', () => {
    expect(hiddenLines([{ start: 0, end: 40 }])).toEqual([]);
    expect(hiddenLines([])).toEqual([]);
  });

  it('turns gaps between visible ranges into hidden lines', () => {
    // Fold header on line 3 hides 4..9; header on 12 hides 13..20.
    expect(
      hiddenLines([
        { start: 0, end: 3 },
        { start: 10, end: 12 },
        { start: 21, end: 30 },
      ]),
    ).toEqual([
      [4, 9],
      [13, 20],
    ]);
  });

  it('accepts unsorted ranges and ignores adjacent ones', () => {
    expect(
      hiddenLines([
        { start: 5, end: 9 },
        { start: 0, end: 4 },
        { start: 12, end: 14 },
      ]),
    ).toEqual([[10, 11]]);
  });
});
