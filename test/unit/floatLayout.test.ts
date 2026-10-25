import { describe, expect, it } from 'vitest';
import { buildOverlay } from '../../src/features/floats/layout';
import { GridModel } from '../../src/features/surface/grid';
import { FloatInfo } from '../../src/nvim/protocol';
import { parseRedraw } from '../../src/nvim/redraw';

// 10x4 screen; a 6x3 float at (1,2) with a border, a normal-bg body and one
// highlighted (selected) entry.
function screen(): GridModel {
  const g = new GridModel();
  g.apply(
    parseRedraw([
      ['default_colors_set', [0xffffff, 0x000000, 0xff0000, 0, 0]],
      ['hl_attr_define', [1, { background: 0x222222, foreground: 0xdddddd }, {}, []], [2, { background: 0x444444, foreground: 0xdddddd }, {}, []], [3, { background: 0x222222, foreground: 0xff8800 }, {}, []]],
      ['grid_resize', [1, 10, 4]],
      [
        'grid_line',
        [1, 0, 0, [['x', 0, 10]], false],
        [1, 1, 2, [['╭', 1], ['─', 1, 4], ['╮', 1]], false],
        [1, 2, 2, [['│', 1], ['a', 3], ['b', 1], [' ', 1, 2], ['│', 1]], false],
        [1, 3, 2, [['│', 1], ['s', 2], ['e', 2], ['l', 2], [' ', 2], ['│', 1]], false],
      ],
    ]),
  );
  return g;
}

const float: FloatInfo = { win: 1000, buf: 2, focusable: true, zindex: 50, row: 1, col: 2, width: 6, height: 3 };

describe('buildOverlay', () => {
  it('cuts only the float rectangle out of the screen', () => {
    const runs = buildOverlay(screen(), [float], { colors: 'neovim' });
    expect(runs.every((r) => r.row >= 1 && r.row <= 3 && r.col >= 2 && r.col + [...r.text].length <= 8)).toBe(true);
    expect(runs.find((r) => r.row === 1)).toMatchObject({ col: 2, text: '╭────╮' });
    expect(runs.map((r) => r.text).join('')).not.toContain('x');
  });

  it('maps base, selection, border and accent colours onto the theme', () => {
    const runs = buildOverlay(screen(), [float], { colors: 'vscode' });
    const at = (row: number, text: string) => runs.find((r) => r.row === row && r.text.includes(text))!;
    expect(at(1, '╭')).toMatchObject({ fg: { theme: 'editorWidget.border' }, bg: { theme: 'editorWidget.background' } });
    expect(at(2, 'a')).toMatchObject({ fg: { rgb: '#ff8800' }, bg: { theme: 'editorWidget.background' } });
    expect(at(2, 'b')).toMatchObject({ fg: { theme: 'editorWidget.foreground' } });
    expect(at(3, 'sel')).toMatchObject({ fg: { theme: 'list.activeSelectionForeground' }, bg: { theme: 'list.activeSelectionBackground' } });
  });

  it('draws the cursor as its own cell', () => {
    const runs = buildOverlay(screen(), [float], { colors: 'vscode', cursor: { row: 2, col: 4 } });
    expect(runs.find((r) => r.row === 2 && r.col === 4)).toMatchObject({ text: 'b', bg: { theme: 'editorCursor.foreground' } });
  });

  it('clips floats that extend past the screen', () => {
    const runs = buildOverlay(screen(), [{ ...float, col: 8, width: 10 }], { colors: 'neovim' });
    expect(Math.max(...runs.map((r) => r.col + [...r.text].length))).toBeLessThanOrEqual(10);
  });
});
