import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Disposable, toDisposable } from '../core/disposable';
import { Emitter, EventBus } from '../core/events';
import { Logger } from '../core/logger';
import { ModeState } from '../core/mode';
import { BufLinesEvent, LuaEvents, LuaRequests, RuntimeSetupOptions, WindowPayload } from './protocol';
import { parseRedraw, RedrawEvent } from './redraw';
import { RpcClient } from './rpc';

export interface SessionOptions {
  nvimPath: string;
  nvimArgs: string[];
  appName?: string;
  cwd?: string;
  /** Directory containing bootstrap.lua and lua/. */
  runtimeDir: string;
  setup: RuntimeSetupOptions;
  width: number;
  height: number;
  /** How long to wait for VimEnter (your config) before giving up. */
  startupTimeoutMs?: number;
  logger: Logger;
  /** Reports startup stages ("loading your config"…) for a progress indicator. */
  onProgress?: (stage: string) => void;
}

export interface NvimVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface SessionEvents {
  redraw: RedrawEvent[];
  bufLines: BufLinesEvent;
  bufDetach: { buf: number };
}

type LuaRequestHandler<K extends keyof LuaRequests> = (
  params: LuaRequests[K]['params'],
) => LuaRequests[K]['result'] | Promise<LuaRequests[K]['result']>;

const MIN_VERSION = { major: 0, minor: 10 };

/**
 * A running, attached Neovim instance.
 *
 * Owns the process and RPC channel, bootstraps the Lua runtime before your config
 * loads, and turns incoming traffic into typed events and request handlers.
 */
export class NvimSession implements Disposable {
  readonly bus = new EventBus<SessionEvents>();
  readonly lua = new EventBus<LuaEvents>();
  readonly mode = new ModeState();

  /** Your config did not finish loading (VimEnter) within the startup timeout. */
  startupTimedOut = false;

  /** Time of the last key sent to Neovim (used to attribute cursor moves). */
  lastInputAt = 0;

  /** The last reported current window (what Neovim's focus is on). */
  window: WindowPayload | undefined;
  private readonly windowEmitter = new Emitter<WindowPayload>();
  readonly onDidChangeWindow = this.windowEmitter.event;

  private readonly requestHandlers = new Map<string, (params: never) => unknown>();
  /** See {@link redrawSnapshot}. Insertion order keeps mode_info_set before mode_change. */
  private readonly redrawState = new Map<string, RedrawEvent>();
  private readonly hlDefs = new Map<number, RedrawEvent>();
  private readonly exitEmitter = new Emitter<number | null>();
  readonly onDidExit = this.exitEmitter.event;
  private disposed = false;
  private uiSize: { width: number; height: number };

  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    readonly rpc: RpcClient,
    readonly channel: number,
    readonly version: NvimVersion,
    private readonly logger: Logger,
    size: { width: number; height: number },
  ) {
    this.uiSize = size;
    rpc.onNotification(({ method, params }) => this.onNotification(method, params));
    rpc.setRequestHandler((method, params) => this.onRequest(method, params));
    this.lua.on('mode', (p) => this.mode.update(p.mode));
    this.lua.on('window', (p) => {
      this.window = p;
      this.windowEmitter.fire(p);
    });
    proc.on('exit', (code) => {
      logger.info(`nvim exited (code ${code})`);
      rpc.close();
      if (!this.disposed) {
        this.exitEmitter.fire(code);
      }
    });
  }

  static async start(opts: SessionOptions): Promise<NvimSession> {
    const { logger } = opts;
    opts.onProgress?.('starting Neovim');
    const env = { ...process.env };
    if (opts.appName) {
      env.NVIM_APPNAME = opts.appName;
    }
    logger.info(`starting ${opts.nvimPath} ${['--embed', ...opts.nvimArgs].join(' ')}`);
    const proc = spawn(opts.nvimPath, ['--embed', ...opts.nvimArgs], {
      cwd: opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : undefined,
      env,
      windowsHide: true,
    });
    const spawnError = new Promise<never>((_, reject) => {
      proc.once('error', (err) => reject(new Error(`could not start Neovim (${opts.nvimPath}): ${err.message}`)));
    });
    proc.stderr.on('data', (d: Buffer) => logger.warn(`nvim stderr: ${d.toString().trim()}`));

    const rpc = new RpcClient(proc.stdin, proc.stdout, logger);
    try {
      const [channel, apiInfo] = await Promise.race([
        rpc.request<[number, { version: NvimVersion }]>('nvim_get_api_info'),
        spawnError,
      ]);
      const v = apiInfo.version;
      logger.info(`connected to Neovim ${v.major}.${v.minor}.${v.patch} on channel ${channel}`);
      if (v.major === MIN_VERSION.major && v.minor < MIN_VERSION.minor) {
        throw new Error(`CodeVim needs Neovim ${MIN_VERSION.major}.${MIN_VERSION.minor}+, found ${v.major}.${v.minor}`);
      }

      const session = new NvimSession(proc, rpc, channel, v, logger, { width: opts.width, height: opts.height });
      const ready = new Promise<void>((resolve) => {
        const sub = session.lua.on('ready', () => {
          sub.dispose();
          resolve();
        });
      });

      const bootstrap = fs.readFileSync(path.join(opts.runtimeDir, 'bootstrap.lua'), 'utf8');
      const runtimeDir = opts.runtimeDir.replace(/\\/g, '/');
      await rpc.request('nvim_exec_lua', [bootstrap, [runtimeDir, channel, opts.setup]]);

      // With --embed, Neovim sources your config only after the UI attaches.
      opts.onProgress?.('loading your config');
      await rpc.request('nvim_ui_attach', [
        opts.width,
        opts.height,
        { rgb: true, ext_linegrid: true, ext_cmdline: true, ext_messages: true, ext_popupmenu: true },
      ]);

      const timeout = opts.startupTimeoutMs ?? 15000;
      const timedOut = await Promise.race([
        ready.then(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(true), timeout)),
      ]);
      if (timedOut) {
        session.startupTimedOut = true;
        logger.warn(`Neovim did not finish startup within ${timeout}ms; continuing anyway`);
      }
      return session;
    } catch (err) {
      proc.kill();
      throw err;
    }
  }

  /**
   * Neovim's focus is in a plugin window (a float such as telescope, or a special
   * buffer not yet shown as an editor): every key must go to Neovim.
   */
  get pluginFocused(): boolean {
    const w = this.window;
    return !!w && (w.is_float || w.kind === 'special');
  }

  get isAlive(): boolean {
    return !this.disposed && !this.rpc.isClosed;
  }

  request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    return this.rpc.request<T>(method, params);
  }

  notify(method: string, params: unknown[] = []): void {
    this.rpc.notify(method, params);
  }

  /** Calls `require(module)[fn](...args)` and returns its result. */
  call<T = unknown>(module: string, fn: string, args: unknown[] = []): Promise<T> {
    return this.rpc.request<T>('nvim_exec_lua', [`return require('${module}').${fn}(...)`, args]);
  }

  /** Fire-and-forget variant of {@link call}; errors arrive as nvim_error_event. */
  callAsync(module: string, fn: string, args: unknown[] = []): void {
    this.logger.trace(`call ${module}.${fn} ${JSON.stringify(args).slice(0, 200)}`);
    this.rpc.notify('nvim_exec_lua', [`require('${module}').${fn}(...)`, args]);
  }

  /** Sends keys (in <key> notation) as if typed. */
  input(keys: string): void {
    this.lastInputAt = Date.now();
    this.rpc.notify('nvim_input', [keys]);
  }

  resize(width: number, height: number): void {
    width = Math.max(20, Math.floor(width));
    height = Math.max(5, Math.floor(height));
    if (width === this.uiSize.width && height === this.uiSize.height) {
      return;
    }
    this.uiSize = { width, height };
    this.rpc.notify('nvim_ui_try_resize', [width, height]);
  }

  get size(): { width: number; height: number } {
    return this.uiSize;
  }

  handleRequest<K extends keyof LuaRequests>(method: K, handler: LuaRequestHandler<K>): Disposable {
    this.requestHandlers.set(method, handler as (params: never) => unknown);
    return toDisposable(() => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method);
      }
    });
  }

  /**
   * Redraw events that set state Neovim sends only once: highlight definitions (sent
   * when an id is first used), default colours, cursor shapes and the grid size.
   * Features start after your config has drawn the first screens, so they replay
   * these with {@link redrawSnapshot} or would draw with missing highlights.
   */
  redrawSnapshot(): RedrawEvent[] {
    return [...this.redrawState.values(), ...this.hlDefs.values()];
  }

  private recordRedrawState(events: RedrawEvent[]): void {
    for (const e of events) {
      switch (e.name) {
        case 'hl_attr_define':
          this.hlDefs.set(e.args[0] as number, e);
          break;
        case 'default_colors_set':
        case 'mode_info_set':
        case 'mode_change':
        case 'grid_resize':
          this.redrawState.set(e.name, e);
          break;
      }
    }
  }

  private onNotification(method: string, params: unknown[]): void {
    switch (method) {
      case 'redraw': {
        const events = parseRedraw(params);
        this.recordRedrawState(events);
        this.bus.emit('redraw', events);
        return;
      }
      case 'nvim_buf_lines_event': {
        const [buf, changedtick, first, last, lines, more] = params as [number, number, number, number, string[], boolean];
        this.bus.emit('bufLines', { buf, changedtick, first, last, lines, more });
        return;
      }
      case 'nvim_buf_detach_event':
        this.bus.emit('bufDetach', { buf: params[0] as number });
        return;
      case 'codevim': {
        const [name, payload] = params as [keyof LuaEvents, never];
        this.logger.trace(`lua event ${String(name)} ${JSON.stringify(payload)}`);
        this.lua.emit(name, payload);
        return;
      }
      case 'nvim_error_event':
        this.logger.error(`nvim error: ${String(params[1])}`);
        return;
    }
  }

  private async onRequest(method: string, params: unknown[]): Promise<unknown> {
    if (method !== 'codevim_request') {
      throw new Error(`unknown request ${method}`);
    }
    const [name, payload] = params as [string, never];
    this.logger.trace(`lua request ${name} ${JSON.stringify(payload)}`);
    const handler = this.requestHandlers.get(name);
    if (!handler) {
      throw new Error(`CodeVim: no handler for '${name}'`);
    }
    return handler(payload);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.bus.dispose();
    this.lua.dispose();
    this.mode.dispose();
    this.exitEmitter.dispose();
    this.windowEmitter.dispose();
    try {
      this.rpc.notify('nvim_command', ['qa!']);
    } catch {
      // ignore
    }
    this.rpc.close();
    setTimeout(() => {
      if (this.proc.exitCode === null) {
        this.proc.kill();
      }
    }, 500);
  }
}
