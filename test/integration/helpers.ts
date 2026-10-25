import * as path from 'path';
import { nullLogger } from '../../src/core/logger';
import { LuaEvents } from '../../src/nvim/protocol';
import { NvimSession } from '../../src/nvim/session';

export const RUNTIME_DIR = path.resolve(__dirname, '../../runtime');

export async function startSession(): Promise<NvimSession> {
  return NvimSession.start({
    nvimPath: process.env.NVIM_PATH ?? 'nvim',
    nvimArgs: ['--clean', '-n'],
    runtimeDir: RUNTIME_DIR,
    setup: { vscode_global: true, clipboard: true, notify: true, window_keymaps: true, command_abbreviations: true },
    width: 80,
    height: 24,
    logger: nullLogger,
  });
}

/** Resolves with the next Lua event `name` matching `predicate`. */
export function nextLua<K extends keyof LuaEvents>(
  session: NvimSession,
  name: K,
  predicate: (p: LuaEvents[K]) => boolean = () => true,
  timeoutMs = 3000,
): Promise<LuaEvents[K]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error(`timed out waiting for lua event '${String(name)}'`));
    }, timeoutMs);
    const sub = session.lua.on(name, (p) => {
      if (predicate(p)) {
        clearTimeout(timer);
        sub.dispose();
        resolve(p);
      }
    });
  });
}

export async function waitForMode(session: NvimSession, mode: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = await session.request<{ mode: string; blocking: boolean }>('nvim_get_mode');
    if (m.mode === mode && !m.blocking) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for mode ${mode}`);
}

export async function lines(session: NvimSession, buf: number): Promise<string[]> {
  return session.request<string[]>('nvim_buf_get_lines', [buf, 0, -1, false]);
}

export async function attach(session: NvimSession, name: string, content: string[], extra: Record<string, unknown> = {}): Promise<number> {
  const buf = await session.call<number>('codevim.buffer', 'attach', [
    { uri: 'file:///' + name, name, path: name, lines: content, language_id: 'plaintext', dirty: false, read_autocmds: true, ...extra },
  ]);
  await session.request('nvim_win_set_buf', [0, buf]);
  return buf;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
