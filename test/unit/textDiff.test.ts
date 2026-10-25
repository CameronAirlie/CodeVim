import { describe, expect, it } from 'vitest';
import { applyLinesEvent, arraySource, computeEdit, TextEdit } from '../../src/sync/textDiff';

/** Applies an edit to a list of lines the way VS Code would. */
function applyEdit(lines: string[], e: TextEdit): string[] {
  const text = lines.join('\n');
  const offset = (p: { line: number; character: number }) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return (text.slice(0, offset(e.start)) + e.text + text.slice(offset(e.end))).split('\n');
}

const cases: [string, string[], string[]][] = [
  ['identical', ['a', 'b'], ['a', 'b']],
  ['char insert', ['hello'], ['helXlo']],
  ['char delete', ['hello world'], ['hello']],
  ['line insert middle', ['a', 'c'], ['a', 'b', 'c']],
  ['line insert end', ['a'], ['a', 'b', 'c']],
  ['line insert start', ['b'], ['a', 'b']],
  ['line delete middle', ['a', 'b', 'c'], ['a', 'c']],
  ['line delete last', ['a', 'b', 'c'], ['a', 'b']],
  ['line delete first', ['a', 'b'], ['b']],
  ['delete all but one', ['a', 'b', 'c'], ['']],
  ['replace all', ['x', 'y'], ['p', 'q', 'r']],
  ['join lines', ['foo', 'bar'], ['foo bar']],
  ['split line', ['foo bar'], ['foo', 'bar']],
  ['repeated lines', ['a', 'a', 'a'], ['a', 'a']],
  ['emoji change', ['x😀y'], ['x😁y']],
  ['empty doc', [''], ['text']],
];

describe('computeEdit', () => {
  it.each(cases)('%s', (_name, before, after) => {
    const edit = computeEdit(arraySource(before), after);
    if (before.join('\n') === after.join('\n')) {
      expect(edit).toBeUndefined();
      return;
    }
    expect(edit).toBeDefined();
    expect(applyEdit(before, edit!)).toEqual(after);
  });

  it('keeps single-character edits minimal', () => {
    expect(computeEdit(arraySource(['hello']), ['helXlo'])).toEqual({
      start: { line: 0, character: 3 },
      end: { line: 0, character: 3 },
      text: 'X',
    });
  });

  it('never splits a surrogate pair', () => {
    const edit = computeEdit(arraySource(['😀']), ['😁'])!;
    expect(edit.start.character).toBe(0);
    expect(edit.text).toBe('😁');
  });
});

describe('applyLinesEvent', () => {
  it('replaces ranges and handles -1 as end', () => {
    const lines = ['a', 'b', 'c'];
    applyLinesEvent(lines, 1, 2, ['B', 'B2']);
    expect(lines).toEqual(['a', 'B', 'B2', 'c']);
    applyLinesEvent(lines, 0, -1, ['z']);
    expect(lines).toEqual(['z']);
  });

  it('handles very large events', () => {
    const big = Array.from({ length: 50000 }, (_, i) => String(i));
    const lines = ['head', 'tail'];
    applyLinesEvent(lines, 1, 1, big);
    expect(lines.length).toBe(50002);
    expect(lines[50001]).toBe('tail');
  });
});
