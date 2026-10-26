import * as vscode from 'vscode';

/** Helpers for drawing on top of an editor with decoration pseudo-elements. */

/** VS Code's rendered line height for an editor, in pixels. */
export function lineHeightPx(doc: vscode.TextDocument): number {
  const cfg = vscode.workspace.getConfiguration('editor', doc);
  const fontSize = cfg.get<number>('fontSize', 14);
  const lineHeight = cfg.get<number>('lineHeight', 0);
  if (lineHeight <= 0) return Math.round(fontSize * (process.platform === 'darwin' ? 1.5 : 1.35));
  if (lineHeight < 8) return Math.round(fontSize * lineHeight);
  return lineHeight;
}

/** A theme colour id (e.g. `editor.background`) as a CSS value, for use in raw CSS. */
export function themeVar(id: string): string {
  return `var(--vscode-${id.replace(/\./g, '-')})`;
}

/** Non-breaking spaces: pseudo-element content would otherwise collapse runs of spaces. */
export function contentText(text: string): string {
  return text.replace(/ /g, ' ');
}
