import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { FeatureContext, FeatureDefinition } from './feature';

const DEBOUNCE_MS = 40;
/** After Neovim scrolls, VS Code's scroll events for a while are just it catching up. */
const NVIM_SCROLL_GRACE_MS = 300;

/**
 * Matches Neovim's window to the visible part of the active editor, and scrolls
 * VS Code when Neovim scrolls (`zz`, `zt`, `<C-e>`, 'scrolloff', jumps…).
 */
class ViewportFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private overhead = 2;
  private timer: NodeJS.Timeout | undefined;
  /** Top line Neovim last reported, per buffer; avoids echoing it back. */
  private readonly nvimTop = new Map<number, { top: number; at: number }>();
  private syncTop = false;

  constructor(private readonly ctx: FeatureContext) {
    const d = this.disposables;
    d.add(vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) this.schedule(true);
    }));
    // A newly focused editor only resizes Neovim: when VS Code switched editors the
    // focus request already carried its scroll position, and when Neovim switched
    // (e.g. :help, a telescope pick) the editor adopts Neovim's.
    d.add(vscode.window.onDidChangeActiveTextEditor((e) => {
      this.schedule(false);
      if (e) void this.adoptNvimTop(e);
    }));
    d.add(ctx.session.lua.on('window', (p) => {
      if (!p.is_float && p.overhead !== this.overhead) {
        this.overhead = p.overhead;
        this.schedule();
      }
    }));
    d.add(ctx.session.lua.on('viewport', (p) => void this.onNvimViewport(p.buf, p.top)));
    this.schedule();
  }

  private schedule(syncTop = false): void {
    this.syncTop = this.syncTop || syncTop;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const sync = this.syncTop;
      this.syncTop = false;
      this.pushToNvim(sync);
    }, DEBOUNCE_MS);
  }

  private pushToNvim(syncTop: boolean): void {
    const editor = vscode.window.activeTextEditor;
    const binding = editor && this.ctx.documents.get(editor.document);
    if (!editor || !binding) return;
    const ranges = editor.visibleRanges;
    if (ranges.length === 0) return;
    const top = ranges[0].start.line;
    const height = ranges[ranges.length - 1].end.line - top + 1;
    this.ctx.ui.setBase({ width: this.ctx.config.current.uiWidth, height: height + this.overhead });
    const nvim = this.nvimTop.get(binding.buf);
    const nvimDriving = nvim && Date.now() - nvim.at < NVIM_SCROLL_GRACE_MS;
    if (syncTop && this.ctx.config.current.syncScroll && nvim?.top !== top && !nvimDriving) {
      this.ctx.session.callAsync('codevim.state', 'set_viewport', [binding.buf, top]);
    }
  }

  private async onNvimViewport(buf: number, top: number): Promise<void> {
    this.nvimTop.set(buf, { top, at: Date.now() });
    const editor = vscode.window.activeTextEditor;
    if (editor) await this.reveal(editor, buf, top);
  }

  private async adoptNvimTop(editor: vscode.TextEditor): Promise<void> {
    const binding = this.ctx.documents.get(editor.document);
    const nvim = binding && this.nvimTop.get(binding.buf);
    if (binding && nvim && this.ctx.session.window?.buf === binding.buf) {
      nvim.at = Date.now();
      await this.reveal(editor, binding.buf, nvim.top);
    }
  }

  private async reveal(editor: vscode.TextEditor, buf: number, top: number): Promise<void> {
    const binding = this.ctx.documents.get(editor.document);
    if (!binding || binding.buf !== buf) return;
    await binding.whenSynced();
    if (editor.visibleRanges[0]?.start.line === top) return;
    editor.revealRange(new vscode.Range(top, 0, top, 0), vscode.TextEditorRevealType.AtTop);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.dispose();
  }
}

export const viewportFeature: FeatureDefinition = {
  id: 'viewport',
  description: 'Synchronises window height and scrolling between the editor and Neovim.',
  create: (ctx) => new ViewportFeature(ctx),
};
