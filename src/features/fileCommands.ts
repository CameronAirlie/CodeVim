import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { FeatureContext, FeatureDefinition } from './feature';

/** `:w`, `:q`, `:wq`, `:qa`, `:sp`, `:vs`, `:new` mapped onto VS Code. */
class FileCommandsFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();

  constructor(private readonly ctx: FeatureContext) {
    const { session } = ctx;
    const d = this.disposables;
    d.add(session.handleRequest('save', (p) => this.save(p.uri)));
    d.add(session.lua.on('quit', (p) => void (p.foreign && p.uri ? this.closeTabs(p.uri) : this.quit(p.bang, p.all))));
    d.add(session.lua.on('split', (p) => void this.split(p.direction, p.file, p.new)));
  }

  private async save(uri: string): Promise<boolean> {
    const doc = this.ctx.documents.get(uri)?.document;
    if (!doc) return false;
    if (doc.isUntitled) {
      await vscode.window.showTextDocument(doc);
      return (await vscode.commands.executeCommand('workbench.action.files.saveAs')) !== undefined;
    }
    await this.ctx.documents.get(uri)?.whenSynced();
    return doc.isDirty ? doc.save() : true;
  }

  private async quit(bang: boolean, all: boolean): Promise<void> {
    if (all) {
      // VS Code asks about unsaved editors itself.
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      return;
    }
    await vscode.commands.executeCommand(bang ? 'workbench.action.revertAndCloseActiveEditor' : 'workbench.action.closeActiveEditor');
  }

  /** Closes every tab showing `uri` (plugin buffers are never dirty). */
  private async closeTabs(uri: string): Promise<void> {
    const tabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri);
    if (tabs.length > 0) await vscode.window.tabGroups.close(tabs);
  }

  private async split(direction: 'down' | 'right', file: string | undefined, newFile: boolean): Promise<void> {
    await vscode.commands.executeCommand(direction === 'down' ? 'workbench.action.splitEditorDown' : 'workbench.action.splitEditorRight');
    if (newFile) {
      await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    } else if (file) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Active, preview: false });
    }
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const fileCommandsFeature: FeatureDefinition = {
  id: 'fileCommands',
  description: 'Saving, closing and splitting editors from Neovim commands.',
  required: true,
  create: (ctx) => new FileCommandsFeature(ctx),
};
