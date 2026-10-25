import { decodeMultiStream, encode } from '@msgpack/msgpack';
import { PassThrough } from 'stream';
import { describe, expect, it } from 'vitest';
import { RpcClient } from '../../src/nvim/rpc';

/** A fake msgpack-rpc peer: `toClient` feeds the client, `fromClient` is what it wrote. */
function pair() {
  const toClient = new PassThrough();
  const fromClient = new PassThrough();
  const client = new RpcClient(fromClient, toClient);
  const received: unknown[][] = [];
  void (async () => {
    for await (const m of decodeMultiStream(fromClient as AsyncIterable<Uint8Array>)) received.push(m as unknown[]);
  })();
  const send = (m: unknown[]) => toClient.write(encode(m));
  const tick = () => new Promise((r) => setTimeout(r, 10));
  return { client, received, send, tick, toClient };
}

describe('RpcClient', () => {
  it('matches responses to requests', async () => {
    const { client, received, send, tick } = pair();
    const p = client.request('nvim_eval', ['1+1']);
    await tick();
    expect(received[0]).toEqual([0, 1, 'nvim_eval', ['1+1']]);
    send([1, 1, null, 2]);
    expect(await p).toBe(2);
  });

  it('rejects on error responses', async () => {
    const { client, send, tick } = pair();
    const p = client.request('bad');
    await tick();
    send([1, 1, [0, 'Vim:E492: Not an editor command'], null]);
    await expect(p).rejects.toThrow('E492');
  });

  it('dispatches notifications and answers server requests', async () => {
    const { client, received, send, tick } = pair();
    const notes: unknown[] = [];
    client.onNotification((n) => notes.push(n));
    client.setRequestHandler(async (method, params) => `${method}:${params[0]}`);
    send([2, 'redraw', [['flush']]]);
    send([0, 7, 'codevim_request', ['x']]);
    await tick();
    expect(notes).toEqual([{ method: 'redraw', params: [['flush']] }]);
    expect(received).toContainEqual([1, 7, null, 'codevim_request:x']);
  });

  it('decodes ext types (buffer handles) as numbers', async () => {
    const { client, tick, toClient } = pair();
    const p = client.request('nvim_get_current_buf');
    await tick();
    // [1, 1, nil, Buffer(5)]: fixarray(4), 1, 1, nil, fixext1 type 0 with payload msgpack(5)
    toClient.write(new Uint8Array([0x94, 0x01, 0x01, 0xc0, 0xd4, 0x00, 0x05]));
    expect(await p).toBe(5);
  });

  it('rejects pending requests when the connection closes', async () => {
    const { client, toClient } = pair();
    const p = client.request('nvim_eval', ['1']);
    toClient.end();
    await expect(p).rejects.toThrow('connection closed');
  });
});
