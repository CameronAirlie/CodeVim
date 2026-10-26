import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { emptyCmdline, formatCmdline, reduceCmdline } from './cmdlineState';
import { FeatureContext, FeatureDefinition } from './feature';

function noIcons(s: string): string {
  // `$(name)` renders as a codicon in status bar text.
  return s.replace(/\$\(/g, '$​(');
}

/**
 * Shows Neovim's command line (`:`, `/`, `?`, `input()` prompts) in the status bar.
 * Keys keep flowing to Neovim, so history, completion, <C-r> and mappings all work.
 */
class CmdlineFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly item = vscode.window.createStatusBarItem('codevim.cmdline', vscode.StatusBarAlignment.Left, 999);
  private readonly state = emptyCmdline();

  constructor(private readonly ctx: FeatureContext) {
    this.item.name = 'CodeVim Command Line';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.disposables.add(this.item);
    this.disposables.add(ctx.session.bus.on('redraw', (events) => {
      if (reduceCmdline(this.state, events)) this.render();
    }));
    this.disposables.add(ctx.config.onDidChange(() => this.render()));
  }

  private render(): void {
    const s = this.state;
    if (!s.visible || this.ctx.config.statuslineInEditor) {
      this.item.hide();
      return;
    }
    this.item.text = noIcons(formatCmdline(s));
    this.item.tooltip = s.content;
    this.item.show();
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const cmdlineFeature: FeatureDefinition = {
  id: 'cmdline',
  description: 'Renders the Neovim command line and wildmenu in the status bar.',
  create: (ctx) => new CmdlineFeature(ctx),
};
