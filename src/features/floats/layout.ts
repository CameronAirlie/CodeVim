import { FloatInfo } from '../../nvim/protocol';
import { GridModel } from '../surface/grid';

/** A colour either from the VS Code theme (by id) or a fixed RGB value. */
export type OverlayColor = { theme: string } | { rgb: string };

export interface OverlayRun {
  /** Screen row/column of the first cell. */
  row: number;
  col: number;
  text: string;
  zindex: number;
  fg?: OverlayColor;
  bg?: OverlayColor;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface OverlayOptions {
  /** 'vscode' maps the float's base colours onto the VS Code theme. */
  colors: 'vscode' | 'neovim';
  /** Screen position of Neovim's cursor when it is inside a float. */
  cursor?: { row: number; col: number };
}

interface CellStyle {
  fg: string;
  bg: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

const BOX_DRAWING = /^[─-╿]+$/;

function cellStyle(grid: GridModel, hl: number): CellStyle {
  const h = grid.highlights.get(hl) ?? {};
  let fg = h.fg ?? grid.defaults.fg;
  let bg = h.bg ?? grid.defaults.bg;
  if (h.reverse) [fg, bg] = [bg, fg];
  return { fg, bg, bold: h.bold, italic: h.italic, underline: h.underline || h.undercurl, strikethrough: h.strikethrough };
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  let best: string | undefined;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Cuts the floating windows out of Neovim's screen grid and turns them into
 * styled runs that can be drawn on top of the VS Code editor.
 *
 * With `colors: 'vscode'` each float's dominant background/foreground become the
 * theme's widget colours, other backgrounds (e.g. the selected telescope entry)
 * become the list selection colour, and border characters the widget border.
 * Accent colours (matches, icons…) keep Neovim's values.
 */
export function buildOverlay(grid: GridModel, floats: readonly FloatInfo[], opts: OverlayOptions): OverlayRun[] {
  const runs: OverlayRun[] = [];
  const sorted = [...floats].sort((a, b) => a.zindex - b.zindex);
  for (const f of sorted) {
    const rowStart = Math.max(0, f.row);
    const rowEnd = Math.min(grid.height, f.row + f.height);
    const colStart = Math.max(0, f.col);
    const colEnd = Math.min(grid.width, f.col + f.width);
    if (rowEnd <= rowStart || colEnd <= colStart) continue;

    const styles: CellStyle[][] = [];
    const bgs: string[] = [];
    const fgs: string[] = [];
    for (let r = rowStart; r < rowEnd; r++) {
      const row: CellStyle[] = [];
      for (let c = colStart; c < colEnd; c++) {
        const cell = grid.cells[r][c];
        const st = cellStyle(grid, cell.hl);
        row.push(st);
        bgs.push(st.bg);
        if (cell.text.trim() && !BOX_DRAWING.test(cell.text)) fgs.push(st.fg);
      }
      styles.push(row);
    }
    const baseBg = mostCommon(bgs);
    const baseFg = mostCommon(fgs) ?? grid.defaults.fg;

    const map = (st: CellStyle, text: string): { fg?: OverlayColor; bg?: OverlayColor } => {
      if (opts.colors === 'neovim') return { fg: { rgb: st.fg }, bg: { rgb: st.bg } };
      const selected = st.bg !== baseBg;
      const bg: OverlayColor = selected ? { theme: 'list.activeSelectionBackground' } : { theme: 'editorWidget.background' };
      let fg: OverlayColor;
      if (BOX_DRAWING.test(text)) fg = { theme: 'editorWidget.border' };
      else if (st.fg === baseFg || st.fg === st.bg) fg = selected ? { theme: 'list.activeSelectionForeground' } : { theme: 'editorWidget.foreground' };
      else fg = { rgb: st.fg };
      return { fg, bg };
    };

    for (let r = rowStart; r < rowEnd; r++) {
      let current: (OverlayRun & { key: string }) | undefined;
      for (let c = colStart; c < colEnd; c++) {
        const cell = grid.cells[r][c];
        if (cell.text === '') continue; // second half of a double-width character
        const st = styles[r - rowStart][c - colStart];
        const isCursor = opts.cursor?.row === r && opts.cursor.col === c;
        const colors = isCursor
          ? { fg: { theme: 'editor.background' } as OverlayColor, bg: { theme: 'editorCursor.foreground' } as OverlayColor }
          : map(st, cell.text);
        const key = isCursor ? `cursor${c}` : JSON.stringify([colors, st.bold, st.italic, st.underline, st.strikethrough]);
        if (current && current.key === key) {
          current.text += cell.text;
          continue;
        }
        if (current) runs.push(strip(current));
        current = {
          key,
          row: r,
          col: c,
          text: cell.text,
          zindex: f.zindex,
          ...colors,
          bold: st.bold,
          italic: st.italic,
          underline: st.underline,
          strikethrough: st.strikethrough,
        };
      }
      if (current) runs.push(strip(current));
    }
  }
  return runs;
}

function strip(run: OverlayRun & { key: string }): OverlayRun {
  const { key: _key, ...rest } = run;
  return rest;
}
