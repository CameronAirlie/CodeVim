import * as vscode from 'vscode';
import { DisposableStore } from '../../core/disposable';
import { WindowPayload } from '../../nvim/protocol';
import { emptyCmdline, reduceCmdline } from '../cmdlineState';
import { FeatureContext, FeatureDefinition } from '../feature';
import { GridModel } from './grid';
import { FromWebview, ToWebview } from './messages';

const DECIDE_DEBOUNCE_MS = 40;

type Placement = { show: false } | { show: true; focus: boolean };

/**
 * Decides when Neovim's own UI is needed and shows it in a webview.
 *
 * Mirrored documents are edited in real VS Code editors. Everything else Neovim
 * draws - telescope and other floating windows, oil, fugitive, :help, :terminal,
 * lazy.nvim, quickfix… - is rendered here from Neovim's screen grid, with keys and
 * mouse input forwarded back. When you return to a document it closes again.
 */
class SurfaceFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly grid = new GridModel();
  private readonly cmdline = emptyCmdline();
  private panel: vscode.WebviewPanel | undefined;
  private panelReady = false;
  private sizeClaim: ReturnType<FeatureContext['ui']['claim']> | undefined;
  private lastWindow: WindowPayload | undefined;
  private decideTimer: NodeJS.Timeout | undefined;
  /** Set while we dispose the panel ourselves (vs. the user closing the tab). */
  private closingPanel = false;

  constructor(private readonly ctx: FeatureContext) {
    const d = this.disposables;
    d.add(ctx.session.bus.on('redraw', (events) => {
      const flushed = this.grid.apply(events);
      if (reduceCmdline(this.cmdline, events)) this.post({ type: 'cmdline', state: this.cmdline });
      if (flushed) this.sendFrame(false);
    }));
    d.add(ctx.session.lua.on('window', (p) => {
      this.lastWindow = p;
      this.scheduleDecide();
    }));
    d.add(vscode.commands.registerCommand('codevim.showSurface', () => this.show(true)));
  }

  /** The surface is opt-in: only used where settings pick it over overlays/editors. */
  private placement(p: WindowPayload): Placement {
    const cfg = this.ctx.config.current;
    const floatsHere = cfg.floats.display === 'surface';
    const focusable = p.floats.filter((f) => f.focusable);
    if (p.kind === 'special' && cfg.pluginBuffers.display === 'surface') {
      return { show: true, focus: true };
    }
    if (!floatsHere) {
      return { show: false };
    }
    if (p.is_float && focusable.some((f) => f.win === p.win)) {
      return { show: true, focus: true };
    }
    const mode = cfg.surface.unfocusedFloats;
    const visible = mode === 'all' ? p.floats : mode === 'focusable' ? focusable : [];
    return visible.length > 0 ? { show: true, focus: false } : { show: false };
  }

  private scheduleDecide(): void {
    clearTimeout(this.decideTimer);
    this.decideTimer = setTimeout(() => this.decide(), DECIDE_DEBOUNCE_MS);
  }

  private decide(): void {
    if (!this.lastWindow) return;
    const placement = this.placement(this.lastWindow);
    if (placement.show) {
      this.show(placement.focus);
    } else {
      this.hide();
    }
  }

  private show(focus: boolean): void {
    const cfg = this.ctx.config.current.surface;
    if (this.panel) {
      if (focus && !this.panel.active) this.panel.reveal(undefined, false);
      if (focus) this.post({ type: 'focus' });
      return;
    }
    const column = focus && cfg.viewColumn === 'active' ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
    const panel = vscode.window.createWebviewPanel(
      'codevim.surface',
      'Neovim',
      { viewColumn: column, preserveFocus: !focus },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.ctx.extension.extensionUri, 'dist')] },
    );
    panel.iconPath = vscode.Uri.joinPath(this.ctx.extension.extensionUri, 'media', 'codevim-logo.svg');
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m));
    panel.onDidChangeViewState(() => {
      void vscode.commands.executeCommand('setContext', 'codevim.surfaceFocused', panel.active);
      if (panel.active) this.post({ type: 'focus' });
    });
    panel.onDidDispose(() => this.onPanelDisposed());
    this.panel = panel;
    this.panelReady = false;
  }

  private hide(): void {
    if (!this.panel) return;
    this.closingPanel = true;
    const wasActive = this.panel.active;
    this.panel.dispose();
    this.closingPanel = false;
    if (wasActive) {
      // Put focus back on the editor Neovim is now showing.
      void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }
  }

  private onPanelDisposed(): void {
    this.panel = undefined;
    this.panelReady = false;
    this.sizeClaim?.dispose();
    this.sizeClaim = undefined;
    void vscode.commands.executeCommand('setContext', 'codevim.surfaceFocused', false);
    if (!this.closingPanel && this.lastWindow && this.placement(this.lastWindow).show) {
      // The user closed the tab while Neovim was in a plugin view: leave it.
      this.ctx.session.callAsync('codevim.window', 'leave_special');
    }
  }

  private onMessage(m: FromWebview): void {
    switch (m.type) {
      case 'ready':
        this.panelReady = true;
        this.sendFrame(true);
        this.post({ type: 'cmdline', state: this.cmdline });
        return;
      case 'resize': {
        const size = { width: m.cols, height: m.rows };
        if (this.sizeClaim) this.sizeClaim.update(size);
        else this.sizeClaim = this.ctx.ui.claim(size);
        return;
      }
      case 'input':
        this.ctx.session.input(m.keys);
        return;
      case 'mouse':
        this.ctx.session.notify('nvim_input_mouse', [m.button, m.action, m.modifier, 0, m.row, m.col]);
        return;
    }
  }

  private sendFrame(reset: boolean): void {
    if (!this.panel || !this.panelReady) return;
    if (reset) this.grid.markAllDirty();
    const rows = this.grid.takeDirtyRows().map((row) => ({ row, runs: this.grid.rowRuns(row) }));
    this.post({
      type: 'frame',
      width: this.grid.width,
      height: this.grid.height,
      reset,
      rows,
      highlights: reset ? this.grid.allHighlights() : this.grid.takeDirtyHighlights(),
      defaults: this.grid.defaults,
      cursor: this.grid.cursor,
      cursorShape: this.grid.cursorShape,
    });
  }

  private post(message: ToWebview): void {
    if (this.panel && this.panelReady) void this.panel.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const cfg = this.ctx.config.current.surface;
    const editorCfg = vscode.workspace.getConfiguration('editor');
    const font = cfg.fontFamily || editorCfg.get<string>('fontFamily') || 'monospace';
    const size = cfg.fontSize || editorCfg.get<number>('fontSize') || 14;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extension.extensionUri, 'dist', 'webview', 'surface.js'));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const settings = JSON.stringify({ font, size, passthrough: cfg.passthroughKeys }).replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Neovim</title>
</head>
<body>
<div id="screen" tabindex="0"></div>
<script nonce="${nonce}">window.CODEVIM_SETTINGS = ${settings};</script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    clearTimeout(this.decideTimer);
    this.closingPanel = true;
    this.panel?.dispose();
    this.disposables.dispose();
  }
}

export const surfaceFeature: FeatureDefinition = {
  id: 'surface',
  description: "Renders Neovim's own UI (floats, plugin buffers, :help, :terminal) in a webview.",
  create: (ctx) => new SurfaceFeature(ctx),
};
