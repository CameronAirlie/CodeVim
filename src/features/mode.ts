import * as vscode from 'vscode';
import { CursorStyleName } from '../config';
import { DisposableStore } from '../core/disposable';
import { Mode } from '../core/mode';
import { FeatureContext, FeatureDefinition } from './feature';

const CURSOR_STYLES: Record<CursorStyleName, vscode.TextEditorCursorStyle> = {
  block: vscode.TextEditorCursorStyle.Block,
  'block-outline': vscode.TextEditorCursorStyle.BlockOutline,
  line: vscode.TextEditorCursorStyle.Line,
  'line-thin': vscode.TextEditorCursorStyle.LineThin,
  underline: vscode.TextEditorCursorStyle.Underline,
  'underline-thin': vscode.TextEditorCursorStyle.UnderlineThin,
};

const LABELS: Record<Mode['kind'], string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  replace: 'REPLACE',
  visual: 'VISUAL',
  visualLine: 'V-LINE',
  visualBlock: 'V-BLOCK',
  select: 'SELECT',
  operator: 'PENDING',
  cmdline: 'COMMAND',
  terminal: 'TERMINAL',
};

/** Mode presentation: `codevim.mode` context key, cursor shape and status bar item. */
class ModeFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly item = vscode.window.createStatusBarItem('codevim.mode', vscode.StatusBarAlignment.Left, 1000);

  constructor(private readonly ctx: FeatureContext) {
    this.item.name = 'CodeVim Mode';
    this.item.command = 'codevim.showLog';
    this.item.show();
    const d = this.disposables;
    d.add(this.item);
    d.add(ctx.session.mode.onDidChange((m) => this.render(m)));
    d.add(vscode.window.onDidChangeActiveTextEditor(() => this.render(ctx.session.mode.current)));
    d.add(ctx.config.onDidChange(() => this.render(ctx.session.mode.current)));
    this.render(ctx.session.mode.current);
  }

  private styleFor(mode: Mode): vscode.TextEditorCursorStyle {
    const s = this.ctx.config.current.cursorStyle;
    switch (mode.kind) {
      case 'insert':
        return CURSOR_STYLES[s.insert];
      case 'replace':
        return CURSOR_STYLES[s.replace];
      case 'operator':
        return CURSOR_STYLES[s.operator];
      case 'cmdline':
        return CURSOR_STYLES[s.cmdline];
      case 'visual':
      case 'visualLine':
      case 'visualBlock':
      case 'select':
        return CURSOR_STYLES[s.visual];
      default:
        return CURSOR_STYLES[s.normal];
    }
  }

  private render(mode: Mode): void {
    const kindKey = mode.kind;
    void vscode.commands.executeCommand('setContext', 'codevim.mode', kindKey);
    this.item.text = `-- ${LABELS[mode.kind]} --`;
    const editor = vscode.window.activeTextEditor;
    if (editor && this.ctx.documents.get(editor.document)) {
      editor.options.cursorStyle = this.styleFor(mode);
    }
  }

  dispose(): void {
    this.disposables.dispose();
    // Give editors their normal cursor back.
    const userStyle = vscode.workspace.getConfiguration('editor').get<CursorStyleName>('cursorStyle', 'line');
    for (const editor of vscode.window.visibleTextEditors) {
      editor.options.cursorStyle = CURSOR_STYLES[userStyle] ?? vscode.TextEditorCursorStyle.Line;
    }
  }
}

export const modeFeature: FeatureDefinition = {
  id: 'mode',
  description: 'Mode context key, cursor shape per mode and the status bar mode indicator.',
  required: true,
  create: (ctx) => new ModeFeature(ctx),
};
