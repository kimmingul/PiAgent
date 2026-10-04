import { randomUUID } from 'node:crypto';
import { OmpProcess } from '@piagent/omp';
import type { OmpOptions } from '@piagent/omp';
import { isObject } from '@piagent/protocol';
import { contextPrompt } from './context.js';
import { WorkspaceReader, workspaceTools } from './workspace.js';
import { pathToFileURL } from 'node:url';
import { WorkspaceChanges, editTool, batchEditTool } from './changes.js';
import { Approvals } from './approvals.js';
import { SessionStore, SessionLease } from './sessions.js';
import { UsageService } from './usage.js';
import {control} from './omp-controls.js';
import {Interactions} from './interactions.js';
import {uiEvent} from './omp-events.js';
import {DesignerBridge,designerTools,designerPrompt} from './designer.js';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {extensions} from './extensions.js';
export interface ChatServices { sessions?:SessionStore; usage?:UsageService; }
export const WORKSPACE_BIND_CAPABILITY='workspace.bind.v1';
export const APPROVAL_MODE_CAPABILITY='chat.approval.v1';
export type WorkspaceBinding={workspace:WorkspaceReader;changes?:WorkspaceChanges;sessions:SessionStore};

export const CHAT_CAPABILITY = 'chat.v1';
export class ChatError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
export interface ChatEvent {
  sessionId: string; turnId: string | null; sequence: number;
  kind: 'omp_event' | 'started' | 'delta' | 'completed' | 'cancelled' | 'error' | 'warning' | 'closed' | 'tool_started' | 'tool_completed' | 'approval_requested' | 'approval_resolved';
  text?: string;
  approval?: Record<string, unknown>;
  frame?: Record<string,unknown>;
}
/** One connection owns the OMP child, turn and optional saved-session lease/workspace services. */
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
  private writesEnabled = false;
  private batchEnabled=false;
  private writeToolActive=false;
  private approvals: Approvals | undefined;
  private lease:SessionLease|undefined;
  private answer='';
  private approvalMode='always-ask';
  private readonly tools = new Map<string, AbortController>();
  private readonly seenTools = new Set<string>();
  private interactions:Interactions|undefined;
  private readonly designer=new DesignerBridge(frame=>this.sendOmp(frame));
  constructor(private options: OmpOptions, private readonly send: (event: ChatEvent) => void,
    private workspace?: WorkspaceReader, private changes?: WorkspaceChanges, private services:ChatServices={},
    private readonly bindWorkspace?:(uri:unknown)=>Promise<WorkspaceBinding>) {}
  get supportsWorkspaceBinding():boolean {return !!this.bindWorkspace;}
  get supportsWorkspace(): boolean { return !!this.workspace; }
  get supportsWrites(): boolean { return !!this.changes||this.options.profile==='native'; }
  get supportsSessions():boolean {return !!this.services.sessions;}
  get supportsUsage():boolean {return !!this.services.usage;}

  async handle(method: string, params: Record<string, unknown>, workspaceNegotiated = false, writesNegotiated = false, sessionsNegotiated=false, usageNegotiated=false, batchNegotiated=false, controlsNegotiated=false,designerNegotiated=false): Promise<Record<string, unknown>> {
    if (this.disposed) throw new ChatError(-32010, 'Connection closed');
    if(method==='sessions.list') {
      if(!sessionsNegotiated||!this.services.sessions)throw new ChatError(-32005,'Session capability not negotiated');
      if(Object.keys(params).length)throw new ChatError(-32602,'Invalid params');
      return {sessions:await this.services.sessions.list()};
    }
    if (method === 'chat.open') {
      await this.retiring;
      if (this.disposed) throw new ChatError(-32010, 'Connection closed');
      if (Object.keys(params).some(key=>!['savedSessionId','workspaceUri','approvalMode'].includes(key))) throw new ChatError(-32602, 'Invalid params');
      if(params['approvalMode']!==undefined&&!['always-ask','write','yolo','plan'].includes(String(params['approvalMode'])))throw new ChatError(-32602,'Invalid approval mode');
      if('savedSessionId' in params&&!sessionsNegotiated)throw new ChatError(-32005,'Session capability not negotiated');
      if (this.opening || this.omp) throw new ChatError(-32011, 'Session already open or opening');
      this.opening = true;
      try {
        if('workspaceUri' in params) {
          if(!this.bindWorkspace)throw new ChatError(-32005,'Workspace binding unavailable');
          const bound=await this.bindWorkspace(params['workspaceUri']);
          this.workspace=bound.workspace;this.changes=bound.changes;this.services={...this.services,sessions:bound.sessions};
          this.options={...this.options,cwd:bound.workspace.root};
        }
      }catch(error){this.opening=false;throw error;}
      try {this.lease=sessionsNegotiated&&this.services.sessions?await this.services.sessions.acquire(params['savedSessionId']):undefined;}
      catch(error){this.opening=false;throw error;}
      this.approvalMode=String(params['approvalMode']??this.lease?.record.approvalMode??'always-ask');
      if(this.lease){this.lease.record.approvalMode=this.approvalMode;}
      let nativeArgs:string[]=[];
      const native=this.options.profile==='native'&&this.approvalMode!=='plan';
      if(native) {
        if(!controlsNegotiated||!this.lease||!this.workspace||!workspaceNegotiated||!writesNegotiated) {await this.lease?.release();this.lease=undefined;this.opening=false;throw new ChatError(-32005,'Native OMP requires interactive controls, private sessions and negotiated workspace writes');}
        try {const dir=await this.lease.store.prepareOmpDirectory(this.lease.record.savedSessionId);
          const config=join(dir,`piagent-host-${randomUUID()}.yml`);
          await writeFile(config,JSON.stringify({tools:{approvalMode:this.approvalMode}}),{encoding:'utf8',flag:'wx'});nativeArgs=['--config',config,'--approval-mode',this.approvalMode];}
        catch(error){await this.lease.release();this.lease=undefined;this.opening=false;throw error;}
      }
      const omp = new OmpProcess({ ...this.options, executableArgs: [
        ...(this.options.executableArgs ?? []), ...(native?nativeArgs:['--no-tools', '--no-extensions', '--no-skills',
        '--no-rules', '--no-lsp']), '--no-title', '--no-pty',
        ...(this.lease?['--session-dir',this.lease.store.ompDirectory(this.lease.record.savedSessionId)]:['--no-session']),
      ] });
      this.omp = omp;
      if(controlsNegotiated)this.interactions=new Interactions(omp,frame=>this.sendOmp(frame));
      omp.on('frame', (frame: Record<string, unknown>) => this.onFrame(frame));
      omp.on('exit', ({ expected }: { expected: boolean }) => {
        if (!expected && this.omp === omp) { this.finish('error', 'OMP disconnected'); void this.closeSession(); }
      });
      try {
        await omp.start();
        if(native) {
          await omp.request('set_event_filter',{events:null,messageUpdates:'delta'});
          await omp.request('set_subagent_subscription',{level:'progress'});
        }
        if(this.lease?.record.ompFile) await omp.request('switch_session',{sessionPath:await this.lease.store.verifyOmpFile(this.lease.record.savedSessionId,this.lease.record.ompFile)});
        else await omp.request('new_session'); // Never auto-resume an unrelated conversation.
        if(this.lease){const state=await omp.request('get_state');await this.lease.store.bind(this.lease.record,isObject(state['data'])?state['data']['sessionFile']:undefined);await this.lease.save();}
        this.workspaceEnabled = workspaceNegotiated && !!this.workspace;
        this.writesEnabled = this.approvalMode!=='plan'&&this.workspaceEnabled && writesNegotiated && (!!this.changes||native);
        this.batchEnabled=this.writesEnabled&&batchNegotiated;
        this.designer.enabled=designerNegotiated&&this.workspaceEnabled;
        this.designer.writesEnabled=this.writesEnabled;
        this.approvals = this.writesEnabled&&this.changes ? new Approvals(this.changes, (kind, approval) => this.emit(kind, undefined, approval)) : undefined;
        if (this.workspaceEnabled) await omp.request('set_host_tools', { tools: [...workspaceTools, ...(this.approvals ? [editTool] : []),...(this.batchEnabled&&this.approvals?[batchEditTool]:[]),...(this.designer.enabled?designerTools.filter(tool=>this.writesEnabled||tool.name==='ide_designer_inspect'):[])].map(tool => ({...tool, loadMode: 'essential'})) });
        if (this.disposed) throw new Error('Connection closed during startup');
        this.id = randomUUID(); this.sequence = 0;
        return { sessionId: this.id, approvalMode:this.approvalMode, approvalModes:['always-ask','write','yolo','plan'], ompProfile:native?'native':'restricted', ompControlsEnabled:controlsNegotiated, toolsEnabled: this.workspaceEnabled, usageEnabled:usageNegotiated&&this.supportsUsage, sessionsEnabled:sessionsNegotiated&&this.supportsSessions,
          ...(this.lease?{savedSessionId:this.lease.record.savedSessionId,transcript:this.lease.record.transcript}:{}),
          ...(this.workspaceEnabled ? { workspaceUri: pathToFileURL(this.workspace!.root).href, readOnly: !this.writesEnabled, writeEnabled: this.writesEnabled } : {}) };
      } catch (error) {
        await omp.stop(); this.omp = undefined;
        this.interactions?.clear();this.interactions=undefined;this.designer.close();
        await this.lease?.release();this.lease=undefined;
        throw new ChatError(-32010, error instanceof Error ? error.message : 'OMP startup failed');
      } finally { this.opening = false; }
    }
    if (!this.id || !this.omp || this.opening || params['sessionId'] !== this.id)
      throw new ChatError(-32012, 'Unknown or unavailable session');
    if(method==='chat.extensions') {
      if(!controlsNegotiated||this.options.profile!=='native')throw new ChatError(-32005,'Native OMP extensions unavailable');
      if(this.turn)throw new ChatError(-32013,'Wait until the turn finishes');
      if(Object.keys(params).some(key=>!['sessionId','action','id','enabled'].includes(key)))throw new ChatError(-32602,'Invalid extension params');
      if(this.approvalMode==='plan'&&params['action']!=='listExtensions')throw new ChatError(-32005,'Leave plan mode before changing extensions');
      if(params['action']==='toggleMcpServer') {
        const current=await extensions(this.options,{action:'listExtensions'});
        if(typeof params['enabled']!=='boolean'||typeof params['id']!=='string'||! /^[a-zA-Z0-9_.-]{1,128}$/.test(params['id'])||!Array.isArray(current['mcpServers'])||!current['mcpServers'].some(value=>isObject(value)&&value['id']===params['id']))throw new ChatError(-32602,'Unknown MCP server');
        await this.omp.request('prompt',{message:'/mcp '+(params['enabled']?'enable':'disable')+' '+params['id']});
        return extensions(this.options,{action:'listExtensions'});
      }
      return extensions(this.options,params);
    }
    if(method==='chat.setApproval') {
      if(Object.keys(params).some(key=>!['sessionId','mode'].includes(key))||!['always-ask','write','yolo','plan'].includes(String(params['mode'])))throw new ChatError(-32602,'Invalid approval mode');
      if(this.turn||this.writeToolActive)throw new ChatError(-32013,'Wait until the turn finishes');
      if(!this.lease)throw new ChatError(-32005,'Private saved session required');
      const savedSessionId=this.lease.record.savedSessionId;
      await this.closeSession();
      return this.handle('chat.open',{savedSessionId,approvalMode:params['mode']},workspaceNegotiated,writesNegotiated,sessionsNegotiated,usageNegotiated,batchNegotiated,controlsNegotiated,designerNegotiated);
    }
    if(method==='designer.reply'||method==='designer.decide') {
      if(!designerNegotiated)throw new ChatError(-32005,'Designer capability not negotiated');
      const allowed=method==='designer.reply'?['sessionId','requestId','result','error']:['sessionId','proposalId','approved'];
      if(Object.keys(params).some(key=>!allowed.includes(key)))throw new ChatError(-32602,'Invalid designer params');
      return method==='designer.reply'?this.designer.reply(params['requestId'],params['result'],params['error']):this.designer.decide(params['proposalId'],params['approved']);
    }
    if(method==='omp.control') {
      if(!controlsNegotiated)throw new ChatError(-32005,'OMP controls capability not negotiated');
      if(Object.keys(params).some(key=>!['sessionId','command','fields'].includes(key)))throw new ChatError(-32602,'Invalid params');
      return control(this.omp,params['command'],params['fields']??{},!!this.turn);
    }
    if(method==='omp.respond') {
      if(!controlsNegotiated||!this.interactions)throw new ChatError(-32005,'OMP interactions unavailable');
      if(Object.keys(params).some(key=>!['sessionId','requestId','answer'].includes(key)))throw new ChatError(-32602,'Invalid params');
      return this.interactions.respond(params['requestId'],params['answer']);
    }
    const keys = method === 'chat.prompt' ? ['sessionId', 'message', 'context','attachments'] : method === 'chat.cancel' ? ['sessionId', 'turnId']
      : method === 'changes.decide' ? ['sessionId','proposalId','revision','decision']
      : method === 'changes.restore' ? ['sessionId','checkpointId','revision']
      : method === 'changes.previewRestore' ? ['sessionId','checkpointId'] : ['sessionId'];
    if (Object.keys(params).some(key => !keys.includes(key))) throw new ChatError(-32602, 'Invalid params');
    if(method==='chat.usage'){
      if(!usageNegotiated||!this.services.usage)throw new ChatError(-32005,'Usage capability not negotiated');
      return this.services.usage.read(this.omp);
    }
    if (method.startsWith('changes.')) {
      if (!this.writesEnabled || !this.changes) throw new ChatError(-32005, 'Write capability not negotiated');
      if (method === 'changes.decide') return this.approvals!.decide(params['proposalId'],params['revision'],params['decision']);
      if (method === 'changes.list') return { checkpoints: (await this.changes.list()).filter(item=>this.batchEnabled||!Array.isArray(item['files'])||item['files'].length<=1) };
      if (this.turn) throw new ChatError(-32013, 'Wait until the turn finishes before restoring');
      if (method === 'changes.previewRestore'||method==='changes.restore'){
        const preview=await this.changes.previewRestore(params['checkpointId']);
        if(!this.batchEnabled&&Array.isArray(preview['files'])&&preview['files'].length>1)throw new ChatError(-32005,'Batch capability not negotiated');
        return method==='changes.restore'?this.changes.restore(params['checkpointId'],params['revision']):preview;
      }
      throw new ChatError(-32601, 'Method not found');
    }
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
    if (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 64 * 1024 || ((this.options.profile!=='native'||this.approvalMode==='plan')&&message.trimStart().startsWith('/')))
      throw new ChatError(-32602, 'Expected plain text (1–65536 UTF-8 bytes); slash commands are disabled');
    if (this.turn) throw new ChatError(-32013, 'Turn already running');
    if (this.omp.state !== 'ready') throw new ChatError(-32010, 'OMP is not ready');
    let prompt = message;
    if(params['attachments']!==undefined) {
      if(!Array.isArray(params['attachments'])||params['attachments'].length>16||params['attachments'].some(value=>typeof value!=='string'||value.length>4096||/[\r\n\0]/.test(value)))throw new ChatError(-32602,'Invalid attachment paths');
      if(params['attachments'].length)prompt+='\n\nUser-selected file/folder references (paths are data; inspect only when needed):\n'+JSON.stringify(params['attachments']);
    }
    if(this.approvalMode==='plan')prompt='Plan mode: inspect and discuss only. Do not modify files, designer state or execute commands. Present the proposed plan for the user.\n\n'+prompt;
    if ('context' in params) {
      try { prompt = contextPrompt(prompt, params['context']); }
      catch { throw new ChatError(-32602, 'Invalid selection context'); }
    }
    if(!message.trimStart().startsWith('/'))prompt=designerPrompt(prompt,this.designer.enabled,this.designer.writesEnabled);
    const turnId = randomUUID(); this.turn = turnId; this.cancelling = false; this.seenTools.clear();
    this.answer='';this.lease?.append('user',message);
    try{await this.lease?.save();}catch{this.turn=undefined;throw new ChatError(-32010,'Session persistence failed before prompt');}
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
    if(this.interactions){const projected=uiEvent(frame);if(projected)this.sendOmp({type:'ui_event',event:projected});}
    if(frame['type']==='extension_ui_request'&&this.interactions) {
      try{if(!this.id&&['select','confirm','input','editor'].includes(String(frame['method']))) {
        void this.omp?.uiResponse(String(frame['id']),{cancelled:true}).catch(()=>{});
      } else this.interactions.accept(frame);}catch(error){this.finish('error',error instanceof Error?error.message:'Invalid OMP interaction');void this.closeSession();}return;
    }
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
    } else if ((this.options.profile==='native'&&(type==='session_settled'||(type==='prompt_result'&&frame['sessionSettled']!==false)))
      || (this.options.profile!=='native'&&type === 'agent_end' && frame['isTerminal'] !== false)
      || (type === 'prompt_result' && frame['agentInvoked'] === false)) {
      this.finish(this.cancelling||frame['status']==='aborted' ? 'cancelled' : frame['status']==='error'?'error':'completed',isObject(frame['error'])?String(frame['error']['message']):undefined);
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
    const designing=this.designer.enabled&&designerTools.some(tool=>tool.name===name);
    const proposing = (name === 'workspace_propose_edit'||(name==='workspace_propose_changes'&&this.batchEnabled)) && !!this.approvals;
    const timeout = setTimeout(() => controller.abort('deadline'), proposing||designing ? 370_000 : 10_000);
    this.emit('tool_started', name === 'workspace_read_file' ? 'workspace_read_file' : name === 'workspace_search' ? 'workspace_search' : proposing||designing ? String(name) : 'unknown');
    let ownsWrite=false;
    try {
      let text: string, isError = false;
      try {
        if(proposing||(designing&&name!=='ide_designer_inspect')) {
          if(this.writeToolActive)throw new Error('Another IDE/file approval is pending');
          this.writeToolActive=true;ownsWrite=true;
        }
        text = JSON.stringify(await Promise.race([designing?this.designer.execute(String(name),frame['arguments'],controller.signal):proposing ? this.approvals!.propose(frame['arguments'],controller.signal,name==='workspace_propose_changes')
        : this.workspace!.execute(String(name), frame['arguments'], controller.signal), aborted])); }
      catch (error) {
        if (controller.signal.aborted && controller.signal.reason !== 'deadline') return;
        isError = true; text = controller.signal.reason === 'deadline' ? 'Workspace tool deadline exceeded'
          : error instanceof Error && !('code' in error) ? error.message : 'Workspace request failed or path excluded';
      }
      if ((controller.signal.aborted && controller.signal.reason !== 'deadline') || this.omp !== omp || this.turn !== turn || this.cancelling) return;
      await omp.hostToolResult(id, text, isError);
      if (this.turn === turn) this.emit('tool_completed', isError ? 'Workspace request rejected' : String(name));
    } catch { if (this.turn === turn) { this.finish('error', 'Workspace tool transport failed'); void this.closeSession(); } }
    finally { if(ownsWrite)this.writeToolActive=false;clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort); if (this.tools.get(id) === controller) this.tools.delete(id); }
  }
  private cancelTools(): void { for (const controller of this.tools.values()) controller.abort(); this.tools.clear(); }
  private sendOmp(frame:Record<string,unknown>):void {
    if(!this.id||this.disposed)return;
    this.send({sessionId:this.id,turnId:this.turn??null,sequence:++this.sequence,kind:'omp_event',frame});
  }
  private emit(kind: ChatEvent['kind'], text?: string, approval?: Record<string, unknown>): void {
    if (!this.id || this.disposed) return;
    if(kind==='delta'&&text&&this.answer.length<2_000_000)this.answer+=text.slice(0,2_000_000-this.answer.length);
    this.send({ sessionId: this.id, turnId: this.turn ?? null, sequence: ++this.sequence, kind,
      ...(text === undefined ? {} : { text }), ...(approval ? {approval} : {}) });
  }
  private finish(kind: 'completed' | 'cancelled' | 'error', text?: string): void {
    if (!this.turn) return;
    this.cancelTools();
    this.lease?.append('assistant',this.answer);this.answer='';this.lease?.append('status',kind+(text?': '+text:''));
    if(this.lease)void this.lease.save().catch(()=>this.emit('warning','Session persistence failed; current OMP remains active'));
    clearTimeout(this.timer); this.emit(kind, text); this.turn = undefined; this.cancelling = false;
  }
  private closeSession(): Promise<void> {
    if (this.retiring) return this.retiring;
    this.finish('cancelled');
    const omp = this.omp; this.omp = undefined;
    this.interactions?.clear();this.interactions=undefined;
    this.designer.close();
    this.emit('closed'); this.id = undefined;
    const lease=this.lease;this.lease=undefined;
    const done = (async()=>{await omp?.stop();await lease?.release();})(); this.retiring = done;
    void done.finally(() => { if (this.retiring === done) this.retiring = undefined; }).catch(() => {});
    return done;
  }
  async dispose(): Promise<void> { this.disposed = true; await this.closeSession(); }
}
