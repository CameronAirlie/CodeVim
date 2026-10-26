import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NvimSession } from '../../src/nvim/session';
import { attach, lines, nextLua, sleep, startSession, waitForMode } from './helpers';

const tmp = (name: string) => path.join(os.tmpdir(), `codevim-test-${process.pid}-${name}`);
const cursorLine = async (s: NvimSession) => (await s.request<[number, number]>('nvim_win_get_cursor', [0]))[0] - 1;
const setCursor = (s: NvimSession, line: number) => s.request('nvim_win_set_cursor', [0, [line + 1, 0]]);
const lua = <T>(s: NvimSession, code: string, args: unknown[] = []) => s.request<T>('nvim_exec_lua', [code, args]);

describe('folding, jumplist, undo and health runtime modules', () => {
  let s: NvimSession;

  beforeEach(async () => {
    s = await startSession();
  });
  afterEach(() => s.dispose());

  describe('fold', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `line ${i}`);

    it('j/k step over lines hidden by VS Code folds, with counts', async () => {
      const buf = await attach(s, tmp('fold.txt'), ten);
      await s.call('codevim.fold', 'enable');
      await s.call('codevim.fold', 'set_hidden', [buf, [[2, 4]]]);
      await setCursor(s, 1);
      s.input('j');
      await sleep(50);
      expect(await cursorLine(s)).toBe(5);
      s.input('k');
      await sleep(50);
      expect(await cursorLine(s)).toBe(1);
      await setCursor(s, 0);
      s.input('3j');
      await sleep(50);
      expect(await cursorLine(s)).toBe(6);
      // Keys typed ahead run after the motion, in order.
      await setCursor(s, 1);
      s.input('jjk');
      await sleep(50);
      expect(await cursorLine(s)).toBe(5);
    });

    it('moves normally once nothing is folded', async () => {
      const buf = await attach(s, tmp('nofold.txt'), ten);
      await s.call('codevim.fold', 'enable');
      await s.call('codevim.fold', 'set_hidden', [buf, []]);
      s.input('3j');
      await sleep(50);
      expect(await cursorLine(s)).toBe(3);
    });

    it('sends fold keys to VS Code with the cursor line and count', async () => {
      await attach(s, tmp('zc.txt'), ten);
      await s.call('codevim.fold', 'enable');
      await setCursor(s, 4);
      const fold = nextLua(s, 'fold');
      s.input('2zc');
      expect(await fold).toMatchObject({ action: 'close', line: 4, count: 2 });
      const create = nextLua(s, 'fold');
      s.input('Vjzf');
      expect(await create).toMatchObject({ action: 'create', line: 5, vline: 4 });
    });

    it("turns Neovim's own folds off in document windows", async () => {
      await attach(s, tmp('fe.txt'), ten);
      await s.call('codevim.fold', 'enable');
      expect(await lua<boolean>(s, 'return vim.wo.foldenable')).toBe(false);
    });

    it('leaves keys you mapped yourself alone and reports them', async () => {
      await lua(s, "vim.keymap.set('n', 'zc', '<Nop>')");
      await s.call('codevim.fold', 'enable');
      expect(await lua<string>(s, "return vim.fn.maparg('zc', 'n')")).toBe('<Nop>');
      const report = await s.call<{ level: string; msg: string }[]>('codevim.health', 'report');
      expect(report.some((r) => r.level === 'warn' && r.msg.includes('n zc'))).toBe(true);
    });
  });

  it('jumplist.record() makes <C-o> return to where a VS Code jump started', async () => {
    const buf = await attach(s, tmp('jump.txt'), Array.from({ length: 30 }, (_, i) => `l${i}`));
    await setCursor(s, 3);
    await s.call('codevim.jumplist', 'record', [buf, 3, 0, 25, 0]);
    expect(await cursorLine(s)).toBe(25);
    s.input('<C-o>');
    await sleep(50);
    expect(await cursorLine(s)).toBe(3);
  });

  it('undo.run() undoes and redoes in the given buffer', async () => {
    const buf = await attach(s, tmp('undo2.txt'), ['one']);
    s.input('ddu');
    await waitForMode(s, 'n');
    s.input('<C-r>');
    await sleep(50);
    expect(await lines(s, buf)).toEqual(['']);
    await s.call('codevim.undo', 'run', [buf, false]);
    expect(await lines(s, buf)).toEqual(['one']);
    await s.call('codevim.undo', 'run', [buf, true]);
    expect(await lines(s, buf)).toEqual(['']);
  });

  it('visual blocks reach past the end of shorter lines (virtualedit=block)', async () => {
    expect(await lua<string>(s, 'return vim.o.virtualedit')).toBe('block');
    await attach(s, tmp('vblock.txt'), ['abcdef', 'ab', 'abcdefghij']);
    await setCursor(s, 0);
    const done = nextLua(s, 'cursor', (p) => p.mode === '' && p.past_eol === 3);
    // Columns 4-5 ("de"), down onto "ab": its end is column 2, so the block covers
    // cells 2-3 past it (after a 1-cell gap), with the cursor on cell 3.
    s.input('3l<C-v>jl');
    const p = await done;
    expect(p.line).toBe(1);
    expect(p.block).toEqual([
      [0, 3, 5],
      [1, 2, 2, 1, 2],
    ]);
  });

  it('health.report() describes the connection', async () => {
    const report = await s.call<{ level: string; msg: string }[]>('codevim.health', 'report');
    expect(report[0]).toMatchObject({ level: 'ok' });
    expect(report[0].msg).toContain('Connected to VS Code');
  });
});
