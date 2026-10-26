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
  /** Opaque colour under `bg`, which may be translucent (theme selection colours). */
  baseBg?: OverlayColor;
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
  /** The float Neovim's focus is in, if any (decides which VS Code widget it looks like). */
  focusedWin?: number;
  /**
   * Neovim's Normal group has no foreground/background (a transparent colorscheme).
   * The default colours are then stand-ins (black/white), so cells using them take
   * the VS Code editor's colours instead.
   */
  transparent?: { fg: boolean; bg: boolean };
}

interface CellStyle {
  fg: string;
  bg: string;
  /** The colour is the default one (no colour of its own). */
  defaultFg?: boolean;
  defaultBg?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

const BOX_DRAWING = /^[─-╿]+$/;

/** Theme colours of the VS Code widget a float is drawn as. All have built-in defaults. */
interface Palette {
  bg: string;
  fg: string;
  border: string;
  selectedBg: string;
  selectedFg: string;
}

const PALETTES = {
  // A float you are in (telescope, lazy…): like Quick Open.
  picker: {
    bg: 'quickInput.background',
    fg: 'quickInput.foreground',
    border: 'editorWidget.border',
    selectedBg: 'quickInputList.focusBackground',
    selectedFg: 'quickInputList.focusForeground',
  },
  // A short float you are in (a picker's prompt): like Quick Open's input box.
  input: {
    bg: 'input.background',
    fg: 'input.foreground',
    border: 'editorWidget.border',
    selectedBg: 'quickInputList.focusBackground',
    selectedFg: 'quickInputList.focusForeground',
  },
  // Floats shown while you keep typing (completion, which-key, hover…): like IntelliSense.
  popup: {
    bg: 'editorSuggestWidget.background',
    fg: 'editorSuggestWidget.foreground',
    // Not editorSuggestWidget.border: themes often make it near-black, and Neovim
    // draws every float's border alike.
    border: 'editorWidget.border',
    selectedBg: 'editorSuggestWidget.selectedBackground',
    selectedFg: 'list.activeSelectionForeground',
  },
} satisfies Record<string, Palette>;

/** Inner height (border included) up to which a focused float counts as an input line. */
const INPUT_MAX_HEIGHT = 3;

function paletteFor(f: FloatInfo, focusedWin: number | undefined): Palette {
  if (focusedWin === undefined) return PALETTES.popup;
  return f.win === focusedWin && f.height <= INPUT_MAX_HEIGHT ? PALETTES.input : PALETTES.picker;
}

function cellStyle(grid: GridModel, hl: number): CellStyle {
  const h = grid.highlights.get(hl) ?? {};
  let fg = h.fg ?? grid.defaults.fg;
  let bg = h.bg ?? grid.defaults.bg;
  let defaultFg = h.fg === undefined;
  let defaultBg = h.bg === undefined;
  if (h.reverse) {
    [fg, bg] = [bg, fg];
    [defaultFg, defaultBg] = [defaultBg, defaultFg];
  }
  return { fg, bg, defaultFg, defaultBg, bold: h.bold, italic: h.italic, underline: h.underline || h.undercurl, strikethrough: h.strikethrough };
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

    const palette = paletteFor(f, opts.focusedWin);
    const map = (st: CellStyle, text: string): { fg?: OverlayColor; bg?: OverlayColor; baseBg?: OverlayColor } => {
      if (opts.colors === 'neovim') {
        return {
          fg: st.defaultFg && opts.transparent?.fg ? { theme: 'editor.foreground' } : { rgb: st.fg },
          bg: st.defaultBg && opts.transparent?.bg ? { theme: 'editor.background' } : { rgb: st.bg },
          baseBg: { theme: 'editor.background' },
        };
      }
      const selected = st.bg !== baseBg;
      const bg: OverlayColor = { theme: selected ? palette.selectedBg : palette.bg };
      let fg: OverlayColor;
      if (BOX_DRAWING.test(text)) fg = { theme: palette.border };
      else if (st.fg === baseFg || st.fg === st.bg) fg = { theme: selected ? palette.selectedFg : palette.fg };
      else fg = { rgb: st.fg };
      return { fg, bg, baseBg: { theme: palette.bg } };
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
