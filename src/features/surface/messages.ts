import type { CmdlineState } from '../cmdlineState';
import type { CursorShape, HlStyle, Run } from './grid';

/** Messages from the extension to the surface webview. */
export type ToWebview =
  | {
      type: 'frame';
      width: number;
      height: number;
      /** Full reset: replace all rows/highlights. */
      reset: boolean;
      rows: { row: number; runs: Run[] }[];
      highlights: Record<number, HlStyle>;
      defaults: { fg: string; bg: string; sp: string };
      cursor: { row: number; col: number };
      cursorShape: CursorShape;
    }
  | { type: 'cmdline'; state: CmdlineState }
  | { type: 'focus' };

/** Messages from the surface webview to the extension. */
export type FromWebview =
  | { type: 'ready' }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'input'; keys: string }
  | { type: 'mouse'; button: string; action: string; modifier: string; row: number; col: number };
