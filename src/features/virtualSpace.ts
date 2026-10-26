import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { CursorPayload } from '../nvim/protocol';
import { BlockOverhang, blockOverhangs } from '../sync/selection';
import { contentText, themeVar } from './editorOverlay';
import { FeatureContext, FeatureDefinition } from './feature';

/** A CSS background painting the overhang: blank gap, selected cells, and the cursor cell. */
function overhangBackground(o: BlockOverhang): string {
  const sel = themeVar('editor.selectionBackground');
  const end = o.gap + o.width;
  const stops = [`transparent 0 ${o.gap}ch`];
  if (o.cursor !== undefined && o.cursor >= o.gap && o.cursor < end) {
    stops.push(`${sel} ${o.gap}ch ${o.cursor}ch`, `${themeVar('editorCursor.foreground')} ${o.cursor}ch ${o.cursor + 1}ch`, `${sel} ${o.cursor + 1}ch ${end}ch`);
  } else {
    stops.push(`${sel} ${o.gap}ch ${end}ch`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * Draws the part of a visual block that lies past the end of shorter lines
 * ('virtualedit=block'). VS Code has no virtual space, so selections stop at the end
 * of each line; the rest of the block (and the cursor, when it is out there) is
 * painted after the line's text.
 */
class VirtualSpaceFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly decoration = vscode.window.createTextEditorDecorationType({});
  private decorated: vscode.TextEditor | undefined;

  constructor(private readonly ctx: FeatureContext) {
    const { session } = ctx;
    const d = this.disposables;
    d.add(this.decoration);
    d.add(session.lua.on('cursor', (p) => this.render(p)));
    d.add(session.lua.on('mode', (p) => (p.cursor ? this.render(p.cursor) : this.clear())));
    d.add(vscode.window.onDidChangeActiveTextEditor(() => this.clear()));
  }

  private render(p: CursorPayload): void {
    const overhangs = blockOverhangs(p);
    const binding = this.ctx.documents.getByBuf(p.buf);
    const editor = vscode.window.activeTextEditor;
    if (overhangs.length === 0 || !binding || editor?.document !== binding.document) {
      this.clear();
      return;
    }
    if (this.decorated && this.decorated !== editor) this.clear();
    const doc = editor.document;
    const options: vscode.DecorationOptions[] = overhangs
      .filter((o) => o.line < doc.lineCount)
      .map((o) => {
        const eol = doc.lineAt(o.line).range.end;
        return {
          range: new vscode.Range(eol, eol),
          renderOptions: {
            after: {
              contentText: contentText(' '.repeat(o.gap + o.width)),
              textDecoration: `none; background-image: ${overhangBackground(o)}`,
            },
          },
        };
      });
    editor.setDecorations(this.decoration, options);
    this.decorated = editor;
  }

  private clear(): void {
    this.decorated?.setDecorations(this.decoration, []);
    this.decorated = undefined;
  }

  dispose(): void {
    this.clear();
    this.disposables.dispose();
  }
}

export const virtualSpaceFeature: FeatureDefinition = {
  id: 'virtualSpace',
  description: 'Draws visual-block selections that extend past the end of lines.',
  create: (ctx) => new VirtualSpaceFeature(ctx),
};
