import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { Mode } from '../core/mode';
import { scopedLogger } from '../core/logger';
import { DocumentBinding } from '../sync/documentManager';
import { FeatureContext, FeatureDefinition } from './feature';
import { CTRL_KEYS, ctrlContextKey, textToNvimKeys } from './keys';

/**
 * Tracks one insert-mode session typed in VS Code, so it can be replayed into
 * Neovim on <Esc> and become repeatable with `.`.
 * Only simple, contiguous single-line typing (with backspace) qualifies.
 */
class InsertSession {
  private start: vscode.Position | undefined;
  private text = '';
  private valid = true;

  constructor(readonly binding: DocumentBinding) {}

  onChange(e: vscode.TextDocumentChangeEvent): void {
    // Events without content changes only report dirty-state changes.
    if (!this.valid || e.document !== this.binding.document || e.contentChanges.length === 0) return;
    if (e.contentChanges.length !== 1) {
      this.valid = false;
      return;
    }
    const c = e.contentChanges[0];
    if (!this.start) {
      if (c.rangeLength !== 0) {
        this.valid = false;
        return;
      }
      this.start = c.range.start;
    }
    const end = this.start.translate(0, this.text.length);
    if (c.rangeLength === 0 && c.range.start.isEqual(end) && !/[\r\n]/.test(c.text)) {
      this.text += c.text;
    } else if (c.text === '' && c.range.end.isEqual(end) && c.range.start.line === end.line && c.range.start.character >= this.start.character) {
      this.text = this.text.slice(0, c.range.start.character - this.start.character);
    } else {
      this.valid = false;
    }
  }

  replay(): { line: number; col16: number; text: string } | undefined {
    if (!this.valid || !this.start || this.text === '') return undefined;
    return { line: this.start.line, col16: this.start.character, text: this.text };
  }
}

class InputFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly log;
  private insertSession: InsertSession | undefined;
  private escapePending: { char: string; at: number } | undefined;
  private pendingRelease: (() => void) | undefined;
  /** Ctrl keys Neovim gives a meaning in the current mode (built in or mapped). */
  private nvimCtrlKeys: string[] = [];
  /** Last value set for each `codevim.ctrl.*` context key. */
  private readonly ctrlContext = new Map<string, boolean>();

  constructor(private readonly ctx: FeatureContext) {
    this.log = scopedLogger(ctx.logger, 'input');
    const d = this.disposables;
    const { session } = ctx;
    d.add(vscode.commands.registerCommand('type', (args: { text: string }) => this.onType(args)));
    d.add(vscode.commands.registerCommand('codevim.send', (key: string) => this.send(key)));
    d.add(vscode.commands.registerCommand('codevim.escape', () => this.escape()));
    d.add(session.mode.onDidChange((mode) => this.onModeChange(mode)));
    d.add(session.lua.on('mode', (p) => {
      this.nvimCtrlKeys = p.ctrl_keys ?? [];
      this.updateContext(session.mode.current);
    }));
    d.add(vscode.workspace.onDidChangeTextDocument((e) => this.insertSession?.onChange(e)));
    d.add(ctx.config.onDidChange(() => this.updateContext(session.mode.current)));
    d.add(session.onDidChangeWindow(() => this.updateContext(session.mode.current)));
    d.add(vscode.window.onDidChangeActiveTextEditor(() => this.updateContext(session.mode.current)));
    this.updateContext(session.mode.current);
  }

  /**
   * VS Code handles typing only in insert mode on a real document. Inside floats
   * (telescope prompt…) and plugin buffers every key goes to Neovim.
   */
  private get vscodeTypes(): boolean {
    return (
      this.ctx.session.mode.current.kind === 'insert' &&
      this.ctx.config.current.insertStrategy === 'vscode' &&
      !this.ctx.session.pluginFocused &&
      !this.activeBinding()?.isForeign
    );
  }

  private activeBinding(): DocumentBinding | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor ? this.ctx.documents.get(editor.document) : undefined;
  }

  private onType(args: { text: string }): Thenable<unknown> | void {
    if (!this.activeBinding()) {
      return vscode.commands.executeCommand('default:type', args);
    }
    if (this.vscodeTypes) {
      if (this.checkEscapeSequence(args.text)) {
        return vscode.commands.executeCommand('deleteLeft').then(() => this.escape());
      }
      return vscode.commands.executeCommand('default:type', args);
    }
    this.ctx.session.input(textToNvimKeys(args.text));
  }

  /** Implements `codevim.insert.escapeSequence` (e.g. "jk"). */
  private checkEscapeSequence(text: string): boolean {
    const seq = this.ctx.config.current.insertEscapeSequence;
    if (seq.length !== 2) return false;
    const now = Date.now();
    const pending = this.escapePending;
    this.escapePending = text === seq[0] ? { char: text, at: now } : undefined;
    return !!pending && text === seq[1] && now - pending.at <= this.ctx.config.current.insertEscapeTimeout;
  }

  /** Sends a special key (from a keybinding), syncing the VS Code cursor first if VS Code owned it. */
  private async send(key: string): Promise<void> {
    const binding = this.activeBinding();
    if (!binding) return;
    if (this.vscodeTypes) {
      // VS Code owns the typing: <C-c> leaves insert mode like <Esc>, syncing it first.
      if (key === '<C-c>') return this.escape();
      await this.pushCursor(binding);
    }
    this.ctx.session.input(key);
  }

  private async escape(): Promise<void> {
    const binding = this.activeBinding();
    const editor = vscode.window.activeTextEditor;
    if (!binding || !editor) return;
    const mode = this.ctx.session.mode.current;
    if (mode.kind === 'insert') {
      // Close VS Code's insert-mode widgets first, like <Esc> would in plain VS Code.
      void vscode.commands.executeCommand('hideSuggestWidget');
      void vscode.commands.executeCommand('closeParameterHints');
      void vscode.commands.executeCommand('leaveSnippet');
    }
    if (!this.vscodeTypes) {
      this.ctx.session.input('<Esc>');
      return;
    }
    await binding.whenSynced();
    const replay = this.ctx.config.current.dotRepeat ? this.insertSession?.replay() : undefined;
    const pos = editor.selection.active;
    this.log.debug(`escape at ${pos.line}:${pos.character}, replay ${JSON.stringify(replay)}`);
    this.insertSession = undefined;
    // Hold Neovim→VS Code sync while Neovim retypes the text, so the document
    // never flickers through the intermediate state.
    const release = replay ? binding.hold() : undefined;
    this.pendingRelease = release;
    this.ctx.session.lastInputAt = Date.now();
    try {
      await this.ctx.session.call('codevim.buffer', 'escape', [{ buf: binding.buf, line: pos.line, col16: pos.character, replay }]);
    } catch (err) {
      this.log.error(`escape failed: ${String(err)}`);
      release?.();
    }
  }

  private async pushCursor(binding: DocumentBinding): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== binding.document) return;
    await binding.whenSynced();
    const pos = editor.selection.active;
    this.ctx.session.callAsync('codevim.cursor', 'set_cursor', [binding.buf, pos.line, pos.character]);
  }

  private onModeChange(mode: Mode): void {
    if (mode.kind === 'insert') {
      const binding = this.activeBinding();
      this.insertSession = binding ? new InsertSession(binding) : undefined;
    } else {
      this.insertSession = undefined;
      if (this.pendingRelease) {
        // Release on the next tick so the replayed lines events are applied first.
        const release = this.pendingRelease;
        this.pendingRelease = undefined;
        setTimeout(release, 0);
      }
    }
    this.updateContext(mode);
  }

  private updateContext(mode: Mode): void {
    const cfg = this.ctx.config.current;
    const keys = this.ctx.session.pluginFocused
      ? cfg.ctrlKeys.plugin
      : mode.kind === 'cmdline'
        ? this.withNeovimKeys(cfg.ctrlKeys.cmdline, true)
        : mode.isInsertLike
          ? this.withNeovimKeys(cfg.ctrlKeys.insert, mode.kind === 'insert' && !this.vscodeTypes)
          : cfg.ctrlKeys.normal;
    const enabled = new Set(keys);
    for (const key of CTRL_KEYS) {
      const on = enabled.has(key);
      if (this.ctrlContext.get(key) !== on) {
        this.ctrlContext.set(key, on);
        void vscode.commands.executeCommand('setContext', ctrlContextKey(key), on);
      }
    }
    void vscode.commands.executeCommand('setContext', 'codevim.captureKeys', !this.vscodeTypes);
  }

  /**
   * Adds the Ctrl keys Neovim reported for this mode (built-in commands such as <C-r>,
   * and maps such as a completion menu's <C-y>), whatever the config uses. Not while
   * VS Code handles insert-mode typing: those keys keep their VS Code meaning.
   */
  private withNeovimKeys(keys: string[], neovimTypes: boolean): string[] {
    if (!neovimTypes || !this.ctx.config.current.ctrlKeys.fromNeovim) return keys;
    return [...new Set([...keys, ...this.nvimCtrlKeys])];
  }

  dispose(): void {
    this.disposables.dispose();
    void vscode.commands.executeCommand('setContext', 'codevim.captureKeys', false);
    for (const key of this.ctrlContext.keys()) {
      void vscode.commands.executeCommand('setContext', ctrlContextKey(key), false);
    }
  }
}

export const inputFeature: FeatureDefinition = {
  id: 'input',
  description: 'Routes typing and special keys to Neovim (or to VS Code in insert mode).',
  required: true,
  create: (ctx) => new InputFeature(ctx),
};
