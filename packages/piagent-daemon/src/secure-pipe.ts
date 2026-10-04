import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { isObject } from '@piagent/protocol';

const repositoryBroker = fileURLToPath(new URL('../../../transport/PiAgent.PipeHost/bin/Release/net8.0-windows/PiAgent.PipeHost.dll', import.meta.url));
export const defaultBroker = existsSync(repositoryBroker) ? repositoryBroker
  : fileURLToPath(new URL('../../../../transport/PiAgent.PipeHost/bin/Release/net8.0-windows/PiAgent.PipeHost.dll', import.meta.url));
export function credentialPath(name: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) throw new Error('Invalid credential pipe name');
  // AppData can be redirected into a packaged parent's LocalCache for child processes.
  // User-profile data is shared with IDEs launched directly from the Windows shell.
  return join(process.env['USERPROFILE'] ?? homedir(), '.piagent', 'security', name, 'token');
}
class Peer extends Duplex {
  constructor(readonly id: number, private readonly command: (value: unknown) => void) { super(); }
  override _read(): void {}
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      for (let offset = 0; offset < chunk.length; offset += 32768)
        this.command({ type: 'data', id: this.id, data: chunk.subarray(offset, offset + 32768).toString('base64') });
      callback();
    } catch (error) { callback(error instanceof Error ? error : new Error('Pipe host write failed')); }
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    try { this.command({ type: 'close', id: this.id }); } catch { /* Host may already have exited. */ }
    callback(error);
  }
}
export async function securePipe(name: string, authFile: string, broker: string,
  accept: (socket: Duplex, token: string) => void, diagnostic?: (error: Error) => void): Promise<{ securityDescriptor: string; close: () => Promise<void> }> {
  if (!isAbsolute(authFile) || !isAbsolute(broker)) throw new Error('Secure transport paths must be absolute');
  const child = spawn('dotnet', [broker, name, authFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const peers = new Map<number, Peer>(); let token = '', descriptor = '', pending = '', closing = false;
  const command = (value: unknown): void => {
    if (child.stdin.destroyed || child.stdin.writableLength > 4 * 1024 * 1024) throw new Error('Pipe host output queue exceeded limit');
    child.stdin.write(JSON.stringify(value) + '\n');
  };
  let readyResolve: (() => void) | undefined, readyReject: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => { readyReject?.(new Error('Pipe host startup timed out')); child.kill(); }, 10_000);
  const failed = (error: Error): void => {
    readyReject?.(error); for (const peer of peers.values()) peer.destroy(); if (!closing) diagnostic?.(error);
  };
  child.on('error', failed); child.stdin.on('error', failed);
  const exited = new Promise<void>(resolve => child.once('close', () => {
    clearTimeout(timer); failed(new Error('Secure pipe host stopped')); resolve();
  }));
  child.stderr.on('data', () => { /* Never forward helper configuration or credentials. */ });
  child.stdout.on('data', (data: Buffer) => {
    try {
      pending += data.toString('utf8');
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (line.length > 50000) throw new Error('Pipe host frame exceeds limit');
        const value: unknown = JSON.parse(line);
        if (!isObject(value)) throw new Error('Invalid pipe host frame');
        if (value['type'] === 'ready' && !token && typeof value['token'] === 'string' && /^[a-f0-9]{64}$/.test(value['token'])
          && typeof value['securityDescriptor'] === 'string') {
          token = value['token']; descriptor = value['securityDescriptor']; clearTimeout(timer); readyResolve?.(); continue;
        }
        const id = value['id']; if (!token || typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new Error('Invalid pipe host peer');
        if (value['type'] === 'open') {
          if (peers.has(id) || peers.size >= 16) throw new Error('Invalid pipe host connection count');
          const peer = new Peer(id, command); peers.set(id, peer); peer.once('close', () => peers.delete(id)); accept(peer, token);
        } else if (value['type'] === 'data' && typeof value['data'] === 'string' && value['data'].length <= 43692) {
          const peer = peers.get(id); const bytes = Buffer.from(value['data'], 'base64');
          if (peer && !peer.destroyed) { if (peer.readableLength + bytes.length > 2 * 1024 * 1024) peer.destroy(); else peer.push(bytes); }
        } else if (value['type'] === 'close') peers.get(id)?.destroy();
        else throw new Error('Invalid pipe host message');
      }
      if (pending.length > 50000) throw new Error('Pipe host frame exceeds limit');
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'invalid JSON' : error instanceof Error ? error.message : 'invalid transport state';
      failed(new Error(`Secure pipe host protocol failed: ${reason}`)); child.kill();
    }
  });
  try { await ready; } catch (error) { child.kill(); await exited; throw error; }
  return { securityDescriptor: descriptor, close: async () => {
    closing = true; for (const peer of peers.values()) peer.destroy();
    try { command({ type: 'stop' }); child.stdin.end(); } catch { child.kill(); }
    const kill = setTimeout(() => child.kill(), 5000); await exited; clearTimeout(kill); token = '';
  } };
}
