import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NvimSession } from '../../src/nvim/session';
import { attach, nextLua, startSession } from './helpers';

const tmp = (name: string) => path.join(os.tmpdir(), `codevim-test-${process.pid}-${name}`);

describe('languageFeatures: "vscode"', () => {
  let s: NvimSession;

  beforeEach(async () => {
    s = await startSession({ language_features: 'vscode' });
  });
  afterEach(() => s.dispose());

  it('keeps Neovim LSP clients out of documents', async () => {
    const buf = await attach(s, tmp('lsp.lua'), ['local x = 1']);
    const r = await s.request('nvim_exec_lua', [
      "return vim.lsp.start({ name = 'fake', cmd = { 'does-not-exist' } }, { bufnr = ... }) == nil",
      [buf],
    ]);
    expect(r).toBe(true);
  });

  it('runs VS Code commands for vim.lsp.buf, vim.diagnostic and K', async () => {
    await attach(s, tmp('cmds.lua'), ['local x = 1']);
    let action = nextLua(s, 'action');
    await s.request('nvim_exec_lua', ['vim.lsp.buf.definition()', []]);
    expect(await action).toMatchObject({ name: 'editor.action.revealDefinition' });

    action = nextLua(s, 'action');
    await s.request('nvim_exec_lua', ['vim.diagnostic.jump({ count = -1 })', []]);
    expect(await action).toMatchObject({ name: 'editor.action.marker.prev' });

    action = nextLua(s, 'action');
    s.input('K');
    expect(await action).toMatchObject({ name: 'editor.action.showHover' });
  });

  it('turns completion plugins off in documents', async () => {
    const buf = await attach(s, tmp('cmp.lua'), ['x']);
    s.input('i');
    await nextLua(s, 'mode', (p) => p.mode === 'i');
    expect(await s.request('nvim_exec_lua', ['return { vim.b[...].completion, vim.b[...].minicompletion_disable }', [buf]])).toEqual([false, true]);
  });

  it('leaves plugin buffers alone', async () => {
    await s.request('nvim_command', ['help']);
    expect(await s.request('nvim_exec_lua', ['return vim.b.completion', []])).toBeNull();
  });
});
