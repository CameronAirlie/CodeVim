import * as vscode from 'vscode';
import { Disposable, DisposableStore } from '../core/disposable';

const SCHEME = 'codevim-health';
const REPORT_URI = vscode.Uri.from({ scheme: SCHEME, path: '/CodeVim Health.md' });

/** Shows the health report as a read-only Markdown preview. */
export class HealthReportView implements Disposable {
  private readonly disposables = new DisposableStore();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  private content = '';

  constructor() {
    this.disposables.add(this.changed);
    this.disposables.add(
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
        onDidChange: this.changed.event,
        provideTextDocumentContent: () => this.content,
      }),
    );
  }

  async show(markdown: string): Promise<void> {
    this.content = markdown;
    this.changed.fire(REPORT_URI);
    try {
      await vscode.commands.executeCommand('markdown.showPreview', REPORT_URI);
    } catch {
      // The built-in Markdown extension is disabled: show the source instead.
      await vscode.window.showTextDocument(REPORT_URI, { preview: true });
    }
  }

  dispose(): void {
    this.disposables.dispose();
  }
}
