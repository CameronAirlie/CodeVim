import { HealthCheck, HealthItem } from '../check';

const SLOW_STARTUP_MS = 3000;

/** Whether CodeVim is running, how startup went, and the Neovim side's own report. */
export const statusCheck: HealthCheck = {
  title: 'CodeVim',
  async run({ enabled, runtime, startError }) {
    if (!enabled) {
      return [{ level: 'warn', message: 'CodeVim is disabled.', advice: 'Run "CodeVim: Toggle" (ctrl+shift+alt+n) to enable it.' }];
    }
    if (!runtime) {
      return [
        startError
          ? { level: 'error', message: `Neovim failed to start: ${startError}`, advice: 'Fix the problem, then run "CodeVim: Restart Neovim". See "CodeVim: Show Log".' }
          : { level: 'warn', message: 'Neovim is not running.', advice: 'Run "CodeVim: Restart Neovim".' },
      ];
    }
    const { session } = runtime;
    const v = session.version;
    const items: HealthItem[] = [{ level: 'ok', message: `Running Neovim ${v.major}.${v.minor}.${v.patch}, started in ${runtime.startupMs} ms` }];
    if (session.startupTimedOut) {
      items.push({
        level: 'warn',
        message: 'Your config did not finish loading (VimEnter) before the startup timeout.',
        advice: 'Look for a startup prompt or error with "CodeVim: Show Neovim Messages", or lazy-load heavy plugins.',
      });
    } else if (runtime.startupMs > SLOW_STARTUP_MS) {
      items.push({ level: 'info', message: 'Startup is slow.', advice: 'Profile it with `nvim --startuptime startup.log`.' });
    }
    try {
      const report = await session.call<{ level: HealthItem['level']; msg: string; advice?: string }[]>('codevim.health', 'report');
      items.push(...report.map((r) => ({ level: r.level, message: r.msg, advice: r.advice })));
    } catch (err) {
      items.push({ level: 'error', message: `Neovim did not answer the health request: ${String(err)}` });
    }
    return items;
  },
};
