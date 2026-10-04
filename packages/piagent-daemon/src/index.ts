import { createHash } from 'node:crypto';
import { dirname,join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { SessionStore,UsageService } from '@piagent/core';
import { createServer } from 'node:net';
import type { Duplex } from 'node:stream';
import { Session, ChatSession, WorkspaceReader, WorkspaceChanges, Authentication } from '@piagent/core';
import { securePipe, credentialPath, defaultBroker } from './secure-pipe.js';
export { credentialPath, defaultBroker } from './secure-pipe.js';
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
  workspaceRoot?: string;
  allowWrites?: boolean;
  secure?: { brokerPath?: string; authFile?: string };
}

export async function startDaemon(options: DaemonOptions = {}): Promise<{
  path: string; securityDescriptor?: string; close: () => Promise<void>;
}> {
  if (process.platform !== 'win32') throw new Error('PiAgent daemon requires Windows Named Pipes');
  if (options.workspaceRoot && !options.omp) throw new Error('Workspace tools require OMP');
  const workspace = options.workspaceRoot ? await WorkspaceReader.create(options.workspaceRoot) : undefined;
  if (options.allowWrites && (!options.secure || !workspace)) throw new Error('Writes require secure transport and an explicit workspace');
  const changes = options.allowWrites ? await WorkspaceChanges.create(workspace!) : undefined;
  const path = pipePath(options.pipeName ?? 'piagent-dev');
  const deadline = options.ioTimeoutMs ?? 30_000;
  const maxConnections = options.maxConnections ?? 16;
  if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 300_000
    || !Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 256) {
    throw new Error('Invalid daemon limits');
  }
  const sockets = new Set<Duplex>();
  const cleanup = new Set<Promise<void>>();
  const chats = new Map<Duplex, ChatSession>();
  const retire = (socket: Duplex): void => {
    const chat = chats.get(socket); if (!chat) return;
    chats.delete(socket);
    const done = chat.dispose().catch(error => options.onDiagnostic?.(error));
    cleanup.add(done); void done.finally(() => cleanup.delete(done));
  };
  const services:{sessions?:SessionStore;usage?:UsageService}={};
  if(options.omp)services.usage=new UsageService(options.omp);
  let servicesResolve:()=>void=()=>{};
  const servicesReady=new Promise<void>(resolve=>{servicesResolve=resolve;});
  const accept = (socket: Duplex, token?: string): void => {
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
    const chat = options.omp ? new ChatSession(options.omp, event => send({ jsonrpc: '2.0', method: 'chat.event', params: event }), workspace, changes, services) : undefined;
    if (chat) chats.set(socket, chat);
    const session = new Session(chat, token ? new Authentication(token, options.pipeName ?? 'piagent-dev') : undefined);
    const authTimer = token ? setTimeout(() => { if (!session.ready) close(new Error('Authentication/handshake deadline exceeded')); }, 10_000) : undefined;
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
          void servicesReady.then(()=>session.handleAsync(body)).then(reply => { if (reply !== undefined) send(reply); })
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
      clearTimeout(authTimer);
      for (const timer of writeTimers) clearTimeout(timer);
      sockets.delete(socket);
      retire(socket);
    });
  };
  let closeTransport: () => Promise<void>;
  let securityDescriptor: string | undefined;
  if (options.secure) {
    const host = await securePipe(options.pipeName ?? 'piagent-dev', options.secure.authFile ?? credentialPath(options.pipeName ?? 'piagent-dev'),
      options.secure.brokerPath ?? defaultBroker, accept, options.onDiagnostic);
    closeTransport = host.close;
    securityDescriptor = host.securityDescriptor;
    try{if(options.omp){
      const scope=await realpath(options.workspaceRoot??options.omp.cwd);
      const namespace=createHash('sha256').update(scope.toLowerCase()).digest('hex');
      const authPath=options.secure.authFile??credentialPath(options.pipeName??'piagent-dev');
      // Resolve the broker-validated private parent once (Windows packaged apps may virtualize LocalAppData).
      services.sessions=new SessionStore(join(await realpath(dirname(authPath)),'sessions',namespace));
      await services.sessions.initialize();
    }}catch(error){await host.close();throw error;}
  } else {
    const server = createServer(accept);
    server.on('error', error => options.onDiagnostic?.(error));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once('error', onError);
      server.listen(path, () => { server.off('error', onError); resolve(); });
    });
    closeTransport = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  servicesResolve();
  let closing: Promise<void> | undefined;
  return {
    path,
    ...(securityDescriptor ? { securityDescriptor } : {}),
    close: () => {
      closing ??= (async () => {
        for (const socket of sockets) { retire(socket); socket.destroy(); }
        await closeTransport();
        await Promise.all([...cleanup]);
        await changes?.drain();
        await services.usage?.drain();
      })();
      return closing;
    },
  };
}
