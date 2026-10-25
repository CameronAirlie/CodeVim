import * as vscode from 'vscode';
import { ConfigService } from '../config';
import { Logger } from '../core/logger';
import { NvimSession } from '../nvim/session';
import { DocumentManager } from '../sync/documentManager';
import { UiSizeController } from './uiSize';

/** Everything a feature may use. Features never reach into each other directly. */
export interface FeatureContext {
  readonly session: NvimSession;
  readonly documents: DocumentManager;
  readonly config: ConfigService;
  readonly ui: UiSizeController;
  readonly logger: Logger;
  readonly extension: vscode.ExtensionContext;
}

/**
 * A self-contained piece of behaviour. To add one: implement this interface in a
 * new file under src/features and register it in src/features/index.ts.
 * Each feature can be switched off with `"codevim.features": { "<id>": false }`.
 */
export interface FeatureDefinition {
  readonly id: string;
  readonly description: string;
  /** Required features cannot be disabled (CodeVim does not work without them). */
  readonly required?: boolean;
  create(ctx: FeatureContext): vscode.Disposable;
}
