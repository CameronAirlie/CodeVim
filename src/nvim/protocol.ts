/**
 * Payloads exchanged with the Lua runtime (runtime/lua/codevim/*.lua).
 * Keep these in sync with the Lua side; positions are 0-based.
 * Columns sent by Neovim are byte offsets, columns sent to Neovim are UTF-16.
 */

export interface CursorPayload {
  buf: number;
  line: number;
  col: number;
  mode: string;
  /** Visual-mode start ('v' mark). */
  vline?: number;
  vcol?: number;
  /** Blockwise visual: [line, startByte, endByteExclusive] per line. */
  block?: [number, number, number][];
}

export interface ModePayload {
  mode: string;
  old: string;
  internal: boolean;
  cursor?: CursorPayload;
}

export type BufferKind = 'bound' | 'file' | 'scratch' | 'special' | 'ignored';

export interface FloatInfo {
  win: number;
  buf: number;
  focusable: boolean;
  zindex: number;
  /** Screen rectangle including the border (0-based cells). */
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface WindowPayload {
  win: number;
  buf: number;
  kind: BufferKind;
  uri?: string;
  name: string;
  buftype: string;
  filetype: string;
  modifiable: boolean;
  is_float: boolean;
  floats: FloatInfo[];
  /** Number of non-floating windows in the tabpage. */
  windows: number;
  number: boolean;
  relativenumber: boolean;
  /** Screen lines that are not part of the main window (statusline, cmdline…). */
  overhead: number;
  /** The change was caused by the extension itself. */
  internal: boolean;
}

export interface ViewportPayload {
  win: number;
  buf: number;
  top: number;
  bot: number;
}

export interface HlsearchPayload {
  buf: number;
  /** [line, startByte, endByte] */
  matches: [number, number, number][];
  /** Current incsearch match start [line, byte]. */
  current?: [number, number];
}

export interface CommandPayload {
  name: string;
  args?: unknown[];
  /** [line1, line2] or [l1, c1, l2, c2], 0-based. */
  range?: number[];
  restore_selection?: boolean;
  callback?: number;
  timeout?: number;
}

export interface EvalPayload {
  code: string;
  args?: unknown;
  callback?: number;
  timeout?: number;
}

/** Notifications sent by the runtime: rpcnotify(chan, "codevim", name, payload). */
export interface LuaEvents {
  ready: Record<string, never>;
  mode: ModePayload;
  cursor: CursorPayload;
  window: WindowPayload;
  viewport: ViewportPayload;
  hlsearch: HlsearchPayload;
  action: CommandPayload;
  eval_async: EvalPayload;
  notify: { msg: string; level: number };
  clipboard_set: { lines: string[]; regtype: string };
  update_config: { name: string; value: unknown; target: 'global' | 'workspace' };
  quit: { bang: boolean; all: boolean; uri?: string; foreign?: boolean };
  split: { direction: 'down' | 'right'; file?: string; new: boolean };
  buf_deleted: { buf: number; uri: string };
}

/** Requests sent by the runtime: rpcrequest(chan, "codevim_request", method, payload). */
export interface LuaRequests {
  save: { params: { buf: number; uri: string }; result: boolean };
  call: { params: CommandPayload; result: unknown };
  eval: { params: EvalPayload; result: unknown };
  clipboard_get: { params: Record<string, never>; result: { lines: string[]; regtype: string } };
  get_config: { params: { name: string }; result: unknown };
  has_config: { params: { name: string }; result: boolean };
}

/** Options passed to `require('codevim').setup()`. */
export interface RuntimeSetupOptions {
  vscode_global: boolean;
  clipboard: boolean;
  notify: boolean;
  window_keymaps: boolean;
  command_abbreviations: boolean;
}

export interface BufLinesEvent {
  buf: number;
  changedtick: number;
  first: number;
  /** Exclusive; -1 means "to the end" (initial full-buffer event). */
  last: number;
  lines: string[];
  more: boolean;
}
