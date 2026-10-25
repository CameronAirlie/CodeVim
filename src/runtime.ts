import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigService } from './config';
import { DisposableStore } from './core/disposable';
import { Emitter } from './core/events';
import { Logger, scopedLogger } from './core/logger';
import { FeatureContext } from './features/feature';
import { FEATURES } from './features';
import { UiSizeController } from './features/uiSize';
import { NvimSession } from './nvim/session';
import { DocumentManager } from './sync/documentManager';

/**
 * One running CodeVim instance: a Neovim session, the document mirror and all
 * enabled features. Restarting CodeVim means disposing this and creating a new one.
 */
export class Runtime implements vscode.Disposable {
  private readonly disposables = new DisposableStore();
  private readonly exitEmitter = new Emitter<number | null>();
  /** Fires when Neovim exits unexpectedly. */
  readonly onDidCrash = this.exitEmitter.event;

  private constructor(
    readonly session: NvimSession,
    readonly documents: DocumentManager,
  ) {}

  static async start(extension: vscode.ExtensionContext, config: ConfigService, logger: Logger): Promise<Runtime> {
    const cfg = config.current;
    const session = await NvimSession.start({
      nvimPath: cfg.neovimPath,
      nvimArgs: cfg.neovimArgs,
      appName: cfg.neovimAppName || undefined,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      runtimeDir: path.join(extension.extensionPath, 'runtime'),
      setup: {
        vscode_global: cfg.setVscodeGlobal,
        clipboard: cfg.useVscodeClipboard,
        notify: cfg.routeVimNotify,
        window_keymaps: cfg.windowKeymaps,
        command_abbreviations: cfg.commandAbbreviations,
      },
      width: cfg.uiWidth,
      height: 40,
      logger: scopedLogger(logger, 'nvim'),
    });

    const documents = new DocumentManager(session, config, logger);
    const runtime = new Runtime(session, documents);
    runtime.disposables.add(documents);
    runtime.disposables.add(session.onDidExit((code) => runtime.exitEmitter.fire(code)));

    const ctx: FeatureContext = {
      session,
      documents,
      config,
      ui: new UiSizeController(session),
      logger,
      extension,
    };
    for (const feature of FEATURES) {
      if (!feature.required && !config.isFeatureEnabled(feature.id)) {
        logger.info(`feature '${feature.id}' disabled by settings`);
        continue;
      }
      try {
        runtime.disposables.add(feature.create(ctx));
      } catch (err) {
        logger.error(`feature '${feature.id}' failed to start: ${String(err)}`);
      }
    }
    return runtime;
  }

  dispose(): void {
    this.disposables.dispose();
    this.exitEmitter.dispose();
    this.session.dispose();
  }
}
