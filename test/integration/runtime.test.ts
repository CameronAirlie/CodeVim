import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NvimSession } from '../../src/nvim/session';
import { attach, lines, nextLua, sleep, startSession, waitForMode } from './helpers';

const tmp = (name: string) => path.join(os.tmpdir(), `codevim-test-${process.pid}-${name}`);

describe('Lua runtime against a real Neovim', () => {
  let s: NvimSession;

  beforeEach(async () => {
    s = await startSession();
  });
  afterEach(() => s.dispose());

  it('bootstraps before the config: globals and modules exist', async () => {
    const r = await s.request<[number, number, string, string]>('nvim_exec_lua', [
      "return { vim.g.codevim, vim.g.vscode, type(require('vscode').action), vim.o.inccommand }",
      [],
    ]);
    expect(r).toEqual([1, 1, 'function', '']);
  });

  it('creates buffers with filetype detection and no undo history', async () => {
    const buf = await attach(s, tmp('a.lua'), ['local x = 1', 'return x']);
    const r = await s.request<[string, number, string]>('nvim_exec_lua', [
      'local b = ...; return { vim.bo[b].filetype, vim.fn.undotree(b).seq_last, vim.b[b].codevim_uri }',
      [buf],
    ]);
    expect(r[0]).toBe('lua');
    expect(r[1]).toBe(0);
    expect(r[2]).toContain('a.lua');
  });

  it('applies VS Code edits with UTF-16 columns', async () => {
    const buf = await attach(s, tmp('u.txt'), ['héllo 😀 world', 'second']);
    // "world" starts at UTF-16 column 9 (é=1 unit, 😀=2 units).
    await s.call('codevim.buffer', 'apply_edits', [buf, [[0, 9, 0, 14, 'there'], [0, 0, 0, 1, 'H']], false]);
    expect(await lines(s, buf)).toEqual(['Héllo 😀 there', 'second']);
    await s.call('codevim.buffer', 'apply_edits', [buf, [[0, 14, 1, 0, '\nnew line\n']], false]);
    expect(await lines(s, buf)).toEqual(['Héllo 😀 there', 'new line', 'second']);
  });

  it('streams buffer changes through nvim_buf_attach', async () => {
    const buf = await attach(s, tmp('stream.txt'), ['one', 'two', 'three']);
    const events: unknown[] = [];
    s.bus.on('bufLines', (e) => events.push(e));
    await s.request('nvim_buf_attach', [buf, true, {}]);
    await sleep(50);
    s.input('jdd');
    await sleep(150);
    expect(events[0]).toMatchObject({ first: 0, last: -1, lines: ['one', 'two', 'three'] });
    expect(events[1]).toMatchObject({ first: 1, last: 2, lines: [] });
  });

  it('joins an insert session into one undo step', async () => {
    const buf = await attach(s, tmp('undo.txt'), ['abc']);
    s.input('A');
    await waitForMode(s, 'i');
    await s.call('codevim.buffer', 'apply_edits', [buf, [[0, 3, 0, 3, 'd']], false]);
    await s.call('codevim.buffer', 'apply_edits', [buf, [[0, 4, 0, 4, 'e']], true]);
    await s.call('codevim.buffer', 'apply_edits', [buf, [[0, 5, 0, 5, 'f']], true]);
    s.input('<Esc>');
    await waitForMode(s, 'n');
    expect(await lines(s, buf)).toEqual(['abcdef']);
    s.input('u');
    await sleep(100);
    expect(await lines(s, buf)).toEqual(['abc']);
  });

  it('replays VS Code typing on escape so `.` repeats it', async () => {
    const buf = await attach(s, tmp('dot.txt'), ['abc', 'abc']);
    s.input('i');
    await waitForMode(s, 'i');
    await s.call('codevim.buffer', 'apply_edits', [buf, [[0, 0, 0, 0, 'XY']], false]);
    await s.call('codevim.buffer', 'escape', [{ buf, line: 0, col16: 2, replay: { line: 0, col16: 0, text: 'XY' } }]);
    await waitForMode(s, 'n');
    expect(await lines(s, buf)).toEqual(['XYabc', 'abc']);
    s.input('j0.');
    await sleep(150);
    expect(await lines(s, buf)).toEqual(['XYabc', 'XYabc']);
    s.input('uu');
    await sleep(150);
    expect(await lines(s, buf)).toEqual(['abc', 'abc']);
  });

  it('reports mode and cursor changes', async () => {
    await attach(s, tmp('cursor.txt'), ['one', 'two', 'three']);
    const cursor = nextLua(s, 'cursor', (p) => p.line === 2 && p.col === 4);
    s.input('jj$');
    expect(await cursor).toMatchObject({ line: 2, col: 4, mode: 'n' });
    const mode = nextLua(s, 'mode', (p) => p.mode === 'V');
    s.input('Vk');
    expect(await mode).toMatchObject({ mode: 'V', old: 'n' });
    const visual = await nextLua(s, 'cursor', (p) => p.line === 1);
    expect(visual).toMatchObject({ mode: 'V', vline: 2 });
  });

  it('starts visual mode from a VS Code selection', async () => {
    const buf = await attach(s, tmp('select.txt'), ['hello world']);
    await s.call('codevim.cursor', 'select', [buf, 0, 6, 0, 10]);
    const r = await s.request<[string, number, number]>('nvim_exec_lua', ["return { vim.fn.mode(), vim.fn.getpos('v')[3], vim.fn.col('.') }", []]);
    expect(r).toEqual(['v', 7, 11]);
    s.input('y');
    await sleep(100);
    expect(await s.request('nvim_exec_lua', ["return vim.fn.getreg('\"')", []])).toBe('world');
  });

  it('classifies buffers in window reports', async () => {
    await attach(s, tmp('win.txt'), ['x']);
    const help = nextLua(s, 'window', (p) => p.kind === 'special');
    s.input(':help<CR>');
    expect(await help).toMatchObject({ kind: 'special', buftype: 'help', windows: 2 });
    s.input(':only<CR>:enew<CR>');
    expect(await nextLua(s, 'window', (p) => p.kind === 'scratch')).toMatchObject({ kind: 'scratch' });
    const file = tmp('other.txt');
    s.input(`:e ${file.replace(/\\/g, '/')}<CR>`);
    expect(await nextLua(s, 'window', (p) => p.kind === 'file')).toMatchObject({ kind: 'file' });
  });

  it('reports float geometry including borders', async () => {
    await attach(s, tmp('float.txt'), ['x']);
    const report = nextLua(s, 'window', (p) => p.is_float);
    await s.request('nvim_exec_lua', [
      "local b = vim.api.nvim_create_buf(false, true); vim.api.nvim_open_win(b, true, { relative = 'editor', row = 3, col = 5, width = 10, height = 2, border = 'rounded', zindex = 70 })",
      [],
    ]);
    const p = await report;
    expect(p.floats).toHaveLength(1);
    expect(p.floats[0]).toMatchObject({ row: 3, col: 5, width: 12, height: 4, zindex: 70, focusable: true });
  });

  it('adopts plugin buffers without touching them', async () => {
    s.input(':help<CR>');
    const help = await nextLua(s, 'window', (p) => p.buftype === 'help');
    await s.call('codevim.buffer', 'attach', [{ uri: 'codevim-buffer:/x', name: 'x', buf: help.buf, lines: [], foreign: true }]);
    const r = await s.request<[string, string, boolean]>('nvim_exec_lua', [
      'local b = ...; return { vim.bo[b].buftype, vim.b[b].codevim_uri, vim.bo[b].buflisted }',
      [help.buf],
    ]);
    expect(r).toEqual(['help', 'codevim-buffer:/x', false]);
    // Detaching closes its window again instead of leaving it around.
    await s.call('codevim.buffer', 'detach', [help.buf]);
    expect(await s.request('nvim_exec_lua', ["return #vim.api.nvim_tabpage_list_wins(0)", []])).toBe(1);
  });

  it('routes :w to VS Code and keeps Neovim alive on :q', async () => {
    const buf = await attach(s, tmp('save.txt'), ['x']);
    let saved: unknown;
    s.handleRequest('save', (p) => {
      saved = p;
      return true;
    });
    await s.call('codevim.buffer', 'apply_edits', [buf, [[0, 0, 0, 0, 'y']], false]);
    s.input(':w<CR>');
    await sleep(150);
    expect(saved).toMatchObject({ buf });
    expect(await s.request('nvim_exec_lua', ['return vim.bo[...].modified', [buf]])).toBe(false);

    const quit = nextLua(s, 'quit');
    s.input(':q<CR>');
    expect(await quit).toMatchObject({ bang: false, all: false });
    s.input(':qa!<CR>');
    await sleep(150);
    expect(s.isAlive).toBe(true);
  });

  it('maps <C-w> commands to VS Code actions', async () => {
    await attach(s, tmp('wincmd.txt'), ['x']);
    const action = nextLua(s, 'action');
    s.input('<C-w>l');
    expect(await action).toMatchObject({ name: 'workbench.action.focusRightGroup' });
  });

  it('provides the clipboard through VS Code', async () => {
    await attach(s, tmp('clip.txt'), ['copy me']);
    s.handleRequest('clipboard_get', () => ({ lines: ['pasted'], regtype: 'v' }));
    const set = nextLua(s, 'clipboard_set');
    s.input('"+yy');
    expect(await set).toMatchObject({ lines: ['copy me', ''], regtype: 'V' });
    s.input('$"+p');
    await sleep(150);
    expect(await s.request('nvim_get_current_line')).toBe('copy mepasted');
  });

  it("answers require('vscode').call/eval through requests", async () => {
    s.handleRequest('call', (p) => ({ ran: p.name, args: p.args }));
    s.handleRequest('eval', (p) => `evaluated ${p.code}`);
    const r = await s.request('nvim_exec_lua', [
      "local v = require('vscode'); return { v.call('x.y', { args = 3 }), v.eval('1+1') }",
      [],
    ]);
    expect(r).toEqual([{ ran: 'x.y', args: [3] }, 'evaluated 1+1']);
  });

  it('reports search matches', async () => {
    await attach(s, tmp('search.txt'), ['foo bar foo', 'baz foo']);
    const hl = nextLua(s, 'hlsearch', (p) => p.matches.length > 0 && p.matches[0][2] === 3 && !p.current);
    s.input(':set hlsearch<CR>/foo<CR>');
    expect((await hl).matches).toEqual([
      [0, 0, 3],
      [0, 8, 11],
      [1, 4, 7],
    ]);
  });

  it('scrolls the window on set_viewport', async () => {
    const content = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const buf = await attach(s, tmp('viewport.txt'), content);
    await s.call('codevim.state', 'set_viewport', [buf, 50]);
    expect(await s.request('nvim_exec_lua', ["return vim.fn.line('w0')", []])).toBe(51);
    const vp = nextLua(s, 'viewport', (p) => p.top !== 50);
    s.input('gg');
    expect(await vp).toMatchObject({ top: 0 });
  });

  it('focus() switches buffer and records a jump for <C-o>', async () => {
    const a = await attach(s, tmp('ja.txt'), ['a1', 'a2', 'a3']);
    const b = await attach(s, tmp('jb.txt'), ['b1']);
    await s.call('codevim.window', 'focus', [{ buf: a, line: 2, col16: 0 }]);
    await s.call('codevim.window', 'focus', [{ buf: b, line: 0, col16: 0 }]);
    const back = nextLua(s, 'window', (p) => p.buf === a && !p.internal);
    s.input('<C-o>');
    expect(await back).toMatchObject({ buf: a, kind: 'bound' });
  });

  it('block insert typed through VS Code is replicated by Neovim', async () => {
    const buf = await attach(s, tmp('block.txt'), ['aaa', 'bbb', 'ccc']);
    s.input('<C-v>jjI');
    await waitForMode(s, 'i');
    await s.call('codevim.buffer', 'apply_edits', [buf, [[0, 0, 0, 0, 'X']], false]);
    await s.call('codevim.buffer', 'escape', [{ buf, line: 0, col16: 1, replay: { line: 0, col16: 0, text: 'X' } }]);
    await waitForMode(s, 'n');
    expect(await lines(s, buf)).toEqual(['Xaaa', 'Xbbb', 'Xccc']);
  });
});
