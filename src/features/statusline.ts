import * as vscode from 'vscode';
import { StatuslineModeGroup } from '../config';
import { DisposableStore } from '../core/disposable';
import { Mode, MODE_LABELS } from '../core/mode';
import { chunksToText } from '../nvim/redraw';
import { emptyCmdline, formatCmdline, reduceCmdline } from './cmdlineState';
import { contentText, lineHeightPx, themeVar } from './editorOverlay';
import { FeatureContext, FeatureDefinition } from './feature';

const ERROR_KINDS = new Set(['emsg', 'echoerr', 'lua_error', 'rpc_error']);
const MESSAGE_TIMEOUT_MS = 5000;
const MAX_MESSAGE_LENGTH = 200;
const RENDER_DELAY_MS = 8;
/** Above the float overlay (100 + float zindex). */
const Z_INDEX = 2000;

interface Segment {
  text: string;
  /** Raw CSS colours. */
  fg?: string;
  bg?: string;
  bold?: boolean;
}

function modeGroup(mode: Mode): StatuslineModeGroup {
  switch (mode.kind) {
    case 'visualLine':
    case 'visualBlock':
    case 'select':
      return 'visual';
    default:
      return mode.kind;
  }
}

/** A setting value: a hex colour, or a theme colour id. */
function cssColor(value: string): string {
  return value.startsWith('#') ? value : themeVar(value);
}

/**
 * A Vim-style statusline drawn along the bottom of the active editor: the mode
 * (coloured per mode), then the command line while it is open or the latest
 * message, the recording state and pending keys.
 *
 * It sits on the last fully visible line; VS Code has no API to add real UI
 * inside an editor, so it is a decoration positioned over the text.
 */
class StatuslineFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly decoration = vscode.window.createTextEditorDecorationType({});
  private readonly cmdline = emptyCmdline();
  private message: { text: string; isError: boolean } | undefined;
  private showmode = '';
  private showcmd = '';
  private decorated: vscode.TextEditor | undefined;
  private timer: NodeJS.Timeout | undefined;
  private messageTimer: NodeJS.Timeout | undefined;

  constructor(private readonly ctx: FeatureContext) {
    const d = this.disposables;
    d.add(this.decoration);
    d.add(ctx.session.bus.on('redraw', (events) => {
      let changed = reduceCmdline(this.cmdline, events);
      for (const { name, args } of events) {
        switch (name) {
          case 'msg_show':
            changed = this.onMessage(args[0] as string, chunksToText(args[1])) || changed;
            break;
          case 'msg_clear':
            this.setMessage(undefined);
            changed = true;
            break;
          case 'msg_showmode':
            this.showmode = chunksToText(args[0]).trim();
            changed = true;
            break;
          case 'msg_showcmd':
            this.showcmd = chunksToText(args[0]).trim();
            changed = true;
            break;
        }
      }
      if (changed) this.schedule();
    }));
    d.add(ctx.session.mode.onDidChange(() => this.schedule()));
    d.add(ctx.config.onDidChange(() => this.schedule()));
    d.add(vscode.window.onDidChangeActiveTextEditor(() => this.schedule()));
    d.add(vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) this.schedule();
    }));
    this.schedule();
  }

  private onMessage(kind: string, text: string): boolean {
    if (kind === 'return_prompt' || !text.trim()) return false;
    const lines = text.split('\n');
    let first = lines[0];
    if (lines.length > 1 || first.length > MAX_MESSAGE_LENGTH) first = `${first.slice(0, 60)}… (see CodeVim Messages)`;
    this.setMessage({ text: first, isError: ERROR_KINDS.has(kind) });
    return true;
  }

  private setMessage(message: { text: string; isError: boolean } | undefined): void {
    this.message = message;
    clearTimeout(this.messageTimer);
    if (message) {
      this.messageTimer = setTimeout(() => {
        this.message = undefined;
        this.schedule();
      }, MESSAGE_TIMEOUT_MS);
    }
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

  private segments(mode: Mode, modeColor: string): Segment[] {
    const segs: Segment[] = [
      { text: ` ${MODE_LABELS[mode.kind]} `, fg: themeVar('editor.background'), bg: modeColor, bold: true },
    ];
    if (this.showmode) segs.push({ text: ` ${this.showmode}`, fg: modeColor, bold: true });
    if (this.cmdline.visible) {
      segs.push({ text: ` ${formatCmdline(this.cmdline)}` });
    } else if (this.message) {
      segs.push({ text: ` ${this.message.text}`, fg: this.message.isError ? themeVar('errorForeground') : undefined });
    }
    if (this.showcmd) segs.push({ text: `   ${this.showcmd}`, fg: modeColor });
    return segs;
  }

  private render(): void {
    const editor = vscode.window.activeTextEditor;
    const ranges = editor?.visibleRanges ?? [];
    if (!this.ctx.config.statuslineInEditor || !editor || ranges.length === 0 || !this.ctx.documents.get(editor.document)) {
      this.clear();
      return;
    }
    if (this.decorated && this.decorated !== editor) this.clear();

    const mode = this.ctx.session.mode.current;
    const modeColor = cssColor(this.ctx.config.current.statusline.colors[modeGroup(mode)]);
    const lh = lineHeightPx(editor.document);
    const last = ranges[ranges.length - 1].end.line;
    const anchor = new vscode.Range(last, 0, last, 0);
    const base = `position: absolute; top: 0; height: ${lh}px; line-height: ${lh}px; white-space: pre; pointer-events: none;`;

    const options: vscode.DecorationOptions[] = [
      {
        // The bar itself: the mode colour tinted into the editor background.
        range: anchor,
        renderOptions: {
          before: {
            contentText: ' ',
            textDecoration:
              `none; ${base} left: 0; width: 100vw; z-index: ${Z_INDEX};` +
              ` background-color: color-mix(in srgb, ${modeColor} 18%, ${themeVar('editor.background')});` +
              ` box-shadow: inset 0 1px 0 ${modeColor}`,
          },
        },
      },
    ];
    let col = 0;
    for (const seg of this.segments(mode, modeColor)) {
      options.push({
        range: anchor,
        renderOptions: {
          before: {
            contentText: contentText(seg.text.replace(/\n/g, ' ')),
            color: seg.fg ? undefined : new vscode.ThemeColor('editor.foreground'),
            fontWeight: seg.bold ? 'bold' : 'normal',
            textDecoration:
              `none; ${base} left: ${col}ch; z-index: ${Z_INDEX + 1};` +
              (seg.fg ? ` color: ${seg.fg};` : '') +
              (seg.bg ? ` background-color: ${seg.bg};` : ''),
          },
        },
      });
      col += [...seg.text].length;
    }
    editor.setDecorations(this.decoration, options);
    this.decorated = editor;
  }

  dispose(): void {
    clearTimeout(this.timer);
    clearTimeout(this.messageTimer);
    this.clear();
    this.disposables.dispose();
  }
}

export const statuslineFeature: FeatureDefinition = {
  id: 'statusline',
  description: 'Vim-style statusline at the bottom of the active editor, coloured by mode.',
  create: (ctx) => new StatuslineFeature(ctx),
};
