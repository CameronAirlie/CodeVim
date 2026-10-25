import { RedrawEvent, rgbToHex } from '../../nvim/redraw';

export interface Cell {
  text: string;
  hl: number;
}

export interface HlStyle {
  fg?: string;
  bg?: string;
  sp?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  undercurl?: boolean;
  strikethrough?: boolean;
  reverse?: boolean;
}

export interface CursorShape {
  shape: 'block' | 'horizontal' | 'vertical';
  percentage: number;
}

/** A run of cells sharing one highlight: [text, hlId]. */
export type Run = [string, number];

/**
 * Model of Neovim's screen (ext_linegrid, single grid). Fed with redraw events;
 * tracks which rows changed since the last {@link takeDirtyRows}.
 */
export class GridModel {
  width = 0;
  height = 0;
  cells: Cell[][] = [];
  cursor = { row: 0, col: 0 };
  defaults = { fg: '#d4d4d4', bg: '#1e1e1e', sp: '#ff0000' };
  readonly highlights = new Map<number, HlStyle>();
  private modeInfo: CursorShape[] = [];
  cursorShape: CursorShape = { shape: 'block', percentage: 100 };
  private dirty = new Set<number>();
  private hlDirty = new Set<number>();
  private allDirty = true;

  /** Applies events; returns true when a `flush` was seen (time to render). */
  apply(events: RedrawEvent[]): boolean {
    let flushed = false;
    for (const { name, args } of events) {
      switch (name) {
        case 'grid_resize':
          this.resize(args[1] as number, args[2] as number);
          break;
        case 'grid_clear':
          this.clear();
          break;
        case 'grid_line':
          this.line(args[1] as number, args[2] as number, args[3] as unknown[][]);
          break;
        case 'grid_scroll':
          this.scroll(...(args.slice(1, 6) as [number, number, number, number, number]));
          break;
        case 'grid_cursor_goto':
          this.cursor = { row: args[1] as number, col: args[2] as number };
          break;
        case 'default_colors_set': {
          const [fg, bg, sp] = args as number[];
          this.defaults = {
            fg: rgbToHex(fg) ?? this.defaults.fg,
            bg: rgbToHex(bg) ?? this.defaults.bg,
            sp: rgbToHex(sp) ?? this.defaults.sp,
          };
          this.allDirty = true;
          break;
        }
        case 'hl_attr_define':
          this.defineHl(args[0] as number, args[1] as Record<string, unknown>);
          break;
        case 'mode_info_set':
          this.modeInfo = (args[1] as Record<string, unknown>[]).map((m) => ({
            shape: (m.cursor_shape as CursorShape['shape']) ?? 'block',
            percentage: (m.cell_percentage as number) || 100,
          }));
          break;
        case 'mode_change':
          this.cursorShape = this.modeInfo[args[1] as number] ?? { shape: 'block', percentage: 100 };
          break;
        case 'flush':
          flushed = true;
          break;
      }
    }
    return flushed;
  }

  resize(width: number, height: number): void {
    const old = this.cells;
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => old[r]?.[c] ?? { text: ' ', hl: 0 }),
    );
    this.allDirty = true;
  }

  clear(): void {
    for (const row of this.cells) {
      for (let c = 0; c < row.length; c++) row[c] = { text: ' ', hl: 0 };
    }
    this.allDirty = true;
  }

  private line(row: number, colStart: number, cells: unknown[][]): void {
    const target = this.cells[row];
    if (!target) return;
    let col = colStart;
    let hl = 0;
    for (const cell of cells) {
      const text = cell[0] as string;
      if (cell.length > 1 && cell[1] !== undefined) hl = cell[1] as number;
      const repeat = (cell[2] as number | undefined) ?? 1;
      for (let i = 0; i < repeat && col < this.width; i++) {
        target[col++] = { text, hl };
      }
    }
    this.dirty.add(row);
  }

  private scroll(top: number, bot: number, left: number, right: number, rows: number): void {
    const copyRow = (from: number, to: number) => {
      for (let c = left; c < right; c++) this.cells[to][c] = this.cells[from][c];
      this.dirty.add(to);
    };
    if (rows > 0) {
      for (let r = top; r < bot - rows; r++) copyRow(r + rows, r);
    } else {
      for (let r = bot - 1; r >= top - rows; r--) copyRow(r + rows, r);
    }
  }

  private defineHl(id: number, rgb: Record<string, unknown>): void {
    this.highlights.set(id, {
      fg: rgbToHex(rgb.foreground as number | undefined),
      bg: rgbToHex(rgb.background as number | undefined),
      sp: rgbToHex(rgb.special as number | undefined),
      bold: rgb.bold === true || undefined,
      italic: rgb.italic === true || undefined,
      underline: rgb.underline === true || undefined,
      undercurl: rgb.undercurl === true || undefined,
      strikethrough: rgb.strikethrough === true || undefined,
      reverse: rgb.reverse === true || undefined,
    });
    this.hlDirty.add(id);
  }

  /** Row → runs, grouping consecutive cells with the same highlight. */
  rowRuns(row: number): Run[] {
    const runs: Run[] = [];
    for (const cell of this.cells[row] ?? []) {
      const last = runs[runs.length - 1];
      if (last && last[1] === cell.hl) last[0] += cell.text;
      else runs.push([cell.text, cell.hl]);
    }
    return runs;
  }

  takeDirtyRows(): number[] {
    const rows = this.allDirty ? Array.from({ length: this.height }, (_, i) => i) : [...this.dirty];
    this.dirty.clear();
    this.allDirty = false;
    return rows;
  }

  takeDirtyHighlights(): Record<number, HlStyle> {
    const out: Record<number, HlStyle> = {};
    for (const id of this.hlDirty) out[id] = this.highlights.get(id)!;
    this.hlDirty.clear();
    return out;
  }

  allHighlights(): Record<number, HlStyle> {
    return Object.fromEntries(this.highlights);
  }

  markAllDirty(): void {
    this.allDirty = true;
  }
}
