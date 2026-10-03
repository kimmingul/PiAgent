import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { encodeFrame, FrameDecoder, isObject } from '@piagent/protocol';
import type { RpcResponse } from '@piagent/protocol';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { authProof, equalProof } from '@piagent/core';
import { credentialPath } from './secure-pipe.js';

/** Small protocol simulator client, not an IDE adapter SDK. */
export class PipeClient extends EventEmitter {
  private sequence = 0;
  private readonly pending = new Map<string, {
    resolve: (response: RpcResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout;
  }>();

  private constructor(private readonly socket: Socket) {
    super();
    const decoder = new FrameDecoder();
    socket.on('data', (chunk: Buffer) => {
      try {
        decoder.push(chunk, body => {
          const frame: unknown = JSON.parse(body.toString('utf8')) as unknown;
          if (isObject(frame) && frame['jsonrpc'] === '2.0' && frame['method'] === 'chat.event'
            && !('id' in frame) && isObject(frame['params'])) {
            this.emit('chat.event', frame['params']); return;
          }
          if (!isObject(frame) || frame['jsonrpc'] !== '2.0' || typeof frame['id'] !== 'string'
            || ('result' in frame) === ('error' in frame)) throw new Error('Invalid RPC response');
          const pending = this.pending.get(frame['id']);
          if (!pending) return;
          this.pending.delete(frame['id']);
          clearTimeout(pending.timer);
          pending.resolve(frame as unknown as RpcResponse);
        });
      } catch (error) {
        this.rejectAll(error instanceof Error ? error : new Error(String(error)));
        socket.destroy();
      }
    });
    socket.on('error', error => this.rejectAll(error));
    socket.on('close', () => this.rejectAll(new Error('Pipe disconnected')));
  }

  static async connect(path: string, options: { authFile?: string; authenticate?: boolean } = {}): Promise<PipeClient> {
    const socket = createConnection(path);
    const client = new PipeClient(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Pipe connect timeout')); }, 5_000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    try {
      if (options.authenticate !== false) {
        const name = path.split('\\').at(-1)!;
        const explicit = options.authFile ?? process.env['PIAGENT_AUTH_FILE'];
        let token: string;
        try { token = await readFile(explicit ?? credentialPath(name), 'utf8'); }
        catch { throw new Error('Cannot read authentication credential'); }
        await client.authenticate(name, token);
      }
      return client;
    } catch (error) { client.close(); throw error; }
  }

  async authenticate(name: string, token: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid authentication credential');
    const clientNonce = randomBytes(32).toString('hex');
    const response = await this.request('core.auth.challenge', { clientNonce });
    const result = response.result;
    if (!isObject(result) || result['scheme'] !== 'hmac-sha256.v1' || typeof result['serverNonce'] !== 'string'
      || !/^[a-f0-9]{64}$/.test(result['serverNonce'])
      || !equalProof(result['serverProof'], authProof(token, 'server', name, clientNonce, result['serverNonce']))) throw new Error('Core authentication failed');
    const reply = await this.request('adapter.auth', { proof: authProof(token, 'client', name, clientNonce, result['serverNonce']) });
    if (!isObject(reply.result) || reply.result['authenticated'] !== true) throw new Error('Adapter authentication failed');
  }

  request(method: string, params: unknown = {}): Promise<RpcResponse> {
    if (this.socket.destroyed) return Promise.reject(new Error('Pipe disconnected'));
    if (this.pending.size >= 16) return Promise.reject(new Error('Too many pending probe requests'));
    const id = `probe-${++this.sequence}`;
    let buffer: Buffer;
    try { buffer = encodeFrame({ jsonrpc: '2.0', id, method, params }); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Pipe RPC timeout')); }, method === 'chat.open' ? 20_000 : 5_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(buffer, error => { if (error) this.rejectAll(error); });
    });
  }

  close(): void { this.socket.destroy(); }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
