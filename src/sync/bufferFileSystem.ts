import * as vscode from 'vscode';
import { Emitter } from '../core/events';

export const BUFFER_SCHEME = 'codevim-buffer';

interface Entry {
  content: Uint8Array;
  mtime: number;
}

/** Tab title for a plugin buffer, e.g. "help.txt", "oil: src", "[fugitive]". */
export function bufferLabel(name: string, filetype: string, buftype: string): string {
  const scheme = /^([a-zA-Z][\w+.-]+):\/\/(.*)$/.exec(name);
  const tail = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  let label: string;
  if (scheme) {
    label = `${scheme[1]}: ${tail(scheme[2]) || '/'}`;
  } else if (name) {
    label = tail(name);
  } else {
    label = `[${filetype || buftype || 'scratch'}]`;
  }
  return label.replace(/[\\/:*?"<>|]/g, (c) => (c === ':' ? '꞉' : '_'));
}

export function bufferUri(buf: number, label: string): vscode.Uri {
  return vscode.Uri.from({ scheme: BUFFER_SCHEME, path: `/${buf}/${label}` });
}

export function bufferFromUri(uri: vscode.Uri): number | undefined {
  const n = Number(uri.path.split('/')[1]);
  return uri.scheme === BUFFER_SCHEME && Number.isInteger(n) ? n : undefined;
}

/**
 * In-memory file system that shows Neovim plugin buffers (help, oil, fugitive,
 * quickfix, terminal…) as ordinary VS Code documents, with VS Code's theme and font.
 *
 * Neovim owns these buffers: content flows Neovim → here → VS Code (which reloads
 * the document when it changes). Saving one runs `:write` in Neovim, which is how
 * plugins like oil apply their changes.
 */
export class BufferFileSystem implements vscode.FileSystemProvider {
  private readonly files = new Map<string, Entry>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;
  private readonly writeEmitter = new Emitter<vscode.Uri>();
  /** The user saved a plugin buffer from VS Code. */
  readonly onDidWrite = this.writeEmitter.event;
  private clock = Date.now();
  private readonly encoder = new TextEncoder();

  /** Replaces a buffer's content and tells VS Code to reload it. */
  update(uri: vscode.Uri, lines: readonly string[]): void {
    const key = uri.toString();
    const existed = this.files.has(key);
    this.files.set(key, { content: this.encoder.encode(lines.join('\n')), mtime: ++this.clock });
    if (existed) {
      this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }
  }

  remove(uri: vscode.Uri): void {
    this.files.delete(uri.toString());
  }

  private entry(uri: vscode.Uri): Entry {
    const e = this.files.get(uri.toString());
    if (!e) throw vscode.FileSystemError.FileNotFound(uri);
    return e;
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    if (uri.path.split('/').length < 3) {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    const e = this.entry(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: e.mtime, size: e.content.byteLength };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    return this.entry(uri).content;
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    const e = this.entry(uri);
    e.content = content;
    e.mtime = ++this.clock;
    this.writeEmitter.fire(uri);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    this.remove(uri);
  }

  rename(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.writeEmitter.dispose();
    this.files.clear();
  }
}
