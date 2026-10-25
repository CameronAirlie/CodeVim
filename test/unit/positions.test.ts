import { describe, expect, it } from 'vitest';
import { byteToUtf16, charLengthAt, utf16ToByte } from '../../src/sync/positions';

const line = 'aé😀b'; // bytes: a=1 é=2 😀=4 b=1; utf16: a=1 é=1 😀=2 b=1

describe('column conversion', () => {
  it('converts bytes to UTF-16', () => {
    expect([0, 1, 3, 7, 8].map((b) => byteToUtf16(line, b))).toEqual([0, 1, 2, 4, 5]);
  });

  it('converts UTF-16 to bytes', () => {
    expect([0, 1, 2, 4, 5].map((c) => utf16ToByte(line, c))).toEqual([0, 1, 3, 7, 8]);
  });

  it('clamps and snaps to character starts', () => {
    expect(byteToUtf16(line, 100)).toBe(5);
    expect(byteToUtf16(line, 2)).toBe(1); // inside é
    expect(utf16ToByte(line, 100)).toBe(8);
  });

  it('measures characters', () => {
    expect(charLengthAt(line, 2)).toBe(2);
    expect(charLengthAt(line, 0)).toBe(1);
    expect(charLengthAt(line, 5)).toBe(0);
  });
});
