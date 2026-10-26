import { chunksToText, RedrawEvent } from '../nvim/redraw';
import { byteToUtf16 } from '../sync/positions';

/** Command-line state folded from ext_cmdline / ext_popupmenu redraw events (pure, testable). */
export interface CmdlineState {
  visible: boolean;
  firstc: string;
  prompt: string;
  indent: number;
  content: string;
  /** Cursor position as UTF-16 offset into `content`. */
  pos: number;
  /** Wildmenu / completion items, if any. */
  items: string[];
  selected: number;
}

export function emptyCmdline(): CmdlineState {
  return { visible: false, firstc: '', prompt: '', indent: 0, content: '', pos: 0, items: [], selected: -1 };
}

/** Folds cmdline/popupmenu redraw events into a {@link CmdlineState}. Returns true if it changed. */
export function reduceCmdline(state: CmdlineState, events: RedrawEvent[]): boolean {
  let changed = false;
  for (const { name, args } of events) {
    switch (name) {
      case 'cmdline_show': {
        const [content, pos, firstc, prompt, indent] = args as [unknown, number, string, string, number];
        state.visible = true;
        state.content = chunksToText(content);
        state.pos = byteToUtf16(state.content, pos);
        state.firstc = firstc;
        state.prompt = prompt;
        state.indent = indent;
        changed = true;
        break;
      }
      case 'cmdline_pos':
        state.pos = byteToUtf16(state.content, args[0] as number);
        changed = true;
        break;
      case 'cmdline_special_char': {
        const [c, shift] = args as [string, boolean];
        state.content = shift
          ? state.content.slice(0, state.pos) + c + state.content.slice(state.pos)
          : state.content.slice(0, state.pos) + c + state.content.slice(state.pos + 1);
        changed = true;
        break;
      }
      case 'cmdline_hide':
        Object.assign(state, emptyCmdline());
        changed = true;
        break;
      case 'popupmenu_show': {
        const [items, selected, , , grid] = args as [unknown[][], number, number, number, number];
        if (grid === -1) {
          state.items = items.map((i) => String(i[0]));
          state.selected = selected;
          changed = true;
        }
        break;
      }
      case 'popupmenu_select':
        if (state.items.length > 0) {
          state.selected = args[0] as number;
          changed = true;
        }
        break;
      case 'popupmenu_hide':
        if (state.items.length > 0) {
          state.items = [];
          state.selected = -1;
          changed = true;
        }
        break;
    }
  }
  return changed;
}

/** One-line rendering of the command line: prompt, text with a `▏` cursor, then the wildmenu. */
export function formatCmdline(s: CmdlineState): string {
  const before = s.content.slice(0, s.pos);
  const after = s.content.slice(s.pos);
  let text = `${s.firstc}${s.prompt}${' '.repeat(s.indent)}${before}▏${after}`;
  if (s.items.length > 0) {
    const start = Math.max(0, Math.min(s.selected - 3, s.items.length - 8));
    const shown = s.items.slice(start, start + 8).map((it, i) => (start + i === s.selected ? `[${it}]` : it));
    text += `   ${start > 0 ? '… ' : ''}${shown.join(' ')}${start + 8 < s.items.length ? ' …' : ''}`;
  }
  return text;
}
