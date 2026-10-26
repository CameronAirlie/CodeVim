import * as vscode from 'vscode';
import { ConfigService } from './config';

const LAST_VERSION_KEY = 'codevim.lastVersion';

/** Opens CHANGELOG.md (shipped in the package) as rendered Markdown. */
export function showReleaseNotes(extension: vscode.ExtensionContext): Thenable<unknown> {
  return vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(extension.extensionUri, 'CHANGELOG.md'));
}

/** Major/minor part of a version, e.g. "1.4" for "1.4.2". */
function feature(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

/**
 * After an update that changes the major or minor version, offers the release notes
 * once. First installs and patch releases stay quiet.
 */
export async function announceUpdate(extension: vscode.ExtensionContext, config: ConfigService): Promise<void> {
  const version = String(extension.extension.packageJSON.version);
  const previous = extension.globalState.get<string>(LAST_VERSION_KEY);
  if (previous === version) return;
  await extension.globalState.update(LAST_VERSION_KEY, version);
  if (!previous || feature(previous) === feature(version) || !config.current.showReleaseNotes) return;
  const choice = await vscode.window.showInformationMessage(`CodeVim was updated to v${version}.`, "What's New", "Don't Show Again");
  if (choice === "What's New") await showReleaseNotes(extension);
  if (choice === "Don't Show Again") {
    await vscode.workspace.getConfiguration('codevim').update('updates.showReleaseNotes', false, vscode.ConfigurationTarget.Global);
  }
}
