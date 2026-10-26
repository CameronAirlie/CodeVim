import { HealthCheck, HealthContext, HealthSection } from './check';
import { environmentCheck } from './checks/environment';
import { neovimCheck } from './checks/neovim';
import { settingsCheck } from './checks/settings';
import { statusCheck } from './checks/status';

/** All checks, in report order. Add new checks here. */
export const HEALTH_CHECKS: readonly HealthCheck[] = [statusCheck, neovimCheck, environmentCheck, settingsCheck];

/** Runs every check concurrently; a check that throws becomes an error item in its section. */
export function runHealthChecks(ctx: HealthContext, checks: readonly HealthCheck[] = HEALTH_CHECKS): Promise<HealthSection[]> {
  return Promise.all(
    checks.map(async (check): Promise<HealthSection> => {
      try {
        return { title: check.title, items: await check.run(ctx) };
      } catch (err) {
        return { title: check.title, items: [{ level: 'error', message: `The check itself failed: ${String(err)}` }] };
      }
    }),
  );
}
