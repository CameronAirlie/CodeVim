import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { HlsearchPayload } from '../nvim/protocol';
import { byteToUtf16 } from '../sync/positions';
import { FeatureContext, FeatureDefinition } from './feature';

/** Highlights 'hlsearch' / 'incsearch' matches using VS Code's find-match colours. */
class SearchHighlightFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly matchDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
  private readonly currentDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchBackground'),
    borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
    borderStyle: 'solid',
    borderWidth: '1px',
  });
  private decorated: vscode.TextEditor | undefined;

  constructor(private readonly ctx: FeatureContext) {
    this.disposables.add(this.matchDecoration);
    this.disposables.add(this.currentDecoration);
    this.disposables.add(ctx.session.lua.on('hlsearch', (p) => void this.render(p)));
  }

  private async render(p: HlsearchPayload): Promise<void> {
    const binding = this.ctx.documents.getByBuf(p.buf);
    const editor = vscode.window.activeTextEditor;
    if (this.decorated && this.decorated !== editor) {
      this.decorated.setDecorations(this.matchDecoration, []);
      this.decorated.setDecorations(this.currentDecoration, []);
    }
    if (!binding || !editor || editor.document !== binding.document) return;
    await binding.whenSynced();
    const doc = editor.document;
    const ranges: vscode.Range[] = [];
    let current: vscode.Range | undefined;
    for (const [line, sb, eb] of p.matches) {
      if (line >= doc.lineCount) continue;
      const text = doc.lineAt(line).text;
      const r = new vscode.Range(line, byteToUtf16(text, sb), line, byteToUtf16(text, eb));
      if (p.current && p.current[0] === line && p.current[1] === sb) current = r;
      else ranges.push(r);
    }
    editor.setDecorations(this.matchDecoration, ranges);
    editor.setDecorations(this.currentDecoration, current ? [current] : []);
    if (current && !editor.visibleRanges.some((v) => v.contains(current!))) {
      editor.revealRange(current, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    this.decorated = editor;
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const searchHighlightFeature: FeatureDefinition = {
  id: 'searchHighlight',
  description: "Shows Neovim search matches ('hlsearch', 'incsearch') as editor highlights.",
  create: (ctx) => new SearchHighlightFeature(ctx),
};
