import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { chunksToText } from '../nvim/redraw';
import { FeatureContext, FeatureDefinition } from './feature';

const ERROR_KINDS = new Set(['emsg', 'echoerr', 'lua_error', 'rpc_error']);
const MESSAGE_TIMEOUT_MS = 5000;
const MAX_STATUS_LENGTH = 140;

/**
 * Neovim messages (ext_messages): short ones go to the status bar, multi-line output
 * (`:ls`, `:messages`, `:registers`…) to the "CodeVim Messages" output channel.
 * Also shows 'showmode' (e.g. "recording @q") and 'showcmd' (pending keys).
 */
class MessagesFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly status = vscode.window.createStatusBarItem('codevim.message', vscode.StatusBarAlignment.Left, 998);
  private readonly showmode = vscode.window.createStatusBarItem('codevim.showmode', vscode.StatusBarAlignment.Left, 997);
  private readonly showcmd = vscode.window.createStatusBarItem('codevim.showcmd', vscode.StatusBarAlignment.Right, 1000);
  private readonly output = vscode.window.createOutputChannel('CodeVim Messages');
  private clearTimer: NodeJS.Timeout | undefined;

  constructor(private readonly ctx: FeatureContext) {
    this.status.name = 'CodeVim Message';
    this.status.command = 'codevim.showMessages';
    this.showmode.name = 'CodeVim Recording';
    this.showcmd.name = 'CodeVim Pending Keys';
    const d = this.disposables;
    d.add(this.status);
    d.add(this.showmode);
    d.add(this.showcmd);
    d.add(this.output);
    d.add(vscode.commands.registerCommand('codevim.showMessages', () => this.output.show(true)));
    d.add(ctx.session.bus.on('redraw', (events) => {
      for (const { name, args } of events) {
        switch (name) {
          case 'msg_show':
            this.onMessage(args[0] as string, chunksToText(args[1]), args[2] as boolean);
            break;
          case 'msg_clear':
            this.status.hide();
            break;
          case 'msg_showmode':
            this.setItem(this.showmode, chunksToText(args[0]));
            break;
          case 'msg_showcmd':
            this.setItem(this.showcmd, chunksToText(args[0]));
            break;
          case 'msg_history_show':
            this.showHistory(args[0] as unknown[][]);
            break;
        }
      }
    }));
  }

  /** The in-editor statusline shows messages instead of the status bar. */
  private get inEditor(): boolean {
    return this.ctx.config.statuslineInEditor;
  }

  private setItem(item: vscode.StatusBarItem, text: string): void {
    const t = text.trim();
    if (t && !this.inEditor) {
      item.text = t.replace(/\$\(/g, '$​(');
      item.show();
    } else {
      item.hide();
    }
  }

  private onMessage(kind: string, text: string, replaceLast: boolean): void {
    this.ctx.logger.debug(`[messages] ${kind || 'msg'}: ${text}`);
    if (kind === 'return_prompt') {
      // The output already went to the channel; never block Neovim on "Press ENTER".
      this.ctx.session.input('<CR>');
      return;
    }
    if (!text.trim()) return;
    const isError = ERROR_KINDS.has(kind);
    if (!replaceLast || text.includes('\n')) {
      this.output.appendLine(text);
    }
    if (text.includes('\n') || text.length > MAX_STATUS_LENGTH) {
      this.output.show(true);
      this.flash(`$(output) ${text.split('\n')[0].slice(0, 60)}…`, isError);
      return;
    }
    if (isError && this.ctx.config.current.errorsAsNotifications) {
      void vscode.window.showErrorMessage(text);
    }
    this.flash(text.replace(/\$\(/g, '$​('), isError);
  }

  private flash(text: string, isError: boolean): void {
    if (this.inEditor) return;
    this.status.text = text;
    this.status.backgroundColor = isError ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
    this.status.show();
    clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.status.hide(), MESSAGE_TIMEOUT_MS);
  }

  private showHistory(entries: unknown[][]): void {
    this.output.appendLine('--- :messages ---');
    for (const e of entries) this.output.appendLine(chunksToText(e[1]));
    this.output.show(true);
  }

  dispose(): void {
    clearTimeout(this.clearTimer);
    this.disposables.dispose();
  }
}

export const messagesFeature: FeatureDefinition = {
  id: 'messages',
  description: 'Shows Neovim messages, recording state and pending keys.',
  create: (ctx) => new MessagesFeature(ctx),
};
