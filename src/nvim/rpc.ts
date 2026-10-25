import { decode, decodeMultiStream, encode, ExtensionCodec } from '@msgpack/msgpack';
import type { Readable, Writable } from 'stream';
import { Emitter } from '../core/events';
import { Logger, nullLogger } from '../core/logger';

/**
 * A msgpack-rpc client for Neovim's `--embed` channel.
 *
 * Kept deliberately small: requests, notifications and server→client requests.
 * Buffer/Window/Tabpage handles (msgpack ext types 0-2) decode to plain numbers.
 */

const REQUEST = 0;
const RESPONSE = 1;
const NOTIFICATION = 2;

export type RequestHandler = (method: string, params: unknown[]) => unknown;

export class RpcError extends Error {
  constructor(
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(err: Error): void;
}

function createCodec(): ExtensionCodec {
  const codec = new ExtensionCodec();
  for (const type of [0, 1, 2]) {
    codec.register({
      type,
      encode: () => null,
      decode: (data: Uint8Array) => decode(data) as number,
    });
  }
  return codec;
}

function formatError(err: unknown): string {
  if (Array.isArray(err) && typeof err[1] === 'string') {
    return err[1];
  }
  return typeof err === 'string' ? err : JSON.stringify(err);
}

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly codec = createCodec();
  private requestHandler: RequestHandler | undefined;
  private closed = false;

  private readonly notification = new Emitter<{ method: string; params: unknown[] }>();
  readonly onNotification = this.notification.event;
  private readonly closeEmitter = new Emitter<void>();
  readonly onClose = this.closeEmitter.event;

  constructor(
    private readonly output: Writable,
    input: Readable,
    private readonly logger: Logger = nullLogger,
  ) {
    void this.readLoop(input);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  setRequestHandler(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (this.closed) {
      return Promise.reject(new RpcError('connection closed', method));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
      this.write([REQUEST, id, method, params]);
    });
  }

  notify(method: string, params: unknown[] = []): void {
    if (!this.closed) {
      this.write([NOTIFICATION, method, params]);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const p of this.pending.values()) {
      p.reject(new RpcError('connection closed', p.method));
    }
    this.pending.clear();
    this.closeEmitter.fire();
    this.notification.dispose();
    this.closeEmitter.dispose();
  }

  private write(message: unknown[]): void {
    try {
      // Undefined object fields are omitted (otherwise Lua would see vim.NIL).
      this.output.write(encode(message, { extensionCodec: this.codec, ignoreUndefined: true }));
    } catch (err) {
      this.logger.error(`rpc write failed: ${String(err)}`);
    }
  }

  private async readLoop(input: Readable): Promise<void> {
    try {
      for await (const message of decodeMultiStream(input as AsyncIterable<Uint8Array>, { extensionCodec: this.codec })) {
        this.dispatch(message as unknown[]);
      }
    } catch (err) {
      if (!this.closed) {
        this.logger.error(`rpc read failed: ${String(err)}`);
      }
    } finally {
      this.close();
    }
  }

  private dispatch(message: unknown[]): void {
    switch (message[0]) {
      case RESPONSE: {
        const [, id, err, result] = message as [number, number, unknown, unknown];
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        if (err !== null && err !== undefined) {
          pending.reject(new RpcError(formatError(err), pending.method));
        } else {
          pending.resolve(result);
        }
        return;
      }
      case NOTIFICATION: {
        const [, method, params] = message as [number, string, unknown[]];
        this.notification.fire({ method, params });
        return;
      }
      case REQUEST: {
        const [, id, method, params] = message as [number, number, string, unknown[]];
        void this.answer(id, method, params);
        return;
      }
    }
  }

  private async answer(id: number, method: string, params: unknown[]): Promise<void> {
    try {
      if (!this.requestHandler) {
        throw new Error(`no handler for request ${method}`);
      }
      const result = await this.requestHandler(method, params);
      this.write([RESPONSE, id, null, result ?? null]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.write([RESPONSE, id, message, null]);
    }
  }
}
