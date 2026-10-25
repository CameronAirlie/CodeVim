// Runs the end-to-end suite inside a real VS Code instance.
//   npm run test:e2e
// Uses an installed VS Code when CODE_PATH (or the default Windows location) exists,
// otherwise downloads one. Runs with an isolated profile and --clean Neovim.
import { runTests } from '@vscode/test-electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidates = [process.env.CODE_PATH, path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe')];
const vscodeExecutablePath = candidates.find((p) => p && fs.existsSync(p));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codevim-e2e-'));
const userData = path.join(tmp, 'user-data');
const workspace = path.join(tmp, 'workspace');
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
const useUserConfig = process.argv.includes('--user-config');
fs.writeFileSync(
  path.join(userData, 'User', 'settings.json'),
  JSON.stringify({
    'codevim.neovimArgs': useUserConfig ? [] : ['--clean'],
    'workbench.startupEditor': 'none',
    'security.workspace.trust.enabled': false,
    'extensions.autoUpdate': false,
    'telemetry.telemetryLevel': 'off',
  }),
);

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'e2e', 'suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--user-data-dir', userData, '--disable-workspace-trust', '--new-window'],
    extensionTestsEnv: { CODEVIM_LOG_FILE: process.env.CODEVIM_LOG_FILE ?? '', CODEVIM_E2E_WORKSPACE: workspace, CODEVIM_E2E_USER_CONFIG: useUserConfig ? '1' : '' },
  });
} catch (err) {
  console.error('e2e failed:', err);
  process.exitCode = 1;
}
