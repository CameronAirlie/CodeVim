import { describe, expect, it } from 'vitest';
import { parseMode } from '../../src/core/mode';
import { cursorToSelections } from '../../src/sync/selection';

const doc = ['hello world', 'second line', 'third'];
const sel = (p: Parameters<typeof cursorToSelections>[0]) => cursorToSelections(p, (l) => doc[l], doc.length);

describe('cursorToSelections', () => {
  it('normal mode is an empty selection at the cursor', () => {
    expect(sel({ buf: 1, line: 1, col: 3, mode: 'n' })).toEqual([{ anchor: { line: 1, character: 3 }, active: { line: 1, character: 3 } }]);
  });

  it('charwise visual includes the character under the cursor', () => {
    expect(sel({ buf: 1, line: 0, col: 4, mode: 'v', vline: 0, vcol: 0 })).toEqual([
      { anchor: { line: 0, character: 0 }, active: { line: 0, character: 5 } },
    ]);
  });

  it('backwards charwise visual includes the start character', () => {
    expect(sel({ buf: 1, line: 0, col: 0, mode: 'v', vline: 0, vcol: 4 })).toEqual([
      { anchor: { line: 0, character: 5 }, active: { line: 0, character: 0 } },
    ]);
  });

  it('linewise visual covers whole lines', () => {
    expect(sel({ buf: 1, line: 1, col: 2, mode: 'V', vline: 0, vcol: 7 })).toEqual([
      { anchor: { line: 0, character: 0 }, active: { line: 1, character: 11 } },
    ]);
  });

  it('blockwise visual yields one selection per line, cursor line first', () => {
    const result = sel({ buf: 1, line: 1, col: 2, mode: '\x16', vline: 0, vcol: 0, block: [[0, 0, 3], [1, 0, 3]] });
    expect(result.map((s) => s.anchor.line)).toEqual([1, 0]);
    expect(result[0]).toEqual({ anchor: { line: 1, character: 0 }, active: { line: 1, character: 3 } });
  });
});

describe('parseMode', () => {
  it.each([
    ['n', 'normal'],
    ['niI', 'normal'],
    ['no', 'operator'],
    ['nov', 'operator'],
    ['i', 'insert'],
    ['ic', 'insert'],
    ['R', 'replace'],
    ['v', 'visual'],
    ['V', 'visualLine'],
    ['\x16', 'visualBlock'],
    ['c', 'cmdline'],
    ['r?', 'cmdline'],
    ['t', 'terminal'],
    ['nt', 'normal'],
  ])('%j → %s', (raw, kind) => {
    expect(parseMode(raw).kind).toBe(kind);
  });
});
