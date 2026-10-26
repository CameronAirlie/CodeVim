import * as vscode from 'vscode';
import { DisposableStore, toDisposable } from '../core/disposable';
import { scopedLogger } from '../core/logger';
import { DocumentBinding } from '../sync/documentManager';
import { FeatureContext, FeatureDefinition } from './feature';

/**
 * Neovim's undo tree is the one history of a mirrored document:
 *  - `ctrl+z` / `ctrl+shift+z` / `ctrl+y` outside insert mode send `u` / `<C-r>`
 *    (keybindings in package.json, enabled by the `codevim.undo` context key).
 *  - An undo or redo that reaches the document another way (Edit menu, another
 *    extension) is not mirrored as an edit: Neovim undoes instead, and the document
 *    is made to match the buffer.
 * In insert mode VS Code's own undo applies to the text being typed.
 */
class UndoFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly log;

  constructor(private readonly ctx: FeatureContext) {
    this.log = scopedLogger(ctx.logger, 'undo');
    const d = this.disposables;
    d.add(vscode.commands.registerCommand('codevim.undo', () => this.sendKeys(false)));
    d.add(vscode.commands.registerCommand('codevim.redo', () => this.sendKeys(true)));
    d.add(ctx.documents.interceptChanges((binding, e) => this.intercept(binding, e)));
    void vscode.commands.executeCommand('setContext', 'codevim.undo', true);
    d.add(toDisposable(() => void vscode.commands.executeCommand('setContext', 'codevim.undo', false)));
  }

  private get neovimOwnsUndo(): boolean {
    const mode = this.ctx.session.mode.current;
    return !mode.isInsertLike && mode.kind !== 'cmdline';
  }

  private sendKeys(redo: boolean): Thenable<unknown> | void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.ctx.documents.get(editor.document) || !this.neovimOwnsUndo) {
      return vscode.commands.executeCommand(redo ? 'redo' : 'undo');
    }
    const keys = redo ? '<C-r>' : 'u';
    // In visual mode `u` would lowercase the selection.
    this.ctx.session.input(this.ctx.session.mode.current.isVisual ? `<Esc>${keys}` : keys);
  }

  private intercept(binding: DocumentBinding, e: vscode.TextDocumentChangeEvent): boolean {
    const redo = e.reason === vscode.TextDocumentChangeReason.Redo;
    if ((e.reason !== vscode.TextDocumentChangeReason.Undo && !redo) || binding.isForeign || !this.neovimOwnsUndo) {
      return false;
    }
    void this.undoInNeovim(binding, redo);
    return true;
  }

  private async undoInNeovim(binding: DocumentBinding, redo: boolean): Promise<void> {
    // Hold the document as VS Code left it until Neovim has undone, so it doesn't
    // flicker back to the pre-undo text in between.
    const release = binding.hold();
    try {
      await this.ctx.session.call('codevim.undo', 'run', [binding.buf, redo]);
    } catch (err) {
      this.log.error(`${redo ? 'redo' : 'undo'} failed: ${String(err)}`);
    } finally {
      // The buffer's line events arrive before the response; apply them, then make
      // the document match even if Neovim had nothing to undo.
      setTimeout(() => {
        binding.restoreFromNeovim();
        release();
      }, 0);
    }
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const undoFeature: FeatureDefinition = {
  id: 'undo',
  description: "Undo/redo go through Neovim's undo tree, from keys and from the Edit menu.",
  create: (ctx) => new UndoFeature(ctx),
};
