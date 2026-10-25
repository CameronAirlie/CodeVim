import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { parseMode } from '../core/mode';
import { CursorPayload } from '../nvim/protocol';
import { cursorToSelections, PlainSelection } from '../sync/selection';
import { charLengthAt } from '../sync/positions';
import { FeatureContext, FeatureDefinition } from './feature';

const PENDING_TTL_MS = 3000;
const INPUT_ATTRIBUTION_MS = 1000;

function toSelection(s: PlainSelection): vscode.Selection {
  return new vscode.Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character);
}

function sameSelections(a: readonly vscode.Selection[], b: readonly vscode.Selection[]): boolean {
  return a.length === b.length && a.every((s, i) => s.isEqual(b[i]) && s.anchor.isEqual(b[i].anchor));
}

/**
 * Keeps the VS Code cursor/selection and Neovim's cursor/visual selection in sync.
 *
 * Neovim is the authority except while VS Code handles insert-mode typing, where
 * VS Code is (and Neovim is updated lazily, before keys are sent to it).
 */
class CursorFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  /** Recent selections we set ourselves, so the resulting change events are not echoed back. */
  private readonly applied = new WeakMap<vscode.TextEditor, (readonly vscode.Selection[])[]>();
  /** Cursor updates for buffers that had no visible editor yet (Neovim switched files). */
  private readonly pending = new Map<number, { payload: CursorPayload; at: number }>();
  private readonly latest = new Map<number, CursorPayload>();

  constructor(private readonly ctx: FeatureContext) {
    const d = this.disposables;
    d.add(ctx.session.lua.on('cursor', (p) => void this.onNvimCursor(p, false)));
    // Mode changes caused by our own requests (e.g. starting visual mode from a VS Code
    // selection) pass through intermediate states that VS Code must not show.
    d.add(ctx.session.lua.on('mode', (p) => p.cursor && !p.internal && void this.onNvimCursor(p.cursor, true)));
    d.add(vscode.window.onDidChangeTextEditorSelection((e) => this.onVscodeSelection(e)));
    d.add(vscode.window.onDidChangeActiveTextEditor((e) => e && this.applyPending(e)));
  }

  private shouldApply(p: CursorPayload, fromModeChange: boolean): boolean {
    const mode = parseMode(p.mode);
    if (!mode.isInsertLike || this.ctx.config.current.insertStrategy === 'neovim' || mode.kind === 'replace') {
      return true;
    }
    const editor = vscode.window.activeTextEditor;
    if (fromModeChange) {
      // Entering insert mode with several VS Code cursors: keep them (multi-cursor insert).
      return !(editor && editor.selections.length > 1);
    }
    // In VS Code-typed insert mode only accept moves caused by keys we sent to Neovim
    // (e.g. <C-w>, <C-o>) and not superseded by later typing in VS Code.
    const binding = this.ctx.documents.getByBuf(p.buf);
    const sinceInput = Date.now() - this.ctx.session.lastInputAt;
    return sinceInput < INPUT_ATTRIBUTION_MS && this.ctx.session.lastInputAt > (binding?.lastVscodeEditAt ?? 0);
  }

  private async onNvimCursor(p: CursorPayload, fromModeChange: boolean): Promise<void> {
    if (!this.shouldApply(p, fromModeChange)) {
      return;
    }
    this.latest.set(p.buf, p);
    const binding = this.ctx.documents.getByBuf(p.buf);
    if (!binding) {
      this.pending.set(p.buf, { payload: p, at: Date.now() });
      return;
    }
    await binding.whenSynced();
    if (this.latest.get(p.buf) !== p) {
      return; // a newer position arrived meanwhile
    }
    const editor = this.editorFor(binding.document);
    if (!editor) {
      this.pending.set(p.buf, { payload: p, at: Date.now() });
      return;
    }
    this.pending.delete(p.buf);
    this.apply(editor, p);
  }

  private editorFor(doc: vscode.TextDocument): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active?.document === doc) return active;
    return vscode.window.visibleTextEditors.find((e) => e.document === doc);
  }

  private apply(editor: vscode.TextEditor, p: CursorPayload): void {
    const doc = editor.document;
    const selections = cursorToSelections(p, (l) => doc.lineAt(l).text, doc.lineCount).map(toSelection);
    if (sameSelections(editor.selections, selections)) {
      return;
    }
    const recent = this.applied.get(editor) ?? [];
    recent.push(selections);
    if (recent.length > 8) recent.shift();
    this.applied.set(editor, recent);
    editor.selections = selections;
    const active = selections[0].active;
    if (!editor.visibleRanges.some((r) => r.contains(active))) {
      editor.revealRange(new vscode.Range(active, active), vscode.TextEditorRevealType.Default);
    }
  }

  private applyPending(editor: vscode.TextEditor): void {
    const binding = this.ctx.documents.get(editor.document);
    if (!binding) return;
    const entry = this.pending.get(binding.buf);
    this.pending.delete(binding.buf);
    if (entry && Date.now() - entry.at < PENDING_TTL_MS) {
      // Always the newest known position, never one superseded meanwhile.
      void binding.whenSynced().then(() => this.apply(editor, this.latest.get(binding.buf) ?? entry.payload));
    }
  }

  private onVscodeSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    const editor = e.textEditor;
    const recent = this.applied.get(editor);
    const idx = recent?.findIndex((sels) => sameSelections(sels, e.selections)) ?? -1;
    if (recent && idx >= 0) {
      recent.splice(0, idx + 1);
      return;
    }
    if (editor !== vscode.window.activeTextEditor) return;
    // No kind: the initial selection of a newly opened editor. Neovim already has the
    // right cursor (e.g. after :e, a telescope pick or :help tag).
    if (e.kind === undefined) return;
    const binding = this.ctx.documents.get(editor.document);
    if (!binding) return;
    if (this.ctx.session.pluginFocused) {
      // Clicking the editor while a float (e.g. telescope) is focused leaves it.
      if (e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
        const pos = e.selections[0].active;
        this.ctx.session.callAsync('codevim.window', 'focus', [{ buf: binding.buf, line: pos.line, col16: pos.character }]);
      }
      return;
    }
    const mode = this.ctx.session.mode.current;
    if (mode.kind === 'cmdline' || (mode.kind === 'insert' && this.ctx.config.current.insertStrategy === 'vscode')) {
      return; // VS Code owns the cursor; Neovim is updated lazily.
    }
    if (e.selections.length > 1) {
      return; // VS Code multi-cursor: leave it to VS Code until insert mode.
    }
    const sel = e.selections[0];
    if (sel.isEmpty) {
      this.ctx.session.callAsync('codevim.cursor', 'set_cursor', [binding.buf, sel.active.line, sel.active.character]);
      return;
    }
    if (mode.isInsertLike) return;
    // Mouse drag, double-click, shift+arrows, "expand selection"… → visual mode.
    const doc = editor.document;
    let end = sel.end;
    // VS Code's end is exclusive, Neovim's is inclusive.
    if (end.character > 0) {
      end = end.translate(0, -1);
    } else if (end.line > sel.start.line) {
      const prev = doc.lineAt(end.line - 1).text;
      end = new vscode.Position(end.line - 1, Math.max(0, prev.length - (prev.length > 0 ? charLengthAt(prev, prev.length - 1) : 0)));
    }
    const [from, to] = sel.isReversed ? [end, sel.start] : [sel.start, end];
    this.ctx.session.callAsync('codevim.cursor', 'select', [binding.buf, from.line, from.character, to.line, to.character]);
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const cursorFeature: FeatureDefinition = {
  id: 'cursor',
  description: 'Synchronises cursors and visual selections in both directions.',
  required: true,
  create: (ctx) => new CursorFeature(ctx),
};
