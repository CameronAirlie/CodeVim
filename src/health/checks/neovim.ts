import { execFile } from 'child_process';
import { HealthCheck, HealthItem } from '../check';

const MIN_MINOR = 10;
const TIMEOUT_MS = 5000;

function nvimVersion(path: string, appName: string): Promise<string> {
  const env = appName ? { ...process.env, NVIM_APPNAME: appName } : process.env;
  return new Promise((resolve, reject) => {
    execFile(path, ['--version'], { timeout: TIMEOUT_MS, env, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.split(/\r?\n/)[0] ?? '');
    });
  });
}

/** The configured executable exists and is new enough (checked without the running instance). */
export const neovimCheck: HealthCheck = {
  title: 'Neovim executable',
  async run({ config }) {
    const { neovimPath, neovimAppName } = config.current;
    const items: HealthItem[] = [];
    let banner: string;
    try {
      banner = await nvimVersion(neovimPath, neovimAppName);
    } catch (err) {
      return [
        {
          level: 'error',
          message: `Could not run \`${neovimPath} --version\`: ${err instanceof Error ? err.message : String(err)}`,
          advice: 'Install Neovim 0.10+ or set `codevim.neovimPath` to the full path of nvim.',
        },
      ];
    }
    const m = /v(\d+)\.(\d+)\.(\d+)/.exec(banner);
    if (!m) {
      items.push({ level: 'warn', message: `Unrecognised version output: \`${banner}\``, advice: 'Is `codevim.neovimPath` really Neovim?' });
    } else if (Number(m[1]) === 0 && Number(m[2]) < MIN_MINOR) {
      items.push({ level: 'error', message: `${banner} is too old`, advice: `CodeVim needs Neovim 0.${MIN_MINOR} or newer.` });
    } else {
      items.push({ level: 'ok', message: `${banner} (\`${neovimPath}\`)` });
    }
    if (neovimAppName) {
      items.push({ level: 'info', message: `Using NVIM_APPNAME=\`${neovimAppName}\`` });
    }
    return items;
  },
};
