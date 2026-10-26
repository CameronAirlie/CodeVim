import * as vscode from 'vscode';
import { DisposableStore, toDisposable } from '../core/disposable';
import { FeatureContext, FeatureDefinition } from './feature';

/**
 * One jump history for both editors, kept by Neovim:
 *  - VS Code's Go Back / Go Forward keys run `<C-o>` / `<C-i>` in normal mode
 *    (keybindings in package.json, enabled by the `codevim.jumplist` context key).
 *  - Jumps made in VS Code (Go to Definition, Go to Line, outline, search results…)
 *    are added to Neovim's jumplist.
 * Switching editors is recorded by the navigation feature.
 */
class JumplistFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  /** Neovim's last reported cursor line per buffer: VS Code mirroring it is not a jump. */
  private readonly nvimLine = new Map<number, number>();
  /** Last known cursor per editor: where a jump starts from. */
  private readonly lastPos = new WeakMap<vscode.TextEditor, vscode.Position>();

  constructor(private readonly ctx: FeatureContext) {
    const { session } = ctx;
    const d = this.disposables;
    d.add(vscode.commands.registerCommand('codevim.jumpBack', () => this.jump('<C-o>', 'workbench.action.navigateBack')));
    d.add(vscode.commands.registerCommand('codevim.jumpForward', () => this.jump('<C-i>', 'workbench.action.navigateForward')));
    d.add(session.lua.on('cursor', (p) => this.nvimLine.set(p.buf, p.line)));
    d.add(session.lua.on('mode', (p) => p.cursor && this.nvimLine.set(p.cursor.buf, p.cursor.line)));
    d.add(vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e)));
    void vscode.commands.executeCommand('setContext', 'codevim.jumplist', true);
    d.add(toDisposable(() => void vscode.commands.executeCommand('setContext', 'codevim.jumplist', false)));
  }

  private jump(keys: string, fallback: string): Thenable<unknown> | void {
    const editor = vscode.window.activeTextEditor;
    const binding = editor && this.ctx.documents.get(editor.document);
    if (!binding || this.ctx.session.mode.current.kind !== 'normal') {
      return vscode.commands.executeCommand(fallback);
    }
    this.ctx.session.input(keys);
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    const editor = e.textEditor;
    const from = this.lastPos.get(editor);
    const to = e.selections[0].active;
    this.lastPos.set(editor, to);
    // Typing and clicking are not jumps (as in Vim); a new editor's first selection
    // has no origin, and editor switches are recorded elsewhere.
    if (!from || from.line === to.line || editor !== vscode.window.activeTextEditor) return;
    if (e.kind === vscode.TextEditorSelectionChangeKind.Keyboard || e.kind === vscode.TextEditorSelectionChangeKind.Mouse) return;
    const { session } = this.ctx;
    if (session.mode.current.kind !== 'normal' || session.pluginFocused) return;
    const binding = this.ctx.documents.get(editor.document);
    if (!binding || binding.isForeign || this.nvimLine.get(binding.buf) === to.line) return;
    session.callAsync('codevim.jumplist', 'record', [binding.buf, from.line, from.character, to.line, to.character]);
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const jumplistFeature: FeatureDefinition = {
  id: 'jumplist',
  description: "VS Code's Go Back/Forward use Neovim's jumplist, and VS Code jumps are added to it.",
  create: (ctx) => new JumplistFeature(ctx),
};
