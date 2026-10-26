import * as vscode from 'vscode';
import { DisposableStore, toDisposable } from '../core/disposable';
import { scopedLogger } from '../core/logger';
import { FoldAction, FoldPayload } from '../nvim/protocol';
import { hiddenLines } from '../sync/folds';
import { FeatureContext, FeatureDefinition } from './feature';

interface FoldCommand {
  command: string;
  args?: (p: FoldPayload) => unknown;
  /** Acts on the VS Code selection, which is set to the visual lines first. */
  usesSelection?: boolean;
  /** Moves the VS Code cursor; Neovim's cursor follows. */
  movesCursor?: boolean;
}

const levels = (p: FoldPayload) => ({ levels: p.count });

/** What each Neovim fold key (runtime/lua/codevim/fold.lua) does in VS Code. */
const FOLD_COMMANDS: Record<FoldAction, FoldCommand> = {
  open: { command: 'editor.unfold', args: levels },
  openRecursive: { command: 'editor.unfoldRecursively' },
  close: { command: 'editor.fold', args: levels },
  closeRecursive: { command: 'editor.foldRecursively' },
  toggle: { command: 'editor.toggleFold' },
  toggleRecursive: { command: 'editor.toggleFoldRecursively' },
  openAll: { command: 'editor.unfoldAll' },
  closeAll: { command: 'editor.foldAll' },
  create: { command: 'editor.createFoldingRangeFromSelection', usesSelection: true },
  delete: { command: 'editor.removeManualFoldingRanges', usesSelection: true },
  next: { command: 'editor.gotoNextFold', movesCursor: true },
  previous: { command: 'editor.gotoPreviousFold', movesCursor: true },
  parent: { command: 'editor.gotoParentFold', movesCursor: true },
};

/** Every VS Code command the fold keys use (checked by the health report and tests). */
export const FOLD_COMMAND_IDS = [...new Set(Object.values(FOLD_COMMANDS).map((c) => c.command))];

/**
 * Folding with Neovim keys. VS Code owns the folds: `zc`, `zo`, `za`, `zR`, `zM`,
 * `zj`… run VS Code's fold commands, and the lines hidden by collapsed folds are
 * reported to Neovim so `j`/`k` step over them.
 */
class FoldingFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly log;
  /** Last hidden ranges sent per buffer, so unchanged views aren't resent. */
  private readonly sent = new Map<number, string>();

  constructor(private readonly ctx: FeatureContext) {
    this.log = scopedLogger(ctx.logger, 'folding');
    const { session } = ctx;
    const d = this.disposables;
    session.callAsync('codevim.fold', 'enable');
    d.add(toDisposable(() => session.callAsync('codevim.fold', 'disable')));
    d.add(session.lua.on('fold', (p) => void this.run(p)));
    d.add(vscode.window.onDidChangeTextEditorVisibleRanges((e) => this.syncHidden(e.textEditor)));
    d.add(vscode.window.onDidChangeActiveTextEditor((e) => e && this.syncHidden(e)));
    d.add(ctx.documents.onDidBind((b) => vscode.window.visibleTextEditors.filter((e) => e.document === b.document).forEach((e) => this.syncHidden(e))));
  }

  private async run(p: FoldPayload): Promise<void> {
    const fold = FOLD_COMMANDS[p.action];
    const binding = this.ctx.documents.getByBuf(p.buf);
    const editor = vscode.window.activeTextEditor;
    if (!fold || !binding || editor?.document !== binding.document) return;
    await binding.whenSynced();
    if (fold.usesSelection) {
      const [first, last] = p.vline === undefined ? [p.line, p.line] : [Math.min(p.line, p.vline), Math.max(p.line, p.vline)];
      editor.selection = new vscode.Selection(first, 0, last, editor.document.lineAt(last).text.length);
    } else if (editor.selection.active.line !== p.line) {
      // Fold commands act on the VS Code cursor; make sure it is on Neovim's line.
      editor.selection = new vscode.Selection(p.line, 0, p.line, 0);
    }
    try {
      await vscode.commands.executeCommand(fold.command, fold.args?.(p));
    } catch (err) {
      this.log.warn(`${fold.command} failed: ${String(err)}`);
    }
    if (fold.usesSelection && p.vline !== undefined) {
      this.ctx.session.input('<Esc>');
    }
    if (fold.movesCursor) {
      const pos = editor.selection.active;
      this.ctx.session.callAsync('codevim.cursor', 'set_cursor', [binding.buf, pos.line, pos.character]);
    }
  }

  private syncHidden(editor: vscode.TextEditor): void {
    const binding = this.ctx.documents.get(editor.document);
    if (!binding || binding.isForeign) return;
    const hidden = hiddenLines(editor.visibleRanges.map((r) => ({ start: r.start.line, end: r.end.line })));
    const key = JSON.stringify(hidden);
    if (this.sent.get(binding.buf) === key) return;
    this.sent.set(binding.buf, key);
    this.ctx.session.callAsync('codevim.fold', 'set_hidden', [binding.buf, hidden]);
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const foldingFeature: FeatureDefinition = {
  id: 'folding',
  description: 'Fold keys (zc, zo, za, zR, zM, zj…) drive VS Code folding; j/k step over collapsed folds.',
  create: (ctx) => new FoldingFeature(ctx),
};
