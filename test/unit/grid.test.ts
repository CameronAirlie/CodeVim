import { describe, expect, it } from 'vitest';
import { emptyCmdline, reduceCmdline } from '../../src/features/cmdlineState';
import { GridModel } from '../../src/features/surface/grid';
import { parseRedraw } from '../../src/nvim/redraw';

const row = (g: GridModel, r: number) => g.cells[r].map((c) => c.text).join('');

describe('GridModel', () => {
  it('applies grid_line with repeats and inherited highlights', () => {
    const g = new GridModel();
    const flushed = g.apply(
      parseRedraw([
        ['grid_resize', [1, 6, 2]],
        ['hl_attr_define', [3, { foreground: 0xff0000, bold: true }, {}, []]],
        ['grid_line', [1, 0, 0, [['a', 3], ['b'], [' ', 0, 4]], false]],
        ['flush', []],
      ]),
    );
    expect(flushed).toBe(true);
    expect(row(g, 0)).toBe('ab    ');
    expect(g.cells[0][1].hl).toBe(3);
    expect(g.rowRuns(0)).toEqual([
      ['ab', 3],
      ['    ', 0],
    ]);
    expect(g.highlights.get(3)).toMatchObject({ fg: '#ff0000', bold: true });
  });

  it('scrolls regions', () => {
    const g = new GridModel();
    g.apply(
      parseRedraw([
        ['grid_resize', [1, 2, 3]],
        ['grid_line', [1, 0, 0, [['a', 0, 2]], false], [1, 1, 0, [['b', 0, 2]], false], [1, 2, 0, [['c', 0, 2]], false]],
        ['grid_scroll', [1, 0, 3, 0, 2, 1, 0]],
      ]),
    );
    expect([row(g, 0), row(g, 1)]).toEqual(['bb', 'cc']);
    g.apply(parseRedraw([['grid_scroll', [1, 0, 3, 0, 2, -1, 0]]]));
    expect([row(g, 1), row(g, 2)]).toEqual(['bb', 'cc']);
  });

  it('tracks dirty rows', () => {
    const g = new GridModel();
    g.apply(parseRedraw([['grid_resize', [1, 2, 3]]]));
    expect(g.takeDirtyRows()).toEqual([0, 1, 2]);
    g.apply(parseRedraw([['grid_line', [1, 1, 0, [['x']], false]]]));
    expect(g.takeDirtyRows()).toEqual([1]);
  });
});

describe('reduceCmdline', () => {
  it('folds show/pos/hide and wildmenu items', () => {
    const s = emptyCmdline();
    reduceCmdline(s, parseRedraw([['cmdline_show', [[[0, 'édit']], 5, ':', '', 0, 1]]]));
    expect(s).toMatchObject({ visible: true, firstc: ':', content: 'édit', pos: 4 });
    reduceCmdline(s, parseRedraw([['popupmenu_show', [[['one', '', '', ''], ['two', '', '', '']], 1, 0, 0, -1]]]));
    expect(s.items).toEqual(['one', 'two']);
    expect(s.selected).toBe(1);
    reduceCmdline(s, parseRedraw([['cmdline_hide', [1]]]));
    expect(s.visible).toBe(false);
    expect(s.items).toEqual([]);
  });
});
