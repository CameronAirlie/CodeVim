import * as vscode from 'vscode';
import { ConfigService } from '../config';
import { DisposableStore } from '../core/disposable';
import { Emitter } from '../core/events';
import { Logger, scopedLogger } from '../core/logger';
import { WindowPayload } from '../nvim/protocol';
import { NvimSession } from '../nvim/session';
import { BUFFER_SCHEME, BufferFileSystem, bufferFromUri, bufferLabel, bufferUri } from './bufferFileSystem';
import { applyLinesEvent, computeEdit, LineSource } from './textDiff';

function documentSource(doc: vscode.TextDocument): LineSource {
  return { lineCount: doc.lineCount, lineAt: (i) => doc.lineAt(i).text };
}

export function documentLines(doc: vscode.TextDocument): string[] {
  const lines = new Array<string>(doc.lineCount);
  for (let i = 0; i < doc.lineCount; i++) {
    lines[i] = doc.lineAt(i).text;
  }
  return lines;
}

/**
 * One VS Code document mirrored into one Neovim buffer.
 *
 * Sync model:
 *  - VS Code → Neovim: each content change is forwarded as `apply_edits`.
 *  - Neovim → VS Code: `nvim_buf_lines_event`s update `mirror` (an exact copy of the
 *    buffer). The document is then diffed against the mirror and patched. Because the
 *    diff is content-based, echoes of our own edits produce no change.
 *  - While VS Code edits are in flight, flushing is deferred so a stale mirror never
 *    overwrites newer typing.
 *
 * Plugin buffers ("foreign" bindings, see BufferFileSystem) are the other way round:
 * Neovim is the source of truth and the document is reloaded from the mirror.
 */
export class DocumentBinding {
  readonly mirror: string[] = [];
  initialized = false;
  /** VS Code edits sent to Neovim whose responses haven't arrived yet. */
  private inflight = 0;
  private holds = 0;
  private needsFlush = false;
  private flushing = false;
  private applyingToDocument = 0;
  private insertEdits = 0;
  private waiters: Array<() => void> = [];
  /** Timestamp of the last edit made in VS Code (used to attribute cursor moves). */
  lastVscodeEditAt = 0;

  constructor(
    readonly document: vscode.TextDocument,
    readonly buf: number,
    private readonly session: NvimSession,
    private readonly logger: Logger,
    /** Set for plugin buffers: content is published through this file system. */
    private readonly foreignFs?: BufferFileSystem,
  ) {}

  /** A plugin buffer shown as an editor (Neovim owns the content). */
  get isForeign(): boolean {
    return this.foreignFs !== undefined;
  }

  private matchesMirror(): boolean {
    return !computeEdit(documentSource(this.document), this.mirror);
  }

  get uri(): string {
    return this.document.uri.toString();
  }

  /** Resolves once the document reflects every Neovim change received so far. */
  whenSynced(): Promise<void> {
    if (this.isSynced) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private get isSynced(): boolean {
    return this.initialized && !this.needsFlush && !this.flushing && this.inflight === 0 && this.holds === 0;
  }

  /** Defers Neovim→VS Code flushing (e.g. while Neovim replays an insert). */
  hold(timeoutMs = 1000): () => void {
    this.holds++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.holds--;
      this.scheduleFlush();
    };
    setTimeout(release, timeoutMs);
    return release;
  }

  resetInsertSession(): void {
    this.insertEdits = 0;
  }

  onNvimLines(first: number, last: number, lines: string[], more: boolean): void {
    this.logger.trace(`buf ${this.buf} lines [${first}, ${last}) <- ${lines.length} line(s)`);
    applyLinesEvent(this.mirror, first, last, lines);
    if (!this.initialized) {
      if (more) return;
      this.initialized = true;
      // The buffer was created from the document; if they differ (edits raced the
      // attach) the document wins - except for plugin buffers, where Neovim does.
      if (!this.matchesMirror()) {
        if (this.isForeign) {
          this.needsFlush = true;
          this.scheduleFlush();
          return;
        }
        this.pushDocument();
      }
      this.resolveWaiters();
      return;
    }
    this.needsFlush = true;
    if (!more) {
      this.scheduleFlush();
    }
  }

  onDocumentChange(e: vscode.TextDocumentChangeEvent, insertMode: boolean): void {
    if (this.applyingToDocument > 0 || !this.initialized || e.contentChanges.length === 0) {
      return;
    }
    if (this.isForeign && this.matchesMirror()) {
      return; // VS Code reloaded the content we published
    }
    this.lastVscodeEditAt = Date.now();
    const edits = [...e.contentChanges]
      .sort((a, b) => b.rangeOffset - a.rangeOffset)
      .map((c) => [c.range.start.line, c.range.start.character, c.range.end.line, c.range.end.character, c.text.replace(/\r\n?/g, '\n')]);
    const join = insertMode && this.insertEdits++ > 0;
    this.logger.trace(`send to buf ${this.buf}: ${JSON.stringify(edits)} join=${join}`);
    this.track(this.session.call('codevim.buffer', 'apply_edits', [this.buf, edits, join]));
  }

  /** Replaces Neovim's buffer with the document content. */
  pushDocument(): void {
    this.track(this.session.call('codevim.buffer', 'set_content', [this.buf, documentLines(this.document)]));
  }

  /** Compares mirror and document; repairs Neovim from the document if they diverged. */
  async verify(): Promise<boolean> {
    await this.whenSynced();
    if (!this.matchesMirror()) {
      if (this.isForeign) {
        this.needsFlush = true;
        this.scheduleFlush();
        return false;
      }
      this.logger.warn(`buffer ${this.buf} diverged from ${this.uri}; resyncing from VS Code`);
      this.pushDocument();
      return false;
    }
    return true;
  }

  private track(p: Promise<unknown>): void {
    this.inflight++;
    p.catch((err) => this.logger.error(`sync to nvim failed: ${String(err)}`)).finally(() => {
      this.inflight--;
      this.scheduleFlush();
    });
  }

  private scheduleFlush(): void {
    if (this.inflight > 0 || this.holds > 0) {
      return;
    }
    if (!this.needsFlush) {
      this.resolveWaiters();
      return;
    }
    if (!this.flushing) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    this.flushing = true;
    try {
      let attempts = 0;
      while (this.needsFlush && this.inflight === 0 && this.holds === 0 && attempts++ < 10) {
        this.needsFlush = false;
        const edit = computeEdit(documentSource(this.document), this.mirror);
        if (!edit) {
          continue;
        }
        if (this.foreignFs) {
          await this.publish(this.foreignFs);
          continue;
        }
        this.logger.trace(`apply to ${this.uri}: ${JSON.stringify(edit)}`);
        const we = new vscode.WorkspaceEdit();
        we.replace(
          this.document.uri,
          new vscode.Range(edit.start.line, edit.start.character, edit.end.line, edit.end.character),
          edit.text,
        );
        this.applyingToDocument++;
        let ok = false;
        try {
          ok = await vscode.workspace.applyEdit(we);
        } finally {
          this.applyingToDocument--;
        }
        if (!ok) {
          this.needsFlush = true;
        }
      }
    } catch (err) {
      this.logger.error(`sync to VS Code failed: ${String(err)}`);
    } finally {
      this.flushing = false;
    }
    if (this.needsFlush) {
      this.scheduleFlush();
    } else {
      this.resolveWaiters();
    }
  }

  /** Publishes the mirror and waits (briefly) for VS Code to reload the document. */
  private publish(fs: BufferFileSystem): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      };
      const sub = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === this.document && this.matchesMirror()) done();
      });
      const timer = setTimeout(done, 1000);
      fs.update(this.document.uri, this.mirror);
    });
  }

  private resolveWaiters(): void {
    if (!this.isSynced) {
      return;
    }
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

/** Creates, tracks and tears down {@link DocumentBinding}s. */
export class DocumentManager implements vscode.Disposable {
  private readonly byUri = new Map<string, DocumentBinding>();
  private readonly byBuf = new Map<number, DocumentBinding>();
  private readonly pending = new Map<string, Promise<DocumentBinding | undefined>>();
  private readonly pendingPlugin = new Map<number, Promise<vscode.TextDocument | undefined>>();
  private readonly disposables = new DisposableStore();
  private readonly logger: Logger;

  private readonly bindEmitter = new Emitter<DocumentBinding>();
  readonly onDidBind = this.bindEmitter.event;
  /** Backs the codevim-buffer: documents that show plugin buffers. */
  readonly bufferFs = new BufferFileSystem();

  constructor(
    private readonly session: NvimSession,
    private readonly config: ConfigService,
    logger: Logger,
  ) {
    this.logger = scopedLogger(logger, 'documents');
    const d = this.disposables;
    d.add(vscode.workspace.onDidChangeTextDocument((e) => this.get(e.document)?.onDocumentChange(e, session.mode.current.isInsertLike)));
    d.add(vscode.workspace.onDidCloseTextDocument((doc) => this.unbind(doc)));
    d.add(vscode.workspace.onDidSaveTextDocument((doc) => {
      const b = this.get(doc);
      if (b) session.notify('nvim_exec_lua', ['vim.bo[...].modified = false', [b.buf]]);
    }));
    d.add(vscode.window.onDidChangeVisibleTextEditors((editors) => this.bindEditors(editors)));
    d.add(session.bus.on('bufLines', (e) => this.byBuf.get(e.buf)?.onNvimLines(e.first, e.last, e.lines, e.more)));
    d.add(session.bus.on('bufDetach', (e) => void this.onDetach(e.buf)));
    d.add(session.mode.onDidChange((mode) => {
      for (const b of this.byBuf.values()) b.resetInsertSession();
      if (!mode.isInsertLike) {
        const active = vscode.window.activeTextEditor;
        const b = active && this.get(active.document);
        if (b) void b.verify();
      }
    }));
    d.add(this.bindEmitter);
    d.add(vscode.workspace.registerFileSystemProvider(BUFFER_SCHEME, this.bufferFs, { isCaseSensitive: true }));
    d.add(this.bufferFs);
    d.add(this.bufferFs.onDidWrite((uri) => void this.writePluginBuffer(uri)));
    // Closing the last tab of a plugin buffer releases it (VS Code may keep the
    // document itself open much longer).
    d.add(vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const tab of e.closed) {
        const uri = tab.input instanceof vscode.TabInputText ? tab.input.uri : undefined;
        if (uri?.scheme === BUFFER_SCHEME && !this.isUriShown(uri)) this.unbindUri(uri.toString());
      }
    }));
    this.bindEditors(vscode.window.visibleTextEditors);
  }

  isSupported(doc: vscode.TextDocument): boolean {
    return doc.uri.scheme === BUFFER_SCHEME || this.config.current.documentSchemes.includes(doc.uri.scheme);
  }

  /** Opens (or returns) the VS Code document showing a plugin buffer. */
  openPluginBuffer(p: WindowPayload): Promise<vscode.TextDocument | undefined> {
    const existing = this.byBuf.get(p.buf);
    if (existing) return Promise.resolve(existing.document);
    let pending = this.pendingPlugin.get(p.buf);
    if (!pending) {
      pending = this.createPluginDocument(p).finally(() => this.pendingPlugin.delete(p.buf));
      this.pendingPlugin.set(p.buf, pending);
    }
    return pending;
  }

  private async createPluginDocument(p: WindowPayload): Promise<vscode.TextDocument | undefined> {
    const uri = bufferUri(p.buf, bufferLabel(p.name, p.filetype, p.buftype));
    const lines = await this.session.request<string[]>('nvim_buf_get_lines', [p.buf, 0, -1, false]);
    this.bufferFs.update(uri, lines);
    const doc = await vscode.workspace.openTextDocument(uri);
    const binding = await this.ensureBinding(doc, p.buf);
    return binding?.document;
  }

  private isUriShown(uri: vscode.Uri): boolean {
    const key = uri.toString();
    return vscode.window.tabGroups.all.some((g) =>
      g.tabs.some((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key),
    );
  }

  private async writePluginBuffer(uri: vscode.Uri): Promise<void> {
    const b = this.get(uri);
    if (!b) return;
    await b.whenSynced();
    // Plugins such as oil apply their changes on :write.
    this.session.notify('nvim_exec_lua', ["vim.api.nvim_buf_call(..., function() pcall(vim.cmd, 'write') end)", [b.buf]]);
  }

  get(doc: vscode.TextDocument | vscode.Uri | string): DocumentBinding | undefined {
    const key = typeof doc === 'string' ? doc : 'uri' in doc ? doc.uri.toString() : doc.toString();
    return this.byUri.get(key);
  }

  getByBuf(buf: number): DocumentBinding | undefined {
    return this.byBuf.get(buf);
  }

  get all(): DocumentBinding[] {
    return [...this.byUri.values()];
  }

  /**
   * Returns the binding for `doc`, creating the Neovim buffer if needed.
   * `adoptBuf` reuses an existing buffer (e.g. one Neovim opened itself via `:e`).
   */
  ensureBinding(doc: vscode.TextDocument, adoptBuf?: number): Promise<DocumentBinding | undefined> {
    if (!this.isSupported(doc)) {
      return Promise.resolve(undefined);
    }
    const key = doc.uri.toString();
    const existing = this.byUri.get(key);
    if (existing) {
      return Promise.resolve(existing);
    }
    let p = this.pending.get(key);
    if (!p) {
      p = this.bind(doc, adoptBuf).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  private async bind(doc: vscode.TextDocument, adoptBuf?: number): Promise<DocumentBinding | undefined> {
    const cfg = this.config.current;
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    const tabSize = editor && cfg.syncIndentOptions ? Number(editor.options.tabSize) : undefined;
    const foreign = doc.uri.scheme === BUFFER_SCHEME;
    if (foreign) adoptBuf = bufferFromUri(doc.uri);
    try {
      const buf = await this.session.call<number>('codevim.buffer', 'attach', [
        {
          uri: doc.uri.toString(),
          name: doc.uri.scheme === 'file' ? doc.uri.fsPath : doc.uri.toString(),
          path: doc.uri.scheme === 'file' ? doc.uri.fsPath : undefined,
          buf: adoptBuf,
          lines: documentLines(doc),
          language_id: doc.languageId,
          dirty: doc.isDirty,
          readonly: false,
          tab_size: Number.isFinite(tabSize) ? tabSize : undefined,
          insert_spaces: editor?.options.insertSpaces === true,
          read_autocmds: true,
          foreign,
        },
      ]);
      if (doc.isClosed) {
        this.session.callAsync('codevim.buffer', 'detach', [buf]);
        return undefined;
      }
      const binding = new DocumentBinding(doc, buf, this.session, this.logger, foreign ? this.bufferFs : undefined);
      this.byUri.set(binding.uri, binding);
      this.byBuf.set(buf, binding);
      await this.session.request('nvim_buf_attach', [buf, true, {}]);
      await binding.whenSynced();
      this.logger.debug(`bound ${binding.uri} to buffer ${buf}`);
      this.bindEmitter.fire(binding);
      return binding;
    } catch (err) {
      this.logger.error(`could not mirror ${doc.uri.toString()}: ${String(err)}`);
      return undefined;
    }
  }

  private bindEditors(editors: readonly vscode.TextEditor[]): void {
    for (const editor of editors) {
      void this.ensureBinding(editor.document);
    }
  }

  private unbind(doc: vscode.TextDocument): void {
    this.unbindUri(doc.uri.toString());
  }

  private unbindUri(key: string): void {
    const b = this.byUri.get(key);
    if (!b) return;
    this.byUri.delete(b.uri);
    this.byBuf.delete(b.buf);
    if (b.isForeign) this.bufferFs.remove(b.document.uri);
    this.session.callAsync('codevim.buffer', 'detach', [b.buf]);
  }

  /** Called when Neovim stopped sending updates for a buffer (e.g. after `:e!`). */
  private async onDetach(buf: number): Promise<void> {
    const b = this.byBuf.get(buf);
    if (!b) return;
    const valid = await this.session.request<boolean>('nvim_buf_is_loaded', [buf]).catch(() => false);
    if (valid && this.byBuf.get(buf) === b) {
      b.mirror.length = 0;
      b.initialized = false;
      await this.session.request('nvim_buf_attach', [buf, true, {}]).catch(() => undefined);
    } else {
      this.byBuf.delete(buf);
      this.byUri.delete(b.uri);
    }
  }

  /** Pushes every document to Neovim again (command: CodeVim: Resync). */
  resyncAll(): void {
    for (const b of this.byUri.values()) b.pushDocument();
  }

  dispose(): void {
    this.disposables.dispose();
  }
}
