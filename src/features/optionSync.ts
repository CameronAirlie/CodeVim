import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { WindowPayload } from '../nvim/protocol';
import { FeatureContext, FeatureDefinition } from './feature';

/** Mirrors Neovim window options onto the editor ('number' / 'relativenumber'). */
class OptionSyncFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private last: WindowPayload | undefined;

  constructor(private readonly ctx: FeatureContext) {
    this.disposables.add(ctx.session.lua.on('window', (p) => {
      if (!p.is_float) {
        this.last = p;
        this.apply();
      }
    }));
    this.disposables.add(vscode.window.onDidChangeActiveTextEditor(() => this.apply()));
  }

  private apply(): void {
    const editor = vscode.window.activeTextEditor;
    const p = this.last;
    if (!editor || !p || !this.ctx.documents.get(editor.document)) return;
    editor.options.lineNumbers = p.relativenumber
      ? vscode.TextEditorLineNumbersStyle.Relative
      : p.number
        ? vscode.TextEditorLineNumbersStyle.On
        : vscode.TextEditorLineNumbersStyle.Off;
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const optionSyncFeature: FeatureDefinition = {
  id: 'optionSync',
  description: "Applies Neovim's 'number'/'relativenumber' to VS Code editors.",
  create: (ctx) => new OptionSyncFeature(ctx),
};
