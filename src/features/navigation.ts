import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { scopedLogger } from '../core/logger';
import { WindowPayload } from '../nvim/protocol';
import { FeatureContext, FeatureDefinition } from './feature';

const NVIM_INITIATED_TTL_MS = 2000;
const PLUGIN_SETTLE_MS = 30;

/**
 * Two-way navigation between VS Code editors and Neovim buffers.
 *
 *  VS Code → Neovim: focusing an editor makes its buffer current in Neovim (and
 *                    records a jump, so <C-o>/<C-i> walk across editors).
 *  Neovim → VS Code: `:e`, `:b`, `<C-^>`, `gf`, `<C-o>`, telescope… switching to a
 *                    buffer opens that document in VS Code. Unnamed buffers
 *                    (`:enew`) become untitled documents. `:bd` closes the editor.
 */
class NavigationFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly log;
  /** Documents VS Code is opening because Neovim asked; their focus must not echo back. */
  private readonly nvimInitiated = new Map<string, number>();
  private specialSeq = 0;
  private lastBuf = -1;
  /** Until VS Code has focused an editor, Neovim is still starting (dashboards, etc.). */
  private started = false;
  /** Documents currently being shown, so overlapping requests don't open extra editors. */
  private readonly showing = new Map<string, Promise<void>>();

  constructor(private readonly ctx: FeatureContext) {
    this.log = scopedLogger(ctx.logger, 'navigation');
    const d = this.disposables;
    d.add(vscode.window.onDidChangeActiveTextEditor((e) => void this.onActiveEditor(e)));
    d.add(ctx.session.lua.on('window', (p) => void this.onNvimWindow(p)));
    d.add(ctx.session.lua.on('buf_deleted', (p) => void this.closeEditorsFor(p.uri)));
    void this.onActiveEditor(vscode.window.activeTextEditor);
  }

  private async onActiveEditor(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor || !this.ctx.documents.isSupported(editor.document)) {
      void vscode.commands.executeCommand('setContext', 'codevim.active', false);
      return;
    }
    const binding = await this.ctx.documents.ensureBinding(editor.document);
    // VS Code may report a transient "no editor" in between; only the editor that is
    // actually active once the buffer is ready gets focus.
    if (!binding || vscode.window.activeTextEditor?.document !== editor.document) {
      return;
    }
    void vscode.commands.executeCommand('setContext', 'codevim.active', true);
    this.started = true;
    const initiatedAt = this.nvimInitiated.get(binding.uri);
    const current = this.ctx.session.window;
    if (
      (initiatedAt && Date.now() - initiatedAt < NVIM_INITIATED_TTL_MS) ||
      (current && !current.is_float && current.buf === binding.buf)
    ) {
      return; // Neovim already shows this buffer with the right cursor.
    }
    const pos = editor.selection.active;
    await this.ctx.session
      .call('codevim.window', 'focus', [{ buf: binding.buf, line: pos.line, col16: pos.character, top: editor.visibleRanges[0]?.start.line }])
      .catch((err) => this.log.error(`focus failed: ${String(err)}`));
  }

  private async onNvimWindow(p: WindowPayload): Promise<void> {
    // Reports also fire for option/layout changes; only a change of buffer in Neovim
    // is a navigation. (A stale report for the old buffer must not pull VS Code back.)
    const bufChanged = p.buf !== this.lastBuf;
    this.lastBuf = p.buf;
    if (!bufChanged || p.internal || p.is_float || (!this.started && p.kind !== 'bound')) {
      return;
    }
    try {
      switch (p.kind) {
        case 'bound': {
          const binding = this.ctx.documents.getByBuf(p.buf);
          if (binding && vscode.window.activeTextEditor?.document !== binding.document) {
            await this.show(binding.document);
          }
          return;
        }
        case 'file': {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p.name));
          await this.ctx.documents.ensureBinding(doc, p.buf);
          await this.show(doc);
          return;
        }
        case 'scratch': {
          const lines = await this.ctx.session.request<string[]>('nvim_buf_get_lines', [p.buf, 0, -1, false]);
          const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n') });
          await this.ctx.documents.ensureBinding(doc, p.buf);
          await this.show(doc);
          return;
        }
        case 'special': {
          // help, oil, fugitive, quickfix, terminal… become ordinary editors.
          if (this.ctx.config.current.pluginBuffers.display !== 'editor') return;
          // Plugins name and fill their buffers in several steps; let them settle and
          // act on the last report only.
          const seq = ++this.specialSeq;
          await new Promise((r) => setTimeout(r, PLUGIN_SETTLE_MS));
          const latest = this.ctx.session.window;
          if (seq !== this.specialSeq || !latest || latest.buf !== p.buf || latest.is_float) return;
          if (latest.kind !== 'special' && latest.kind !== 'bound') return;
          const doc = await this.ctx.documents.openPluginBuffer(latest);
          if (doc) await this.show(doc, this.pluginColumn(latest));
          return;
        }
        default:
          return;
      }
    } catch (err) {
      this.log.warn(`could not open ${p.name || 'buffer ' + p.buf}: ${String(err)}`);
    }
  }

  /** Plugin buffers Neovim opened in a split (help, :Git, quickfix) go beside the editor. */
  private pluginColumn(p: WindowPayload): vscode.ViewColumn | undefined {
    switch (this.ctx.config.current.pluginBuffers.viewColumn) {
      case 'beside':
        return vscode.ViewColumn.Beside;
      case 'active':
        return undefined;
      default:
        return p.windows > 1 ? vscode.ViewColumn.Beside : undefined;
    }
  }

  private show(doc: vscode.TextDocument, column?: vscode.ViewColumn): Promise<void> {
    const key = doc.uri.toString();
    let p = this.showing.get(key);
    if (!p) {
      p = this.doShow(doc, column).finally(() => this.showing.delete(key));
      this.showing.set(key, p);
    }
    return p;
  }

  private async doShow(doc: vscode.TextDocument, column?: vscode.ViewColumn): Promise<void> {
    this.nvimInitiated.set(doc.uri.toString(), Date.now());
    const visible = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    await vscode.window.showTextDocument(doc, {
      viewColumn: visible?.viewColumn ?? column ?? vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active,
      preserveFocus: false,
      preview: false,
    });
  }

  private async closeEditorsFor(uri: string): Promise<void> {
    const tabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri);
    if (tabs.length > 0) {
      await vscode.window.tabGroups.close(tabs);
    }
  }

  dispose(): void {
    this.disposables.dispose();
    void vscode.commands.executeCommand('setContext', 'codevim.active', false);
  }
}

export const navigationFeature: FeatureDefinition = {
  id: 'navigation',
  description: 'Keeps the focused VS Code editor and the current Neovim buffer in step.',
  required: true,
  create: (ctx) => new NavigationFeature(ctx),
};
