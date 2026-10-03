import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { Session, ChatSession } from '@piagent/core';
import type { OmpOptions } from '@piagent/omp';
import { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } from '@piagent/protocol';
export { PipeClient } from './pipe-client.js';

export function pipePath(name: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) throw new Error('Invalid pipe name');
  return `\\\\.\\pipe\\${name}`;
}

export interface DaemonOptions {
  pipeName?: string;
  ioTimeoutMs?: number;
  maxConnections?: number;
  onDiagnostic?: (error: Error) => void;
  omp?: OmpOptions;
}

export async function startDaemon(options: DaemonOptions = {}): Promise<{
  path: string; close: () => Promise<void>;
}> {
  if (process.platform !== 'win32') throw new Error('PiAgent daemon requires Windows Named Pipes');
  const path = pipePath(options.pipeName ?? 'piagent-dev');
  const deadline = options.ioTimeoutMs ?? 30_000;
  const maxConnections = options.maxConnections ?? 16;
  if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 300_000
    || !Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 256) {
    throw new Error('Invalid daemon limits');
  }
  const sockets = new Set<Socket>();
  const cleanup = new Set<Promise<void>>();
  const chats = new Map<Socket, ChatSession>();
  const retire = (socket: Socket): void => {
    const chat = chats.get(socket); if (!chat) return;
    chats.delete(socket);
    const done = chat.dispose().catch(error => options.onDiagnostic?.(error));
    cleanup.add(done); void done.finally(() => cleanup.delete(done));
  };
  const server = createServer(socket => {
    if (sockets.size >= maxConnections) { socket.destroy(); return; }
    sockets.add(socket);
    const frames = new FrameDecoder();
    const writeTimers = new Set<NodeJS.Timeout>();
    let readTimer: NodeJS.Timeout;
    const close = (error: Error): void => { options.onDiagnostic?.(error); socket.destroy(); };
    const send = (message: unknown): void => {
      if (socket.destroyed) return;
      try {
        const buffer = encodeFrame(message);
        if (socket.writableLength + buffer.length > 2 * MAX_FRAME_BYTES) throw new Error('Pipe output queue exceeds limit');
        const timer = setTimeout(() => close(new Error('Pipe write deadline exceeded')), deadline);
        writeTimers.add(timer);
        socket.write(buffer, error => {
          clearTimeout(timer); writeTimers.delete(timer);
          if (error && !socket.destroyed) close(error);
        });
      } catch (error) { close(error instanceof Error ? error : new Error(String(error))); }
    };
    const chat = options.omp ? new ChatSession(options.omp, event => send({ jsonrpc: '2.0', method: 'chat.event', params: event })) : undefined;
    if (chat) chats.set(socket, chat);
    const session = new Session(chat);
    let inFlight = 0;
    const nextReadDeadline = (): void => {
      clearTimeout(readTimer);
      readTimer = setTimeout(() => close(new Error('Pipe read/idle deadline exceeded')), deadline);
    };
    nextReadDeadline();
    socket.on('data', (chunk: Buffer) => {
      try {
        frames.push(chunk, body => {
          if (socket.destroyed) return;
          nextReadDeadline(); // Full-frame progress only; trickled bytes do not extend deadline.
          if (++inFlight > 16) throw new Error('Too many pending RPC requests');
          void session.handleAsync(body).then(reply => { if (reply !== undefined) send(reply); })
            .catch(error => close(error instanceof Error ? error : new Error(String(error))))
            .finally(() => { inFlight--; });
        });
      } catch (error) { close(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on('end', () => {
      try { frames.end(); }
      catch (error) { close(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on('error', error => options.onDiagnostic?.(error));
    socket.on('close', () => {
      clearTimeout(readTimer);
      for (const timer of writeTimers) clearTimeout(timer);
      sockets.delete(socket);
      retire(socket);
    });
  });
  server.on('error', error => options.onDiagnostic?.(error));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(path, () => { server.off('error', onError); resolve(); });
  });
  let closing: Promise<void> | undefined;
  return {
    path,
    close: () => {
      closing ??= new Promise<void>((resolve, reject) => {
        for (const socket of sockets) { retire(socket); socket.destroy(); }
        server.close(error => error ? reject(error) : resolve());
      }).then(async () => { await Promise.all([...cleanup]); });
      return closing;
    },
  };
}
