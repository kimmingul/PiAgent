import { randomUUID } from 'node:crypto';
import { OmpProcess } from '@piagent/omp';
import type { OmpOptions } from '@piagent/omp';
import { isObject } from '@piagent/protocol';
import { contextPrompt } from './context.js';
import { WorkspaceReader, workspaceTools } from './workspace.js';
import { pathToFileURL } from 'node:url';

export const CHAT_CAPABILITY = 'chat.v1';
export class ChatError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
export interface ChatEvent {
  sessionId: string; turnId: string | null; sequence: number;
  kind: 'started' | 'delta' | 'completed' | 'cancelled' | 'error' | 'closed' | 'tool_started' | 'tool_completed';
  text?: string;
}
/** One ephemeral OMP process owned by one adapter connection, with opt-in read-only workspace tools. */
export class ChatSession {
  private omp: OmpProcess | undefined;
  private id: string | undefined;
  private turn: string | undefined;
  private cancelling = false;
  private opening = false;
  private disposed = false;
  private retiring: Promise<void> | undefined;
  private sequence = 0;
  private timer: NodeJS.Timeout | undefined;
  private workspaceEnabled = false;
  private readonly tools = new Map<string, AbortController>();
  private readonly seenTools = new Set<string>();
  constructor(private readonly options: OmpOptions, private readonly send: (event: ChatEvent) => void,
    private readonly workspace?: WorkspaceReader) {}
  get supportsWorkspace(): boolean { return !!this.workspace; }

  async handle(method: string, params: Record<string, unknown>, workspaceNegotiated = false): Promise<Record<string, unknown>> {
    if (this.disposed) throw new ChatError(-32010, 'Connection closed');
    if (method === 'chat.open') {
      await this.retiring;
      if (this.disposed) throw new ChatError(-32010, 'Connection closed');
      if (Object.keys(params).length) throw new ChatError(-32602, 'Invalid params');
      if (this.opening || this.omp) throw new ChatError(-32011, 'Session already open or opening');
      this.opening = true;
      const omp = new OmpProcess({ ...this.options, executableArgs: [
        ...(this.options.executableArgs ?? []), '--no-tools', '--no-extensions', '--no-skills',
        '--no-rules', '--no-lsp', '--no-session', '--no-title', '--no-pty',
      ] });
      this.omp = omp;
      omp.on('frame', (frame: Record<string, unknown>) => this.onFrame(frame));
      omp.on('exit', ({ expected }: { expected: boolean }) => {
        if (!expected && this.omp === omp) { this.finish('error', 'OMP disconnected'); void this.closeSession(); }
      });
      try {
        await omp.start();
        await omp.request('new_session'); // Never inherit OMP auto-resumed conversation.
        this.workspaceEnabled = workspaceNegotiated && !!this.workspace;
        if (this.workspaceEnabled) await omp.request('set_host_tools', { tools: workspaceTools });
        if (this.disposed) throw new Error('Connection closed during startup');
        this.id = randomUUID(); this.sequence = 0;
        return { sessionId: this.id, toolsEnabled: this.workspaceEnabled,
          ...(this.workspaceEnabled ? { workspaceUri: pathToFileURL(this.workspace!.root).href, readOnly: true } : {}) };
      } catch (error) {
        await omp.stop(); this.omp = undefined;
        throw new ChatError(-32010, error instanceof Error ? error.message : 'OMP startup failed');
      } finally { this.opening = false; }
    }
    if (!this.id || !this.omp || this.opening || params['sessionId'] !== this.id)
      throw new ChatError(-32012, 'Unknown or unavailable session');
    const keys = method === 'chat.prompt' ? ['sessionId', 'message', 'context'] : method === 'chat.cancel' ? ['sessionId', 'turnId'] : ['sessionId'];
    if (Object.keys(params).some(key => !keys.includes(key))) throw new ChatError(-32602, 'Invalid params');
    if (method === 'chat.close') {
      await this.closeSession(); return { closed: true };
    }
    if (method === 'chat.cancel') {
      if (!this.turn || params['turnId'] !== this.turn) throw new ChatError(-32012, 'Unknown turn');
      if (!this.cancelling) {
        this.cancelling = true;
        this.cancelTools();
        try { await this.omp.request('abort'); }
        catch { this.finish('error', 'OMP cancellation failed'); await this.closeSession(); throw new ChatError(-32010, 'OMP cancellation failed'); }
        if (this.turn) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => { this.finish('cancelled'); void this.closeSession(); }, 5_000);
        }
      }
      return { requested: true };
    }
    if (method !== 'chat.prompt') throw new ChatError(-32601, 'Method not found');
    const message = params['message'];
    if (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 64 * 1024 || message.trimStart().startsWith('/'))
      throw new ChatError(-32602, 'Expected plain text (1–65536 UTF-8 bytes); slash commands are disabled');
    if (this.turn) throw new ChatError(-32013, 'Turn already running');
    if (this.omp.state !== 'ready') throw new ChatError(-32010, 'OMP is not ready');
    let prompt = message;
    if ('context' in params) {
      try { prompt = contextPrompt(message, params['context']); }
      catch { throw new ChatError(-32602, 'Invalid selection context'); }
    }
    const turnId = randomUUID(); this.turn = turnId; this.cancelling = false; this.seenTools.clear();
    this.emit('started');
    this.timer = setTimeout(() => {
      this.finish('error', 'Turn deadline exceeded'); void this.closeSession();
    }, 600_000);
    try {
      const response = await this.omp.request('prompt', { message: prompt });
      if (isObject(response['data']) && response['data']['agentInvoked'] === false) this.finish('completed');
      return { sessionId: this.id, turnId, accepted: true };
    } catch (error) {
      this.finish('error', error instanceof Error ? error.message : 'Prompt failed');
      // A timed-out acknowledgement might still have started a turn. Retire the process.
      await this.closeSession(); throw new ChatError(-32010, 'OMP prompt failed');
    }
  }

  private onFrame(frame: Record<string, unknown>): void {
    if (frame['type'] === 'host_tool_cancel' && typeof frame['targetId'] === 'string') {
      this.tools.get(frame['targetId'])?.abort(); return;
    }
    if (!this.turn) return;
    const type = frame['type'];
    if (type === 'host_tool_call' && this.workspaceEnabled) { void this.runTool(frame); return; }
    const stream = frame['assistantMessageEvent'];
    if (type === 'message_update' && isObject(stream) && stream['type'] === 'text_delta' && typeof stream['delta'] === 'string') {
      // Keep each IDE notification below the physical frame limit, including JSON escaping.
      const text = stream['delta'];
      for (let index = 0; index < text.length;) {
        let end = Math.min(index + 16_384, text.length);
        const tail = text.charCodeAt(end - 1);
        if (end < text.length && tail >= 0xd800 && tail <= 0xdbff) end--;
        this.emit('delta', text.slice(index, end)); index = end;
      }
    } else if (type === 'command_output' && typeof frame['text'] === 'string') {
      this.emit('delta', frame['text'].slice(0, 16_384));
    } else if (type === 'message_end' && isObject(frame['message'])
      && ['error', 'aborted'].includes(String(frame['message']['stopReason']))) {
      if (this.cancelling || frame['message']['stopReason'] === 'aborted') this.finish('cancelled');
      else this.finish('error', typeof frame['message']['errorMessage'] === 'string'
        ? frame['message']['errorMessage'].slice(0, 2048) : 'OMP model request failed');
    } else if ((type === 'agent_end' && frame['isTerminal'] !== false)
      || (type === 'prompt_result' && frame['agentInvoked'] === false)) {
      this.finish(this.cancelling ? 'cancelled' : 'completed');
    } else if (type === 'extension_error' || type === 'host_tool_call'
      || (type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(String(frame['method'])))) {
      this.finish('error', type === 'extension_error' && typeof frame['error'] === 'string'
        ? frame['error'].slice(0, 2048) : 'OMP requires an unsupported interaction'); void this.closeSession();
    }
  }
  private async runTool(frame: Record<string, unknown>): Promise<void> {
    const id = frame['id'], name = frame['toolName'];
    if (typeof id !== 'string' || !id || Buffer.byteLength(id) > 256 || this.seenTools.has(id)) {
      this.finish('error', 'Invalid or duplicate host tool call'); void this.closeSession(); return;
    }
    const omp = this.omp, turn = this.turn;
    if (!omp || !turn || this.cancelling) return;
    this.seenTools.add(id);
    if (this.seenTools.size > 32 || this.tools.size >= 4) {
      this.finish('error', 'Workspace tool budget exceeded'); void this.closeSession(); return;
    }
    const controller = new AbortController(); this.tools.set(id, controller);
    let abortReject: ((reason?: unknown) => void) | undefined;
    const aborted = new Promise<never>((_, reject) => { abortReject = reject; });
    const onAbort = (): void => { abortReject?.(new Error('Workspace call aborted')); };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort('deadline'), 10_000);
    this.emit('tool_started', name === 'workspace_read_file' ? 'workspace_read_file' : name === 'workspace_search' ? 'workspace_search' : 'unknown');
    try {
      let text: string, isError = false;
      try { text = JSON.stringify(await Promise.race([this.workspace!.execute(String(name), frame['arguments'], controller.signal), aborted])); }
      catch (error) {
        if (controller.signal.aborted && controller.signal.reason !== 'deadline') return;
        isError = true; text = controller.signal.reason === 'deadline' ? 'Workspace tool deadline exceeded'
          : error instanceof Error && !('code' in error) ? error.message : 'Workspace request failed or path excluded';
      }
      if ((controller.signal.aborted && controller.signal.reason !== 'deadline') || this.omp !== omp || this.turn !== turn || this.cancelling) return;
      await omp.hostToolResult(id, text, isError);
      if (this.turn === turn) this.emit('tool_completed', isError ? 'Workspace request rejected' : String(name));
    } catch { if (this.turn === turn) { this.finish('error', 'Workspace tool transport failed'); void this.closeSession(); } }
    finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort); if (this.tools.get(id) === controller) this.tools.delete(id); }
  }
  private cancelTools(): void { for (const controller of this.tools.values()) controller.abort(); this.tools.clear(); }
  private emit(kind: ChatEvent['kind'], text?: string): void {
    if (!this.id || this.disposed) return;
    this.send({ sessionId: this.id, turnId: this.turn ?? null, sequence: ++this.sequence, kind,
      ...(text === undefined ? {} : { text }) });
  }
  private finish(kind: 'completed' | 'cancelled' | 'error', text?: string): void {
    if (!this.turn) return;
    this.cancelTools();
    clearTimeout(this.timer); this.emit(kind, text); this.turn = undefined; this.cancelling = false;
  }
  private closeSession(): Promise<void> {
    if (this.retiring) return this.retiring;
    this.finish('cancelled');
    const omp = this.omp; this.omp = undefined;
    this.emit('closed'); this.id = undefined;
    const done = omp?.stop() ?? Promise.resolve(); this.retiring = done;
    void done.finally(() => { if (this.retiring === done) this.retiring = undefined; }).catch(() => {});
    return done;
  }
  async dispose(): Promise<void> { this.disposed = true; await this.closeSession(); }
}
