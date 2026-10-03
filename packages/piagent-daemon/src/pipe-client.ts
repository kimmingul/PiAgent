import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { encodeFrame, FrameDecoder, isObject } from '@piagent/protocol';
import type { RpcResponse } from '@piagent/protocol';

/** Small protocol simulator client, not an IDE adapter SDK. */
export class PipeClient {
  private sequence = 0;
  private readonly pending = new Map<string, {
    resolve: (response: RpcResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout;
  }>();

  private constructor(private readonly socket: Socket) {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk: Buffer) => {
      try {
        decoder.push(chunk, body => {
          const frame: unknown = JSON.parse(body.toString('utf8')) as unknown;
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

  static async connect(path: string): Promise<PipeClient> {
    const socket = createConnection(path);
    const client = new PipeClient(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Pipe connect timeout')); }, 5_000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    return client;
  }

  request(method: string, params: unknown = {}): Promise<RpcResponse> {
    if (this.socket.destroyed) return Promise.reject(new Error('Pipe disconnected'));
    if (this.pending.size >= 16) return Promise.reject(new Error('Too many pending probe requests'));
    const id = `probe-${++this.sequence}`;
    let buffer: Buffer;
    try { buffer = encodeFrame({ jsonrpc: '2.0', id, method, params }); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Pipe RPC timeout')); }, 5_000);
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
