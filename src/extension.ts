import * as vscode from 'vscode';
import * as fs from 'fs';
import { ConfigService } from './config';
import { Logger } from './core/logger';
import { runHealthChecks } from './health';
import { renderHealthReport } from './health/report';
import { HealthReportView } from './health/view';
import { Runtime } from './runtime';

const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

function channelLogger(channel: vscode.LogOutputChannel): Logger {
  // CODEVIM_LOG_FILE mirrors everything (including trace) to a file, for debugging.
  const file = process.env.CODEVIM_LOG_FILE;
  const tee = (level: string, m: string | Error) => {
    if (file) fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${m instanceof Error ? m.stack : m}\n`);
  };
  return {
    trace: (m, ...a) => (tee('trace', m), channel.trace(m, ...a)),
    debug: (m, ...a) => (tee('debug', m), channel.debug(m, ...a)),
    info: (m, ...a) => (tee('info', m), channel.info(m, ...a)),
    warn: (m, ...a) => (tee('warn', m), channel.warn(m, ...a)),
    error: (m, ...a) => (tee('error', m), channel.error(m, ...a)),
  };
}
/** Starts, stops and restarts the {@link Runtime}; owns the extension-level commands. */
class Controller implements vscode.Disposable {
  private runtime: Runtime | undefined;
  private starting: Promise<void> | undefined;
  private crashes: number[] = [];
  /** Why the last start failed (reported by "Check Health"). */
  private lastError: string | undefined;

  constructor(
    private readonly extension: vscode.ExtensionContext,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return this.extension.globalState.get('codevim.enabled', true);
  }

  get current(): Runtime | undefined {
    return this.runtime;
  }

  get startError(): string | undefined {
    return this.lastError;
  }

  async start(): Promise<void> {
    if (this.runtime || this.starting) return this.starting;
    this.starting = (async () => {
      try {
        // Your config can take a while to load; show progress in the status bar meanwhile.
        const runtime = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'CodeVim' }, (progress) =>
          Runtime.start(this.extension, this.config, this.logger, (stage) => progress.report({ message: stage })),
        );
        this.runtime = runtime;
        this.lastError = undefined;
        runtime.onDidCrash((code) => void this.onCrash(code));
        void vscode.commands.executeCommand('setContext', 'codevim.running', true);
        this.logger.info('CodeVim started');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;
        this.logger.error(`start failed: ${message}`);
        const choice = await vscode.window.showErrorMessage(`CodeVim: ${message}`, 'Check Health', 'Open Settings', 'Show Log');
        if (choice === 'Check Health') void vscode.commands.executeCommand('codevim.checkHealth');
        if (choice === 'Open Settings') void vscode.commands.executeCommand('workbench.action.openSettings', 'codevim.neovimPath');
        if (choice === 'Show Log') void vscode.commands.executeCommand('codevim.showLog');
      } finally {
        this.starting = undefined;
      }
    })();
    return this.starting;
  }

  stop(): void {
    this.runtime?.dispose();
    this.runtime = undefined;
    void vscode.commands.executeCommand('setContext', 'codevim.running', false);
    void vscode.commands.executeCommand('setContext', 'codevim.active', false);
  }

  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  private async onCrash(code: number | null): Promise<void> {
    this.stop();
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < RESTART_WINDOW_MS), now];
    if (this.crashes.length > MAX_RESTARTS) {
      void vscode.window.showErrorMessage(`CodeVim: Neovim keeps exiting (code ${code}). Use "CodeVim: Restart" once fixed.`, 'Show Log').then((c) => {
        if (c) void vscode.commands.executeCommand('codevim.showLog');
      });
      return;
    }
    this.logger.warn(`Neovim exited (code ${code}); restarting`);
    await this.start();
  }

  resync(): void {
    this.runtime?.documents.resyncAll();
  }

  dispose(): void {
    this.stop();
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('CodeVim', { log: true });
  const logger = channelLogger(channel);
  const config = new ConfigService();
  const controller = new Controller(context, config, logger);
  const healthView = new HealthReportView();
  context.subscriptions.push(channel, config, controller, healthView);

  context.subscriptions.push(
    vscode.commands.registerCommand('codevim.showLog', () => channel.show(true)),
    vscode.commands.registerCommand('codevim.restart', () => controller.restart()),
    vscode.commands.registerCommand('codevim.resync', () => controller.resync()),
    vscode.commands.registerCommand('codevim.checkHealth', async () => {
      const sections = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'CodeVim: checking health' }, () =>
        runHealthChecks({ config, enabled: controller.enabled, runtime: controller.current, startError: controller.startError }),
      );
      await healthView.show(renderHealthReport(sections));
    }),
    vscode.commands.registerCommand('codevim.toggle', async () => {
      const enable = !controller.enabled;
      await context.globalState.update('codevim.enabled', enable);
      if (enable) await controller.start();
      else controller.stop();
      void vscode.window.setStatusBarMessage(`CodeVim ${enable ? 'enabled' : 'disabled'}`, 3000);
    }),
    config.onDidChange(() => {
      // Most settings are read live; process-level ones need a restart.
      void vscode.window.showInformationMessage('CodeVim settings changed. Restart Neovim to apply all of them?', 'Restart').then((c) => {
        if (c) void controller.restart();
      });
    }),
  );

  if (controller.enabled) {
    // Not awaited: your Neovim config may take a moment to load.
    void controller.start();
  }
}

export function deactivate(): void {
  // Disposal happens through context.subscriptions.
}
