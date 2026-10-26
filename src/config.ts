import * as vscode from 'vscode';
import { Disposable } from './core/disposable';
import { Emitter } from './core/events';

export type InsertStrategy = 'vscode' | 'neovim';
export type CursorStyleName = 'block' | 'block-outline' | 'line' | 'line-thin' | 'underline' | 'underline-thin';
export type UnfocusedFloats = 'none' | 'focusable' | 'all';
export type FloatDisplay = 'overlay' | 'surface' | 'none';
export type PluginBufferDisplay = 'editor' | 'surface';
export type StatuslinePosition = 'editor' | 'statusBar';
export type StatuslineModeGroup = 'normal' | 'insert' | 'visual' | 'replace' | 'operator' | 'cmdline' | 'terminal';

export interface FeatureToggles {
  [id: string]: boolean;
}

export interface CodeVimConfig {
  neovimPath: string;
  neovimArgs: string[];
  neovimAppName: string;
  setVscodeGlobal: boolean;
  documentSchemes: string[];
  features: FeatureToggles;
  insertStrategy: InsertStrategy;
  insertEscapeSequence: string;
  insertEscapeTimeout: number;
  dotRepeat: boolean;
  ctrlKeys: { normal: string[]; insert: string[]; cmdline: string[]; plugin: string[] };
  floats: { display: FloatDisplay; colors: 'vscode' | 'neovim' };
  pluginBuffers: { display: PluginBufferDisplay; viewColumn: 'auto' | 'active' | 'beside' };
  useVscodeClipboard: boolean;
  routeVimNotify: boolean;
  windowKeymaps: boolean;
  commandAbbreviations: boolean;
  errorsAsNotifications: boolean;
  syncScroll: boolean;
  syncIndentOptions: boolean;
  uiWidth: number;
  statusline: { position: StatuslinePosition; colors: Record<StatuslineModeGroup, string> };
  cursorStyle: Record<'normal' | 'insert' | 'visual' | 'replace' | 'operator' | 'cmdline', CursorStyleName>;
  surface: {
    viewColumn: 'active' | 'beside';
    unfocusedFloats: UnfocusedFloats;
    fontFamily: string;
    fontSize: number;
    passthroughKeys: string[];
  };
}

/** Theme colour ids (or `#rrggbb`) for the in-editor statusline, per mode. */
export const DEFAULT_STATUSLINE_COLORS: Record<StatuslineModeGroup, string> = {
  normal: 'terminal.ansiBlue',
  insert: 'terminal.ansiGreen',
  visual: 'terminal.ansiMagenta',
  replace: 'terminal.ansiRed',
  operator: 'terminal.ansiCyan',
  cmdline: 'terminal.ansiYellow',
  terminal: 'terminal.ansiGreen',
};

function read(): CodeVimConfig {
  const c = vscode.workspace.getConfiguration('codevim');
  return {
    neovimPath: c.get('neovimPath', 'nvim') || 'nvim',
    neovimArgs: c.get('neovimArgs', []),
    neovimAppName: c.get('neovimAppName', ''),
    setVscodeGlobal: c.get('setVscodeGlobal', true),
    documentSchemes: c.get('documentSchemes', ['file', 'untitled', 'vscode-userdata', 'vscode-remote']),
    features: c.get('features', {}),
    insertStrategy: c.get('insert.strategy', 'vscode'),
    insertEscapeSequence: c.get('insert.escapeSequence', ''),
    insertEscapeTimeout: c.get('insert.escapeSequenceTimeout', 300),
    dotRepeat: c.get('insert.dotRepeat', true),
    ctrlKeys: {
      normal: c.get('ctrlKeys.normal', []),
      insert: c.get('ctrlKeys.insert', []),
      cmdline: c.get('ctrlKeys.cmdline', []),
      plugin: c.get('ctrlKeys.plugin', []),
    },
    floats: {
      display: c.get('floats.display', 'overlay'),
      colors: c.get('floats.colors', 'vscode'),
    },
    pluginBuffers: {
      display: c.get('pluginBuffers.display', 'editor'),
      viewColumn: c.get('pluginBuffers.viewColumn', 'auto'),
    },
    useVscodeClipboard: c.get('clipboard.useVscode', true),
    routeVimNotify: c.get('notifications.routeVimNotify', true),
    windowKeymaps: c.get('navigation.windowKeymaps', true),
    commandAbbreviations: c.get('navigation.commandAbbreviations', true),
    errorsAsNotifications: c.get('messages.errorsAsNotifications', false),
    syncScroll: c.get('viewport.syncScroll', true),
    syncIndentOptions: c.get('syncIndentOptions', true),
    uiWidth: c.get('uiWidth', 120),
    statusline: {
      position: c.get('statusline.position', 'editor'),
      colors: { ...DEFAULT_STATUSLINE_COLORS, ...c.get<Partial<Record<StatuslineModeGroup, string>>>('statusline.colors', {}) },
    },
    cursorStyle: {
      normal: c.get('cursorStyle.normal', 'block'),
      insert: c.get('cursorStyle.insert', 'line'),
      visual: c.get('cursorStyle.visual', 'line-thin'),
      replace: c.get('cursorStyle.replace', 'underline'),
      operator: c.get('cursorStyle.operator', 'underline'),
      cmdline: c.get('cursorStyle.cmdline', 'block-outline'),
    },
    surface: {
      viewColumn: c.get('surface.viewColumn', 'active'),
      unfocusedFloats: c.get('surface.unfocusedFloats', 'focusable'),
      fontFamily: c.get('surface.fontFamily', ''),
      fontSize: c.get('surface.fontSize', 0),
      passthroughKeys: c.get('surface.passthroughKeys', []),
    },
  };
}

/** Typed, cached access to the `codevim.*` settings. */
export class ConfigService implements Disposable {
  private value = read();
  private readonly changed = new Emitter<CodeVimConfig>();
  readonly onDidChange = this.changed.event;
  private readonly sub: vscode.Disposable;

  constructor() {
    this.sub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codevim')) {
        this.value = read();
        this.changed.fire(this.value);
      }
    });
  }

  get current(): CodeVimConfig {
    return this.value;
  }

  isFeatureEnabled(id: string, defaultValue = true): boolean {
    return this.value.features[id] ?? defaultValue;
  }

  /** The in-editor statusline replaces the mode, command line and message status bar items. */
  get statuslineInEditor(): boolean {
    return this.value.statusline.position === 'editor' && this.isFeatureEnabled('statusline');
  }

  dispose(): void {
    this.sub.dispose();
    this.changed.dispose();
  }
}
