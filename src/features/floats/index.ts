import * as vscode from 'vscode';
import { DisposableStore } from '../../core/disposable';
import { contentText, lineHeightPx, themeVar } from '../editorOverlay';
import { FeatureContext, FeatureDefinition } from '../feature';
import { GridModel } from '../surface/grid';
import { buildOverlay, OverlayColor, OverlayRun } from './layout';

const RENDER_DELAY_MS = 8;

function color(c: OverlayColor | undefined): string | vscode.ThemeColor | undefined {
  if (!c) return undefined;
  return 'theme' in c ? new vscode.ThemeColor(c.theme) : c.rgb;
}

/** The colour as a CSS value, for use in raw CSS. */
function cssColor(c: OverlayColor): string {
  return 'theme' in c ? themeVar(c.theme) : c.rgb;
}

/**
 * Draws Neovim's floating windows (telescope, lazy, which-key, hover/preview popups…)
 * directly on top of the active editor, in the VS Code theme. Nothing opens or
 * takes focus: you keep typing in the editor and the keys go to the float.
 *
 * The floats are cut out of Neovim's screen grid; the grid matches the editor's
 * visible lines, so screen row N sits on visible line N.
 */
class FloatOverlayFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly grid = new GridModel();
  private readonly decoration = vscode.window.createTextEditorDecorationType({});
  private decorated: vscode.TextEditor | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly ctx: FeatureContext) {
    const d = this.disposables;
    d.add(this.decoration);
    d.add(ctx.session.bus.on('redraw', (events) => {
      if (this.grid.apply(events)) this.schedule();
    }));
    d.add(ctx.session.onDidChangeWindow(() => this.schedule()));
    d.add(vscode.window.onDidChangeActiveTextEditor(() => this.schedule()));
    d.add(vscode.window.onDidChangeTextEditorVisibleRanges(() => this.schedule()));
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.render();
    }, RENDER_DELAY_MS);
  }

  private clear(): void {
    this.decorated?.setDecorations(this.decoration, []);
    this.decorated = undefined;
  }

  private render(): void {
    const cfg = this.ctx.config.current.floats;
    const editor = vscode.window.activeTextEditor;
    const w = this.ctx.session.window;
    if (cfg.display !== 'overlay' || !editor || !w || !this.ctx.documents.get(editor.document) || w.floats.length === 0) {
      this.clear();
      return;
    }
    if (this.decorated && this.decorated !== editor) this.clear();
    const inFloat = w.is_float && w.floats.some((f) => f.win === w.win);
    const runs = buildOverlay(this.grid, w.floats, { colors: cfg.colors, cursor: inFloat ? this.grid.cursor : undefined });
    const top = editor.visibleRanges[0]?.start.line ?? 0;
    const lh = lineHeightPx(editor.document);
    const anchor = new vscode.Range(top, 0, top, 0);
    editor.setDecorations(
      this.decoration,
      runs.map((r) => ({ range: anchor, renderOptions: { before: this.attachment(r, lh) } })),
    );
    this.decorated = editor;
  }

  private attachment(r: OverlayRun, lh: number): vscode.ThemableDecorationAttachmentRenderOptions {
    const lines = [r.underline ? 'underline' : '', r.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    // Theme colours such as list.activeSelectionBackground are often translucent and
    // would let the editor text underneath show through: paint them as a layer over
    // the opaque editor background instead.
    const bg = r.bg ? ` background-image: linear-gradient(${cssColor(r.bg)}, ${cssColor(r.bg)});` : '';
    return {
      contentText: contentText(r.text),
      color: color(r.fg),
      backgroundColor: r.bg ? new vscode.ThemeColor('editor.background') : undefined,
      fontWeight: r.bold ? 'bold' : 'normal',
      fontStyle: r.italic ? 'italic' : 'normal',
      // Decorations can't be positioned freely through the API; the CSS is appended
      // to text-decoration to place each run on its screen cell.
      textDecoration:
        `${lines}; position: absolute; top: ${r.row * lh}px; left: ${r.col}ch; height: ${lh}px; line-height: ${lh}px;` +
        ` z-index: ${100 + r.zindex}; white-space: pre; pointer-events: none;${bg}`,
    };
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.clear();
    this.disposables.dispose();
  }
}

export const floatOverlayFeature: FeatureDefinition = {
  id: 'floats',
  description: "Draws Neovim's floating windows (telescope, which-key, previews…) over the editor.",
  create: (ctx) => new FloatOverlayFeature(ctx),
};
