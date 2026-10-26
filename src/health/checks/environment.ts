import * as vscode from 'vscode';
import { FOLD_COMMAND_IDS } from '../../features/folding';
import { HealthCheck, HealthItem } from '../check';

/** Extensions that also handle Vim keys in the editor. */
const CONFLICTING_EXTENSIONS: Record<string, string> = {
  'vscodevim.vim': 'VSCodeVim',
  'asvetliakov.vscode-neovim': 'VSCode Neovim',
};

/** VS Code commands CodeVim features depend on, per feature id. */
const REQUIRED_COMMANDS: Record<string, readonly string[]> = {
  folding: FOLD_COMMAND_IDS,
  jumplist: ['workbench.action.navigateBack', 'workbench.action.navigateForward'],
  undo: ['undo', 'redo'],
};

/** Other extensions and the VS Code commands CodeVim relies on. */
export const environmentCheck: HealthCheck = {
  title: 'VS Code',
  async run({ config }) {
    const items: HealthItem[] = [{ level: 'ok', message: `VS Code ${vscode.version}` }];
    for (const [id, name] of Object.entries(CONFLICTING_EXTENSIONS)) {
      if (vscode.extensions.getExtension(id)) {
        items.push({
          level: 'error',
          message: `${name} (\`${id}\`) is enabled; it handles the same keys as CodeVim.`,
          advice: 'Disable one of them (for this workspace or globally).',
        });
      }
    }
    const available = new Set(await vscode.commands.getCommands(true));
    for (const [feature, commands] of Object.entries(REQUIRED_COMMANDS)) {
      if (!config.isFeatureEnabled(feature)) continue;
      const missing = commands.filter((c) => !available.has(c));
      if (missing.length > 0) {
        items.push({
          level: 'warn',
          message: `Feature "${feature}" uses commands this VS Code doesn't have: ${missing.join(', ')}`,
          advice: 'Update VS Code, or turn the feature off in `codevim.features`.',
        });
      }
    }
    return items;
  },
};
