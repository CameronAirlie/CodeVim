import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposable';
import { scopedLogger } from '../core/logger';
import { CommandPayload, EvalPayload } from '../nvim/protocol';
import { FeatureContext, FeatureDefinition } from './feature';

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/** Makes a value safe to send over msgpack (plain JSON data only). */
export function toPlain(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value, (_k, v) => (v === undefined ? null : v))) ?? null;
  } catch {
    return String(value);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number | undefined): Promise<T> {
  if (!ms || ms <= 0) return p;
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))]);
}

const LOG_LEVELS = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };

/**
 * The Lua → VS Code bridge behind `require('vscode')`: run commands, evaluate JS,
 * read/update settings, notifications and the clipboard provider.
 */
class BridgeFeature implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly log;

  constructor(private readonly ctx: FeatureContext) {
    this.log = scopedLogger(ctx.logger, 'bridge');
    const { session } = ctx;
    const d = this.disposables;
    d.add(session.handleRequest('call', (p) => this.runCommand(p)));
    d.add(session.handleRequest('eval', (p) => this.evaluate(p)));
    d.add(session.lua.on('action', (p) => void this.runAsync(p.callback, () => this.runCommand(p))));
    d.add(session.lua.on('eval_async', (p) => void this.runAsync(p.callback, () => this.evaluate(p))));
    d.add(session.handleRequest('get_config', (p) => toPlain(vscode.workspace.getConfiguration().get(p.name))));
    d.add(session.handleRequest('has_config', (p) => vscode.workspace.getConfiguration().has(p.name)));
    d.add(session.lua.on('update_config', (p) => {
      const target = p.target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      void vscode.workspace.getConfiguration().update(p.name, p.value, target);
    }));
    d.add(session.lua.on('notify', (p) => this.notify(p.msg, p.level)));
    d.add(session.handleRequest('clipboard_get', async () => {
      const text = (await vscode.env.clipboard.readText()).replace(/\r\n/g, '\n');
      const linewise = text.endsWith('\n');
      const lines = (linewise ? text.slice(0, -1) : text).split('\n');
      return { lines, regtype: linewise ? 'V' : 'v' };
    }));
    d.add(session.lua.on('clipboard_set', (p) => {
      // Linewise yanks arrive with a trailing '' element, i.e. the text ends in a newline.
      let text = p.lines.join('\n');
      if (p.regtype === 'V' && !text.endsWith('\n')) text += '\n';
      void vscode.env.clipboard.writeText(text);
    }));
  }

  private async runAsync(callback: number | undefined, fn: () => Promise<unknown>): Promise<void> {
    let err: string | null = null;
    let result: unknown = null;
    try {
      result = await fn();
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      if (!callback) this.log.warn(err);
    }
    if (callback) {
      this.ctx.session.callAsync('vscode', '_resolve', [callback, err, result]);
    }
  }

  private async runCommand(p: CommandPayload): Promise<unknown> {
    const editor = vscode.window.activeTextEditor;
    let restore: readonly vscode.Selection[] | undefined;
    if (p.range && editor) {
      restore = p.restore_selection === false ? undefined : editor.selections;
      editor.selections = [this.rangeToSelection(editor, p.range)];
    }
    try {
      const result = await withTimeout(Promise.resolve(vscode.commands.executeCommand(p.name, ...(p.args ?? []))), p.timeout);
      return toPlain(result);
    } finally {
      if (restore && editor) editor.selections = restore;
    }
  }

  private rangeToSelection(editor: vscode.TextEditor, range: number[]): vscode.Selection {
    const doc = editor.document;
    if (range.length >= 4) {
      return new vscode.Selection(range[0], range[1], range[2], range[3]);
    }
    const end = Math.min(range[1] ?? range[0], doc.lineCount - 1);
    return new vscode.Selection(range[0], 0, end, doc.lineAt(end).text.length);
  }

  private async evaluate(p: EvalPayload): Promise<unknown> {
    // Runs code from your own Neovim config, with the same trust as the config itself.
    const fn = new AsyncFunction('vscode', 'args', p.code);
    return toPlain(await withTimeout(fn(vscode, p.args), p.timeout));
  }

  private notify(msg: string, level: number): void {
    if (level >= LOG_LEVELS.ERROR) void vscode.window.showErrorMessage(msg);
    else if (level >= LOG_LEVELS.WARN) void vscode.window.showWarningMessage(msg);
    else void vscode.window.showInformationMessage(msg);
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

export const bridgeFeature: FeatureDefinition = {
  id: 'bridge',
  description: "require('vscode') API: commands, eval, settings, notifications and clipboard.",
  required: true,
  create: (ctx) => new BridgeFeature(ctx),
};
