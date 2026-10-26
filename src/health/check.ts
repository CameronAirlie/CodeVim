import type { ConfigService } from '../config';
import type { Runtime } from '../runtime';

export type HealthLevel = 'ok' | 'info' | 'warn' | 'error';

export interface HealthItem {
  level: HealthLevel;
  message: string;
  /** What to do about it (warnings and errors). */
  advice?: string;
}

export interface HealthSection {
  title: string;
  items: HealthItem[];
}

/** Everything a check may look at. Checks must also work when Neovim is not running. */
export interface HealthContext {
  readonly config: ConfigService;
  readonly enabled: boolean;
  /** The running instance, if Neovim is up. */
  readonly runtime: Runtime | undefined;
  /** Why the last start failed, if it did. */
  readonly startError: string | undefined;
}

/**
 * One section of "CodeVim: Check Health". To add one: implement this interface in a
 * new file under src/health/checks and register it in src/health/index.ts.
 */
export interface HealthCheck {
  readonly title: string;
  run(ctx: HealthContext): Promise<HealthItem[]> | HealthItem[];
}
