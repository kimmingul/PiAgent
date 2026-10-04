import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { isAbsolute } from 'node:path';
import { TextDecoder } from 'node:util';
import { isObject, MAX_FRAME_BYTES } from '@piagent/protocol';
import { JsonlDecoder } from './jsonl.js';
import { ChunkDecoder } from './chunks.js';
export { ChunkDecoder } from './chunks.js';
export { JsonlDecoder } from './jsonl.js';

export interface OmpOptions {
  executable: string;
  cwd: string;
  /** Wrapper executable arguments (e.g. node fixture.mjs); never parsed by a shell. */
  executableArgs?: readonly string[];
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  profile?: 'restricted' | 'native';
}
export type OmpState = 'new' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
interface Pending {
  command: string;
  resolve: (frame: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** OMP v1/v2 JSONL lifecycle, separate from IDE JSON-RPC. No agent loop or IDE tools. */
export class OmpProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private currentState: OmpState = 'new';
  private sequence = 0;
  private readonly pending = new Map<string, Pending>();
  private closed: Promise<void> = Promise.resolve();
  private stopping: Promise<void> | undefined;
  private readyResolve: ((frame: Record<string, unknown>) => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private readyTimer: NodeJS.Timeout | undefined;
  private readonly options: Required<OmpOptions>;
  private readonly chunks = new ChunkDecoder();
  private protocol = 1;

  constructor(options: OmpOptions) {
    super();
    if (!isAbsolute(options.cwd)) throw new Error('OMP cwd must be absolute');
    if (!options.executable || /\.(cmd|bat)$/i.test(options.executable)) {
      throw new Error('OMP executable must be a native executable, not a shell script');
    }
    this.options = { profile:'restricted', executableArgs: [], readyTimeoutMs: 30_000, requestTimeoutMs: 30_000,
      shutdownTimeoutMs: 2_000, ...options };
    for (const ms of [this.options.readyTimeoutMs, this.options.requestTimeoutMs, this.options.shutdownTimeoutMs]) {
      if (!Number.isSafeInteger(ms) || ms < 1 || ms > 300_000) throw new Error('Invalid OMP deadline');
    }
  }

  get state(): OmpState { return this.currentState; }

  async start(): Promise<Record<string, unknown>> {
    if (this.currentState !== 'new') throw new Error('OMP manager is single-use');
    this.currentState = 'starting';
    const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(() => this.fail(new Error('OMP ready timeout')), this.options.readyTimeoutMs);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.options.executable, [...this.options.executableArgs, '--mode', 'rpc-ui'], {
        cwd: this.options.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return ready;
    }
    this.child = child;
    this.closed = new Promise<void>(resolve => {
      child.once('close', (code, signal) => {
        const expected = this.currentState === 'stopping';
        if (!expected && this.currentState !== 'failed') this.fail(new Error(`OMP exited (${code ?? signal})`));
        this.rejectAll(new Error('OMP disconnected'));
        if (expected) this.currentState = 'stopped';
        this.emit('exit', { code, signal, expected });
        resolve();
      });
    });
    child.on('error', error => this.fail(error));
    child.stdin.on('error', error => { if (this.currentState !== 'stopping') this.fail(error); });
    child.stdout.on('error', error => this.fail(error));
    // Drain all stderr, but retain/log no unbounded transcript or secrets.
    child.stderr.on('data', (chunk: Buffer) => this.emit('stderr', chunk.subarray(0, 4096).toString('utf8')));
    child.stderr.on('error', error => this.emit('diagnostic', error));
    const lines = new JsonlDecoder();
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.currentState === 'failed' || this.currentState === 'stopped') return;
      try { lines.push(chunk, line => this.onLine(line)); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    child.stdout.on('end', () => {
      try { lines.end(); this.chunks.end(); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    try {
      const frame=await ready;
      if(Array.isArray(frame['supportedProtocolVersions'])&&frame['supportedProtocolVersions'].includes(2)) {
        await this.request('negotiate_protocol',{protocolVersion:2}); this.protocol=2;
      }
      return frame;
    }
    catch (error) { await this.stop(); throw error; }
  }

  request(command: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.currentState !== 'ready' || this.child === undefined) return Promise.reject(new Error('OMP is not ready'));
    if (!['negotiate_protocol','get_state', 'get_available_commands', 'get_session_stats', 'abort', 'fork', 'new_session', 'switch_session', 'prompt', 'set_host_tools',
      'get_available_models','set_model','get_available_thinking_levels','set_thinking_level','set_event_filter',
      'steer','follow_up','remove_queued_message','promote_queued_message','abort_retry','compact','get_subagents',
      'get_subagent_messages','cancel_subagent','steer_subagent','set_subagent_subscription','get_messages_page',
      'get_entries','get_tree','get_last_assistant_text','set_session_name','get_login_providers','login','export_html',
      'set_fast_mode','set_auto_compaction','set_auto_retry','set_cache_warming','goal'].includes(command)) {
      return Promise.reject(new Error('OMP command not enabled in this slice'));
    }
    if ('id' in fields || 'type' in fields) return Promise.reject(new Error('Reserved OMP fields'));
    if (this.pending.size >= 64) return Promise.reject(new Error('Too many pending OMP requests'));
    const id = `piagent-${++this.sequence}`;
    let body: Buffer;
    try { body = Buffer.from(JSON.stringify({ ...fields, id, type: command }), 'utf8'); }
    catch (error) { return Promise.reject(error); }
    if (body.length + 1 > MAX_FRAME_BYTES || this.child.stdin.writableLength > 2 * MAX_FRAME_BYTES) return Promise.reject(new Error('OMP request exceeds limit'));
    const child = this.child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OMP request timeout: ${command}`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { command, resolve, reject, timer });
      child.stdin.write(Buffer.concat([body, Buffer.from('\n')]), error => {
        if (error) this.fail(error);
      });
    });
  }

  stop(): Promise<void> {
    this.stopping ??= this.stopChild();
    return this.stopping;
  }

  /** Host-tool replies are not RPC commands and have no response/timeout entry. */
  async hostToolResult(id: string, text: string, isError = false): Promise<void> {
    if (this.currentState !== 'ready' || !this.child || !id || Buffer.byteLength(id) > 256) throw new Error('Invalid host reply state/id');
    const body = Buffer.from(JSON.stringify({ type: 'host_tool_result', id, ...(isError ? { isError: true } : {}),
      result: { content: [{ type: 'text', text }] } }) + '\n');
    if (body.length > MAX_FRAME_BYTES || this.child.stdin.writableLength > 2 * MAX_FRAME_BYTES) throw new Error('Host reply exceeds limit');
    const child = this.child;
    await new Promise<void>((resolve, reject) => child.stdin.write(body, error => error ? reject(error) : resolve()));
  }

  async uiResponse(id: string, fields: {value?:string;confirmed?:boolean;cancelled?:true}):Promise<void> {
    if(this.currentState!=='ready'||!this.child||!id||Buffer.byteLength(id)>256)throw new Error('Invalid UI response');
    const body=Buffer.from(JSON.stringify({type:'extension_ui_response',id,...fields})+'\n');
    if(body.length>MAX_FRAME_BYTES||this.child.stdin.writableLength>2*MAX_FRAME_BYTES)throw new Error('UI response exceeds limit');
    const child=this.child;
    await new Promise<void>((resolve,reject)=>child.stdin.write(body,error=>error?reject(error):resolve()));
  }

  private async stopChild(): Promise<void> {
    if (this.currentState === 'stopped') return;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyReject?.(new Error('OMP stopped before ready'));
    this.readyResolve = undefined;
    this.readyReject = undefined;
    this.rejectAll(new Error('OMP stopping'));
    const failed = this.currentState === 'failed';
    if (!failed) this.currentState = 'stopping';
    this.child?.stdin.end();
    const timer = setTimeout(() => this.child?.kill(), this.options.shutdownTimeoutMs);
    try { await this.closed; }
    finally { clearTimeout(timer); if (!failed) this.currentState = 'stopped'; }
  }

  private onLine(line: Buffer): void {
    let frame: unknown;
    try { frame = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line)) as unknown; }
    catch { this.emit('diagnostic', new Error('Dropped malformed OMP JSONL frame')); return; }
    if (!isObject(frame) || typeof frame['type'] !== 'string') {
      this.emit('diagnostic', new Error('Dropped invalid OMP envelope')); return;
    }
    if (frame['type'] === 'ready') {
      const versions = frame['supportedProtocolVersions'];
      if (this.currentState !== 'starting' || (frame['protocolVersion'] ?? 1) !== 1
        || (versions !== undefined && (!Array.isArray(versions) || !versions.includes(1)))) {
        this.fail(new Error('Unsupported OMP ready/protocol; only JSONL v1 is implemented')); return;
      }
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.currentState = 'ready';
      this.readyResolve?.(frame);
      this.readyResolve = undefined;
      this.readyReject = undefined;
    }
    try {
      if(frame['type']==='rpc_chunk'&&this.protocol!==2)throw new Error('Unnegotiated OMP chunks');
      frame=this.chunks.accept(frame);if(!frame)return;
    } catch(error){this.fail(error instanceof Error?error:new Error(String(error)));return;}
    if(!isObject(frame))return;
    if (frame['type'] === 'response' && typeof frame['id'] === 'string') {
      const pending = this.pending.get(frame['id']);
      if (pending) {
        this.pending.delete(frame['id']);
        clearTimeout(pending.timer);
        if (frame['command'] !== pending.command || typeof frame['success'] !== 'boolean') {
          pending.reject(new Error('Mismatched OMP response'));
        } else if (frame['success']) {
          if(pending.command==='negotiate_protocol')this.protocol=2;
          pending.resolve(frame);
        }
        else pending.reject(new Error(`OMP command failed: ${pending.command}`));
      }
    }
    this.emit('frame', frame);
  }

  private fail(error: Error): void {
    if (this.currentState === 'failed' || this.currentState === 'stopped') return;
    this.currentState = 'failed';
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyReject?.(error);
    this.readyResolve = undefined;
    this.readyReject = undefined;
    this.rejectAll(error);
    this.emit('diagnostic', error);
    this.child?.kill();
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
