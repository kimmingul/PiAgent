import { randomUUID } from 'node:crypto';
import { OmpProcess } from '@piagent/omp';
import type { OmpOptions } from '@piagent/omp';
import { isObject, CORE_VERSION } from '@piagent/protocol';
import { contextPrompt } from './context.js';
import { WorkspaceReader, workspaceTools } from './workspace.js';
import { pathToFileURL } from 'node:url';
import { WorkspaceChanges, editTool, batchEditTool,type TurnSnapshot } from './changes.js';
import { Approvals } from './approvals.js';
import { SessionStore, SessionLease } from './sessions.js';
import { UsageService } from './usage.js';
import {control,validateControl} from './omp-controls.js';
import {ompFeatures} from './omp-features.js';
import {ompSettings} from './omp-settings.js';
import {Interactions} from './interactions.js';
import {uiEvent} from './omp-events.js';
import {DesignerBridge,designerTools,designerPrompt} from './designer.js';
import {writeFile,copyFile,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {extensions} from './extensions.js';
import {BtwService} from './btw.js';
import {PreferencesStore} from './preferences.js';
import {Plans} from './plans.js';
import {images,type Image} from './attachments.js';
import {launchLoginTerminal} from './login-terminal.js';
import {Login} from './login.js';
import {modelRoles} from './model-roles.js';
import {Timeline,timelineNotice,type TimelinePreview} from './timeline.js';
import {setTimeout as delay} from 'node:timers/promises';
import {TurnProgress} from './turn-progress.js';
export interface ChatServices { sessions?:SessionStore; usage?:UsageService; lifecycle?:(event:Record<string,unknown>)=>void; }
export const WORKSPACE_BIND_CAPABILITY='workspace.bind.v1';
export const APPROVAL_MODE_CAPABILITY='chat.approval.v1';
export type WorkspaceBinding={workspace:WorkspaceReader;changes?:WorkspaceChanges;sessions:SessionStore};

export const CHAT_CAPABILITY = 'chat.v1';
export class ChatError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
export interface ChatEvent {
  sessionId: string; turnId: string | null; sequence: number;
  kind: 'activity' | 'omp_event' | 'started' | 'delta' | 'completed' | 'cancelled' | 'error' | 'warning' | 'closed' | 'tool_started' | 'tool_completed' | 'approval_requested' | 'approval_resolved';
  text?: string;
  approval?: Record<string, unknown>;
  frame?: Record<string,unknown>;
  toolId?:string;
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
  private progress: TurnProgress | undefined;
  private progressTimer: NodeJS.Timeout | undefined;
  private closeReason: string | undefined;
  private lastProgressPhase = '';
  private lastProgressLog = 0;
  private workspaceEnabled = false;
  private writesEnabled = false;
  private batchEnabled=false;
  private writeToolActive=false;
  private approvals: Approvals | undefined;
  private lease:SessionLease|undefined;
  private answer='';
  private flushedAnswer=0;
  private approvalMode='always-ask';
  private readonly tools = new Map<string, AbortController>();
  private readonly seenTools = new Set<string>();
  private interactions:Interactions|undefined;
  private login:Login|undefined;
  private controlOperation:string|undefined;
  private btw:BtwService|undefined;
  private timeline:Timeline|undefined;
  private timelinePending=false;
  private messagePreview:TimelinePreview|undefined;
  private restoringMessage=false;
  private plan:{path:string;hash:string}|undefined;
  private turnStarted=0;
  private finishing=false;
  private planSaving:Promise<void>|undefined;
  private contextSnapshot:string|undefined;
  private contextReaders=0;
  private readonly snapshots:string[]=[];
  private admitting=false;
  private promptSetup:Promise<void>|undefined;
  private turnSnapshot:TurnSnapshot|undefined;
  private readonly designer=new DesignerBridge(frame=>this.sendOmp(frame));
  constructor(private options: OmpOptions, private readonly send: (event: ChatEvent) => void,
    private workspace?: WorkspaceReader, private changes?: WorkspaceChanges, private services:ChatServices={},
    private readonly bindWorkspace?:(uri:unknown)=>Promise<WorkspaceBinding>) {}
  get supportsWorkspaceBinding():boolean {return !!this.bindWorkspace;}
  get supportsWorkspace(): boolean { return !!this.workspace; }
  get supportsWrites(): boolean { return !!this.changes||this.options.profile==='native'; }
  get supportsSessions():boolean {return !!this.services.sessions;}
  get supportsUsage():boolean {return !!this.services.usage;}

  async handle(method: string, params: Record<string, unknown>, workspaceNegotiated = false, writesNegotiated = false, sessionsNegotiated=false, usageNegotiated=false, batchNegotiated=false, controlsNegotiated=false,designerNegotiated=false,timelineNegotiated=false,internalTransition=false): Promise<Record<string, unknown>> {
    if(this.restoringMessage&&!internalTransition)throw new ChatError(-32013,'Message restore is in progress');
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
      const preferred=this.lease&&!params['savedSessionId']?await new PreferencesStore(this.lease.store.root).read():undefined;
      this.approvalMode=String(params['approvalMode']??this.lease?.record.approvalMode??preferred?.defaultApproval??'always-ask');
      this.plan=this.lease?.record.plan;
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
      omp.on('frame', (frame: Record<string, unknown>) => { if(this.omp===omp)this.onFrame(frame); });
      omp.on('exit', ({ expected }: { expected: boolean }) => {
        if (!expected && this.omp === omp) {
          this.closeReason='OMP 프로세스가 예기치 않게 종료되었습니다. 저장된 대화를 다시 열어 이어갈 수 있습니다.';
          if(this.turn)this.finish('error',this.closeReason);else this.emit('warning',this.closeReason);
          void this.closeSession();
        }
      });
      try {
        await omp.start();
        if(native) {
          await omp.request('set_event_filter',{events:null,messageUpdates:'delta'});
          await omp.request('set_subagent_subscription',{level:'progress'});
        }
        if(this.lease?.record.ompFile) await omp.request('switch_session',{sessionPath:await this.lease.store.verifyOmpFile(this.lease.record.savedSessionId,this.lease.record.ompFile)});
        else await omp.request('new_session'); // Never auto-resume an unrelated conversation.
        if(this.lease?.record.needsFork){const forked=await omp.request('fork');if(isObject(forked['data'])&&forked['data']['cancelled']===true)throw new Error('Conversation fork cancelled');delete this.lease.record.needsFork;}
        if(this.lease){const state=await omp.request('get_state');await this.lease.store.bind(this.lease.record,isObject(state['data'])?state['data']['sessionFile']:undefined);await this.lease.save();}
        this.workspaceEnabled = workspaceNegotiated && !!this.workspace;
        this.writesEnabled = this.approvalMode!=='plan'&&this.workspaceEnabled && writesNegotiated && (!!this.changes||native);
        this.batchEnabled=this.writesEnabled&&batchNegotiated;
        this.designer.enabled=designerNegotiated&&this.workspaceEnabled;
        this.designer.writesEnabled=this.writesEnabled;
        this.approvals = this.writesEnabled&&this.changes ? new Approvals(this.changes, (kind, approval) => this.emit(kind, undefined, approval)) : undefined;
        if (this.workspaceEnabled) await omp.request('set_host_tools', { tools: [...workspaceTools, ...(this.approvals ? [editTool] : []),...(this.batchEnabled&&this.approvals?[batchEditTool]:[]),...(this.designer.enabled?designerTools.filter(tool=>this.writesEnabled||tool.name==='ide_designer_inspect'):[])].map(tool => ({...tool, loadMode: 'essential'})) });
        if (this.disposed) throw new Error('Connection closed during startup');
        this.id = randomUUID(); this.sequence = 0; this.closeReason=undefined;
        if(this.lease&&controlsNegotiated)this.btw=new BtwService(join(this.lease.store.root,'btw'),this.options,event=>this.sendOmp({type:'ui_event',event}));
        this.timeline=this.lease&&controlsNegotiated&&timelineNegotiated?new Timeline(this.lease,this.changes):undefined;this.messagePreview=undefined;
        return { messageRestoreEnabled:!!this.timeline,sessionId: this.id, approvalMode:this.approvalMode, approvalModes:['always-ask','write','yolo','plan'], ompProfile:native?'native':'restricted', ompControlsEnabled:controlsNegotiated, toolsEnabled: this.workspaceEnabled, usageEnabled:usageNegotiated&&this.supportsUsage, sessionsEnabled:sessionsNegotiated&&this.supportsSessions,
          btwEnabled:!!this.btw,preferencesEnabled:!!this.lease,exportEnabled:controlsNegotiated,filesEnabled:this.workspaceEnabled,checkpointsEnabled:!!this.changes&&this.writesEnabled,
          ...(this.lease?{savedSessionId:this.lease.record.savedSessionId,transcript:this.lease.record.transcript}:{}),
          ...(this.workspaceEnabled ? { workspaceUri: pathToFileURL(this.workspace!.root).href, readOnly: !this.writesEnabled, writeEnabled: this.writesEnabled } : {}) };
      } catch (error) {
        await omp.stop(); this.omp = undefined;
        this.interactions?.clear();this.interactions=undefined;this.designer.close();
        await this.lease?.release();this.lease=undefined;
        throw new ChatError(-32010, error instanceof Error ? error.message : 'OMP startup failed');
      } finally { this.opening = false; }
    }
    if (!this.id || !this.omp || this.opening || this.retiring || params['sessionId'] !== this.id)
      throw new ChatError(-32012, 'Unknown or unavailable session');
    if(method==='chat.addFolder') {
      if(Object.keys(params).some(key=>!['sessionId','path'].includes(key))||typeof params['path']!=='string'||params['path'].length>4096||/[\r\n\0]/.test(params['path']))throw new ChatError(-32602,'Invalid folder');
      if(this.turn||this.options.profile!=='native'||this.approvalMode==='plan'||!controlsNegotiated)throw new ChatError(-32005,'Folder roots require idle native OMP outside plan mode');
      const {realpath}=await import('node:fs/promises');const path=await realpath(params['path']);if(!(await lstat(path)).isDirectory())throw new ChatError(-32602,'Expected folder');
      await this.omp.request('prompt',{message:'/add-dir '+path});return {path,added:true};
    }
    if(method==='chat.proceedPlan') {
      if(Object.keys(params).some(key=>!['sessionId','path'].includes(key))||!this.plan||params['path']!==this.plan.path||!this.workspace||!this.lease||!controlsNegotiated||this.turn||this.finishing||this.approvalMode!=='plan')throw new ChatError(-32005,'A completed, current plan is required');
      const plan=this.plan;const text=await new Plans(this.workspace.root).read(plan);const savedSessionId=this.lease.record.savedSessionId;
      await this.closeSession();const session=await this.handle('chat.open',{savedSessionId,approvalMode:'always-ask'},workspaceNegotiated,writesNegotiated,sessionsNegotiated,usageNegotiated,batchNegotiated,controlsNegotiated,designerNegotiated,timelineNegotiated);
      return {...session,planPrompt:'Implement the user-approved plan in '+plan.path+'. Read the full document before working. Ask for approvals under the current access mode. Use the native IDE designer for GUI work.\n\nPlan excerpt:\n'+text.slice(0,12000)};
    }
    if(method==='chat.previewMessageRestore'||method==='chat.restoreMessage') {
      if(!this.timeline||!this.lease||!controlsNegotiated)throw new ChatError(-32005,'Message restore unavailable');
      if(this.turn||this.finishing||this.admitting||this.restoringMessage)throw new ChatError(-32013,'Finish the current operation before message restore');
      const allowed=method==='chat.previewMessageRestore'?['sessionId','seq','branch']:['sessionId','messageRestoreId','revision'];
      if(Object.keys(params).some(key=>!allowed.includes(key)))throw new ChatError(-32602,'Invalid message restore params');
      if(method==='chat.previewMessageRestore'){this.messagePreview=await this.timeline.preview(params['seq'],params['branch']);return this.timeline.view(this.messagePreview);}
      const preview=this.messagePreview;if(!preview||params['messageRestoreId']!==preview.id||params['revision']!==preview.revision||Date.now()>preview.expires)throw new ChatError(-32012,'Message restore preview is stale');
      if(preview.proposal&&!this.writesEnabled)throw new ChatError(-32005,'File restore requires a write-enabled session');
      this.restoringMessage=true;const original=this.lease.record.savedSessionId,mode=this.approvalMode,changes=this.changes;
      try {
        const refreshed=await this.timeline.preview(preview.seq,preview.branch);
        if(JSON.stringify(refreshed.proposal?.files?.map(file=>[file.path,file.beforeHash,file.afterHash]))!==JSON.stringify(preview.proposal?.files?.map(file=>[file.path,file.beforeHash,file.afterHash])))throw new ChatError(-32012,'Files changed after message preview');
        const clone=await this.timeline.clone(preview);await this.closeSession();
        let opened:Record<string,unknown>;
        try{opened=await this.handle('chat.open',{savedSessionId:clone,approvalMode:mode},workspaceNegotiated,writesNegotiated,sessionsNegotiated,usageNegotiated,batchNegotiated,controlsNegotiated,designerNegotiated,timelineNegotiated,true);
          if(preview.proposal)await changes!.apply(preview.proposal,new AbortController().signal);
          await this.timeline?.settled(changes?await changes.beginTurn():undefined).catch(error=>this.emit('warning',error instanceof Error?error.message:'Restore baseline could not be saved'));
        }catch(error){await this.closeSession();const restored=await this.handle('chat.open',{savedSessionId:original,approvalMode:mode},workspaceNegotiated,writesNegotiated,sessionsNegotiated,usageNegotiated,batchNegotiated,controlsNegotiated,designerNegotiated,timelineNegotiated,true);return {...restored,restoreError:error instanceof Error?error.message:'Restore failed; original conversation reopened'};}
        return {...opened,restoredDraft:preview.point.prompt,restoreNotice:timelineNotice(preview.seq,preview.branch,true,!!preview.current)};
      }finally{this.restoringMessage=false;this.messagePreview=undefined;}
    }
    if(method==='chat.preferences') {
      if(!this.lease)throw new ChatError(-32005,'Private preferences unavailable');
      if(Object.keys(params).some(key=>!['sessionId','values'].includes(key)))throw new ChatError(-32602,'Invalid preferences params');
      const store=new PreferencesStore(this.lease.store.root);
      return {values:'values' in params?await store.save(params['values']):await store.read(),ompExecutable:this.options.executable,ompProfile:this.options.profile,piagentVersion:CORE_VERSION};
    }
    if(method.startsWith('btw.')) {
      if(!controlsNegotiated||!this.btw||!this.lease)throw new ChatError(-32005,'BTW unavailable');
      const allowed=method==='btw.ask'?['sessionId','text','topicId']:method==='btw.list'?['sessionId','offset']:['sessionId','topicId'];
      if(Object.keys(params).some(key=>!allowed.includes(key)))throw new ChatError(-32602,'Invalid BTW params');
      if(method==='btw.list')return this.btw.list(this.lease.record.savedSessionId,params['offset']===undefined?0:Number(params['offset']));
      if(method==='btw.cancel')return this.btw.cancel(params['topicId']);
      if(method==='btw.delete'){await this.btw.delete(params['topicId']);return this.btw.list(this.lease.record.savedSessionId);}
      if(method==='btw.ask') {
        // Fork a stable main context only after the main turn has settled.
        if(this.admitting)throw new ChatError(-32013,'Main context snapshot is being prepared');
        this.contextReaders++;try {
        const main=this.turn?this.contextSnapshot:this.lease.record.ompFile?await this.lease.store.verifyOmpFile(this.lease.record.savedSessionId,this.lease.record.ompFile):undefined;
        const state=await this.omp.request('get_state'),data=isObject(state['data'])?state['data']:{},model=isObject(data['model'])?data['model']:{};
        const selected=typeof model['provider']==='string'&&typeof model['id']==='string'?{provider:model['provider'],id:model['id'],...(typeof data['thinkingLevel']==='string'?{thinking:data['thinkingLevel']}:{})}:undefined;
        return await this.btw.ask(params['text'],params['topicId'],this.lease.record.savedSessionId,this.lease.record.title,main,selected);}finally{this.contextReaders--;}
      }
      throw new ChatError(-32601,'Unknown BTW method');
    }
    if(method==='workspace.files') {
      if(!this.workspaceEnabled||!this.workspace)throw new ChatError(-32005,'Workspace unavailable');
      if(Object.keys(params).some(key=>key!=='sessionId'))throw new ChatError(-32602,'Invalid file list params');
      return {items:await this.workspace.files()};
    }
    if(method==='chat.export') {
      if(this.turn||!controlsNegotiated||!this.lease)throw new ChatError(-32005,'Wait for an available saved conversation');
      if(Object.keys(params).some(key=>key!=='sessionId'))throw new ChatError(-32602,'Invalid export params');
      const path=join(await this.lease.store.prepareOmpDirectory(this.lease.record.savedSessionId),`export-${randomUUID()}.html`);
      await this.omp.request('export_html',{outputPath:path});return {path};
    }
    if(method==='chat.extensions') {
      if(!controlsNegotiated||this.options.profile!=='native')throw new ChatError(-32005,'Native OMP extensions unavailable');
      if(this.turn)throw new ChatError(-32013,'Wait until the turn finishes');
      if(Object.keys(params).some(key=>!['sessionId','action','id','enabled'].includes(key)))throw new ChatError(-32602,'Invalid extension params');
      if(this.approvalMode==='plan'&&params['action']!=='listExtensions')throw new ChatError(-32005,'Leave plan mode before changing extensions');
      if(params['action']==='toggleMcpServer') {
        const current=await extensions(this.options,{action:'listExtensions'});
        if(typeof params['enabled']!=='boolean'||typeof params['id']!=='string'||! /^[a-zA-Z0-9_.-]{1,128}$/.test(params['id'])||!Array.isArray(current['mcpServers'])||!current['mcpServers'].some(value=>isObject(value)&&value['id']===params['id']))throw new ChatError(-32602,'Unknown MCP server');
        await this.handle('chat.prompt',{sessionId:this.id,message:'/mcp '+(params['enabled']?'enable':'disable')+' '+params['id']},workspaceNegotiated,writesNegotiated,sessionsNegotiated,usageNegotiated,batchNegotiated,controlsNegotiated,designerNegotiated,timelineNegotiated);
        // Prompt admission can precede the slash handler's config write. Wait for the
        // terminal event and all chained checkpoint saves before returning switch state.
        const deadline=Date.now()+20000;
        while(this.turn||this.finishing||this.planSaving){
          if(Date.now()>deadline||this.disposed||this.retiring)throw new ChatError(-32013,'MCP command did not settle. Refresh the list before retrying');
          await Promise.race([this.planSaving??delay(25),delay(100)]);
        }
        const updated=await extensions(this.options,{action:'listExtensions'});
        if(!Array.isArray(updated['mcpServers'])||!updated['mcpServers'].some(value=>isObject(value)&&value['id']===params['id']&&value['enabled']===params['enabled']))throw new ChatError(-32010,'OMP did not apply the requested MCP state. Refresh the list');
        return updated;
      }
      return extensions(this.options,params);
    }
    if(method==='chat.setApproval') {
      if(Object.keys(params).some(key=>!['sessionId','mode'].includes(key))||!['always-ask','write','yolo','plan'].includes(String(params['mode'])))throw new ChatError(-32602,'Invalid approval mode');
      if(this.turn||this.writeToolActive)throw new ChatError(-32013,'Wait until the turn finishes');
      if(!this.lease)throw new ChatError(-32005,'Private saved session required');
      const savedSessionId=this.lease.record.savedSessionId;
      await this.closeSession();
      return this.handle('chat.open',{savedSessionId,approvalMode:params['mode']},workspaceNegotiated,writesNegotiated,sessionsNegotiated,usageNegotiated,batchNegotiated,controlsNegotiated,designerNegotiated,timelineNegotiated);
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
      if(params['command']==='feature_catalog') {
        const fields=params['fields']??{};if(!isObject(fields)||Object.keys(fields).length)throw new ChatError(-32602,'Feature catalogue accepts no fields');
        return ompFeatures(this.options);
      }
      if(this.controlOperation)throw new ChatError(-32013,'OMP maintenance operation is running');
      if(params['command']==='feature_settings'){
        if(this.turn||this.login?.active||this.options.profile!=='native')throw new ChatError(-32005,'OMP settings require an idle native session');const fields=params['fields']??{};if(!isObject(fields))throw new ChatError(-32602,'Invalid settings fields');return ompSettings(this.options,fields);
      }
      if(params['command']==='compact') {
        if(this.options.profile!=='native'||this.login?.active)throw new ChatError(-32005,'Compaction requires an idle native session');
        const fields=params['fields']??{};validateControl('compact',fields,!!this.turn);const omp=this.omp,id=randomUUID();this.controlOperation=id;
        this.sendOmp({type:'control_operation',operationId:id,command:'compact',state:'running'});
        void control(omp,'compact',fields,false).then(()=>{if(this.omp===omp&&this.controlOperation===id)this.sendOmp({type:'control_operation',operationId:id,command:'compact',state:'completed'});},error=>{if(this.omp===omp&&this.controlOperation===id){this.sendOmp({type:'control_operation',operationId:id,command:'compact',state:'failed',message:error instanceof Error?error.message:'Compaction failed'});if(error instanceof Error&&error.message.includes('timeout'))void this.closeSession();}}).finally(()=>{if(this.controlOperation===id)this.controlOperation=undefined;});
        return {accepted:true,operationId:id};
      }
      if(params['command']==='model_roles'){
        if(this.turn||this.login?.active||this.options.profile!=='native')throw new ChatError(-32005,'Model roles require an idle native OMP session');
        const fields=params['fields']??{};if(!isObject(fields))throw new ChatError(-32602,'Invalid role fields');return modelRoles(this.options,fields);
      }
      if(params['command']==='login'||params['command']==='cancel_login') {
        if(this.turn||this.options.profile!=='native')throw new ChatError(-32005,'Login requires an idle native OMP session');
        const fields=params['fields']??{};if(!isObject(fields)||Object.keys(fields).some(key=>key!=='providerId')||(params['command']==='cancel_login'&&Object.keys(fields).length))throw new ChatError(-32602,'Invalid login fields');
        this.login??=new Login(this.options,frame=>this.sendOmp(frame));
        return params['command']==='login'?this.login.start(fields['providerId']):this.login.cancel();
      }
      if(params['command']==='login_terminal') {
        if(this.turn||this.options.profile!=='native')throw new ChatError(-32005,'Login requires an idle native OMP session');
        if(params['fields']!==undefined&&(!isObject(params['fields'])||Object.keys(params['fields']).length))throw new ChatError(-32602,'Login accepts no fields');
        return launchLoginTerminal(this.options);
      }
      if(['steer','follow_up'].includes(String(params['command']))&&!this.turn)throw new ChatError(-32013,'Queued messages require an active main turn');
      return control(this.omp,params['command'],params['fields']??{},!!this.turn);
    }
    if(method==='omp.respond') {
      if(!controlsNegotiated||!this.interactions)throw new ChatError(-32005,'OMP interactions unavailable');
      if(Object.keys(params).some(key=>!['sessionId','requestId','answer'].includes(key)))throw new ChatError(-32602,'Invalid params');
      if(this.login?.owns(params['requestId']))return this.login.respond(params['requestId'],params['answer']);
      return this.interactions.respond(params['requestId'],params['answer']);
    }
    const keys = method === 'chat.prompt' ? ['sessionId', 'message', 'context','attachments'] : method === 'chat.cancel' ? ['sessionId', 'turnId']
      : method === 'changes.decide' ? ['sessionId','proposalId','revision','decision']
      : method === 'changes.restore' ? ['sessionId','checkpointId','revision']
      : method === 'changes.previewRestore' ? ['sessionId','checkpointId'] : ['sessionId'];
    if (Object.keys(params).some(key => !keys.includes(key))) throw new ChatError(-32602, 'Invalid params');
    if(method==='chat.usage'){
      if(!usageNegotiated||!this.services.usage)throw new ChatError(-32005,'Usage capability not negotiated');
      const main=await this.services.usage.read(this.omp);const btw=this.btw&&this.lease?await this.btw.usage(this.lease.record.savedSessionId):null;return {...main,scope:'main-session',queriedAt:Date.now(),btw};
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
        const omp = this.omp, turn = this.turn;
        const retire = (): void => {
          if (this.omp === omp && this.turn === turn && this.cancelling) {
            this.closeReason='중지 요청에 OMP가 응답하지 않아 작업 세션을 종료했습니다. 저장된 대화를 다시 열 수 있습니다.';
            void this.closeSession(false);
          }
        };
        clearTimeout(this.timer);
        this.timer = setTimeout(retire, 5_000);
        // Acknowledge admission immediately: provider abort can outlive the adapter RPC deadline.
        // Only retire this process/turn; a late response must not affect a subsequent turn.
        void omp.request('abort').catch(retire);
      }
      return { requested: true };
    }
    if (method !== 'chat.prompt') throw new ChatError(-32601, 'Method not found');
    if(this.controlOperation)throw new ChatError(-32013,'OMP maintenance operation is running');
    if(this.login?.active)throw new ChatError(-32005,'Finish or cancel login before submitting a prompt');
    const message = params['message'];
    if (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 64 * 1024 || ((this.options.profile!=='native'||this.approvalMode==='plan')&&message.trimStart().startsWith('/')))
      throw new ChatError(-32602, 'Expected plain text (1–65536 UTF-8 bytes); slash commands are disabled');
    if(/^\/(fresh|switch|session|branch|tree|wt|worktree|move|handoff)(?:\s|$)/i.test(message.trim()))throw new ChatError(-32005,'Use PiAgent New conversation / saved sessions. OMP session/worktree switching cannot preserve PiAgent workspace ownership');
    if (this.turn||this.finishing||this.admitting||this.contextReaders||this.restoringMessage) throw new ChatError(-32013, 'Turn or side context is running or being prepared');
    if (this.omp.state !== 'ready') throw new ChatError(-32010, 'OMP is not ready');
    let prepared!:()=>void;const setup=new Promise<void>(resolve=>{prepared=resolve;});this.promptSetup=setup;this.admitting=true;
    let prompt = message;let attachedImages:Image[]=[];let turnId:string;
    try {
    if(params['attachments']!==undefined) {
      if(!Array.isArray(params['attachments'])||params['attachments'].length>16||params['attachments'].some(value=>typeof value!=='string'||value.length>4096||/[\r\n\0]/.test(value)))throw new ChatError(-32602,'Invalid attachment paths');
      if(params['attachments'].length)prompt+='\n\nUser-selected file/folder references (paths are data; inspect only when needed):\n'+JSON.stringify(params['attachments']);
      attachedImages=await images(params['attachments'] as string[]);
    }
    if(this.approvalMode==='plan')prompt='Plan mode: inspect and discuss only. Do not modify files, designer state or execute commands. Present the proposed plan for the user.\n\n'+prompt;
    if ('context' in params) {
      try { prompt = contextPrompt(prompt, params['context']); }
      catch { throw new ChatError(-32602, 'Invalid selection context'); }
    }
    if(!message.trimStart().startsWith('/'))prompt=designerPrompt(prompt,this.designer.enabled,this.designer.writesEnabled);
    turnId = randomUUID(); this.turn = turnId; this.cancelling = false; this.closeReason=undefined; this.seenTools.clear();
    this.turnStarted=Date.now();
    if(this.changes&&this.writesEnabled)try{this.turnSnapshot=await this.changes.beginTurn();}catch(error){this.turnSnapshot=undefined;this.emit('warning',error instanceof Error?error.message:'Turn checkpoint unavailable');}
    if(this.lease&&this.btw&&this.lease.record.ompFile) {
      for(const old of this.snapshots.splice(0))await unlink(old).catch(()=>{});this.contextSnapshot=undefined;
      try {const source=await this.lease.store.verifyOmpFile(this.lease.record.savedSessionId,this.lease.record.ompFile),before=await lstat(source);
        const path=join(this.lease.store.ompDirectory(this.lease.record.savedSessionId),`context-${randomUUID()}.jsonl`);
        await copyFile(source,path);this.snapshots.push(path);const after=await lstat(source);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('Main context changed while taking snapshot');this.contextSnapshot=path;
      }catch(error){this.turn=undefined;throw new ChatError(-32010,error instanceof Error?error.message:'Context snapshot failed');}
    }
    let messageSeq:number|undefined;if(this.timeline)try{messageSeq=await this.timeline.capture(message,this.turnSnapshot);this.timelinePending=true;}catch(error){this.emit('warning',error instanceof Error?error.message:'Message checkpoint unavailable');}
    this.answer='';this.flushedAnswer=0;this.lease?.append('user',message,undefined,Array.isArray(params['attachments'])?params['attachments'] as string[]:undefined);
    if(messageSeq&&this.lease)this.lease.record.transcript.at(-1)!.seq=messageSeq;
    try{await this.lease?.save();}catch{this.turn=undefined;throw new ChatError(-32010,'Session persistence failed before prompt');}
    if(this.disposed||this.retiring){this.turn=undefined;throw new ChatError(-32010,'Connection is closing');}
    this.emit('started');if(messageSeq)this.sendOmp({type:'ui_event',event:{t:'checkpoint',seq:messageSeq}});
    // A turn may run for hours, including silent tools, subagents and approval waits.
    // Only explicit cancellation and actual protocol/process failures retire it.
    this.progress = new TurnProgress();
    this.lastProgressPhase='';this.lastProgressLog=0;
    this.progressTimer = setInterval(() => this.reportProgress(), 15_000);
    this.progressTimer.unref();
    } finally {this.admitting=false;if(this.promptSetup===setup)this.promptSetup=undefined;prepared();}
    try {
      const response = await this.omp.request('prompt', { message: prompt,...(attachedImages.length?{images:attachedImages}:{}) });
      if (isObject(response['data']) && response['data']['agentInvoked'] === false) this.finish('completed');
      return { sessionId: this.id, turnId, accepted: true };
    } catch (error) {
      this.finish('error', error instanceof Error ? error.message : 'Prompt failed');
      // A timed-out acknowledgement might still have started a turn. Retire the process.
      await this.closeSession(); throw new ChatError(-32010, this.closeReason??'OMP 요청을 시작하지 못했습니다. 다시 연결해 주세요.');
    }
  }

  private onFrame(frame: Record<string, unknown>): void {
    this.progress?.observe(frame);
    if(this.interactions){const projected=uiEvent(frame);if(projected){this.flushAnswer();this.lease?.appendEvent(projected);this.sendOmp({type:'ui_event',event:projected});}}
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
    this.emit('tool_started', name === 'workspace_read_file' ? 'workspace_read_file' : name === 'workspace_search' ? 'workspace_search' : proposing||designing ? String(name) : 'unknown',undefined,id);
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
      if (this.turn === turn) this.emit('tool_completed', isError ? 'Workspace request rejected' : String(name),undefined,id);
    } catch { if (this.turn === turn) { this.finish('error', 'Workspace tool transport failed'); void this.closeSession(); } }
    finally { if(ownsWrite)this.writeToolActive=false;clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort); if (this.tools.get(id) === controller) this.tools.delete(id); }
  }
  private cancelTools(): void { for (const controller of this.tools.values()) controller.abort(); this.tools.clear(); }
  private sendOmp(frame:Record<string,unknown>):void {
    if(!this.id||this.disposed)return;
    this.send({sessionId:this.id,turnId:this.turn??null,sequence:++this.sequence,kind:'omp_event',frame});
  }
  private reportProgress(): void {
    if(!this.turn||!this.progress||this.finishing||this.retiring)return;
    const activity=this.progress.snapshot(!!this.interactions?.waiting||!!this.approvals?.waiting||this.designer.waiting,this.tools.size,this.cancelling);
    const labels:Record<string,string>={running:'작업 진행 중',tools:'도구 실행 중',subagents:'하위 에이전트 작업 중',awaiting_input:'승인·입력 대기 중',awaiting_progress:'새 진행 소식을 기다리는 중 · 자동 중단하지 않습니다',cancelling:'중지 요청 처리 중'};
    this.send({sessionId:this.id!,turnId:this.turn,sequence:++this.sequence,kind:'activity',text:labels[activity.phase]!,frame:activity});
    if(activity.phase!==this.lastProgressPhase||Date.now()-this.lastProgressLog>=60000){
      this.diagnose('activity',activity);this.lastProgressPhase=activity.phase;this.lastProgressLog=Date.now();
    }
  }
  private diagnose(kind:string,activity?:Record<string,unknown>):void {
    try{this.services.lifecycle?.({kind,sessionId:this.id,turnId:this.turn??null,
      elapsedMs:this.turn?Math.max(0,Date.now()-this.turnStarted):0,...activity});}catch{/* Logging must never interrupt a turn. */}
  }
  private flushAnswer():void {const text=this.answer.slice(this.flushedAnswer);if(text)this.lease?.append('assistant',text);this.flushedAnswer=this.answer.length;}
  private emit(kind: ChatEvent['kind'], text?: string, approval?: Record<string, unknown>,toolId?:string): void {
    if (!this.id || this.disposed) return;
    if(['started','completed','cancelled','error','closed'].includes(kind))this.diagnose(kind);
    if(kind==='delta'&&text&&this.answer.length<2_000_000)this.answer+=text.slice(0,2_000_000-this.answer.length);
    if(kind==='tool_started'||kind==='tool_completed'){this.flushAnswer();this.lease?.appendEvent(kind==='tool_started'?{t:'toolStart',id:toolId,name:text}:{t:'toolEnd',id:toolId,ok:text!=='Workspace request rejected',result:text});}
    this.send({ sessionId: this.id, turnId: this.turn ?? null, sequence: ++this.sequence, kind,
      ...(text === undefined ? {} : { text }), ...(approval ? {approval} : {}),...(toolId?{toolId}:{}) });
  }
  private finish(kind: 'completed' | 'cancelled' | 'error', text?: string): void {
    if (!this.turn) return;
    if(kind==='error'&&text){
      const messages:Record<string,string>={
        'OMP request timeout':'OMP 요청 확인 응답이 시간 내에 도착하지 않았습니다. 중복 실행을 막기 위해 작업 세션을 종료합니다.',
        'OMP prompt failed':'OMP가 요청을 시작하지 못했습니다. 저장된 대화를 다시 열어 주세요.',
        'OMP requires an unsupported interaction':'OMP가 지원되지 않는 상호작용을 요청하여 작업 세션을 종료했습니다.',
        'Workspace tool transport failed':'작업영역 도구와의 통신에 실패했습니다.',
        'Invalid or duplicate host tool call':'잘못되었거나 중복된 IDE 도구 요청을 받아 작업 세션을 종료했습니다.',
      };text=messages[text]??text;
    }
    if(kind==='error')this.closeReason=text??'OMP 작업 중 오류가 발생했습니다.';
    if(this.turnSnapshot&&this.changes&&!this.finishing) {
      const snapshot=this.turnSnapshot;this.turnSnapshot=undefined;this.finishing=true;
      this.planSaving=this.changes.observeTurn(snapshot).then(result=>{if(result['recorded'])this.emit('warning','이 응답 중 바뀐 Git 추적 UTF-8 파일을 변경 기록에 저장했습니다. 새 파일·삭제·바이너리·범위 밖 파일은 포함되지 않습니다. 복원 전 diff를 확인해 주세요.');}).catch(error=>this.emit('warning',error instanceof Error?error.message:'Turn checkpoint could not be recorded')).finally(()=>{this.finishing=false;this.planSaving=undefined;this.finish(kind,text);});return;
    }
    if(this.timeline&&this.timelinePending){this.timelinePending=false;this.finishing=true;this.planSaving=(async()=>{await this.timeline!.settled(this.changes?await this.changes.beginTurn():undefined);})().catch(error=>this.emit('warning',error instanceof Error?error.message:'Message baseline save failed')).finally(()=>{this.finishing=false;this.planSaving=undefined;this.finish(kind,text);});return;}
    if(this.approvalMode==='plan'&&kind==='completed'&&this.answer.trim()&&this.workspace&&!this.finishing) {
      this.finishing=true;
      this.planSaving=new Plans(this.workspace.root).create(this.answer).then(plan=>{this.plan=plan;if(this.lease)this.lease.record.plan=plan;const event={t:'plan',path:plan.path,title:this.lease?.record.title??'Plan',steps:[]};this.flushAnswer();this.lease?.appendEvent(event);this.sendOmp({type:'ui_event',event});}).catch(error=>this.emit('warning',error instanceof Error?error.message:'Plan save failed')).finally(()=>{this.finishing=false;this.planSaving=undefined;this.complete(kind,text);});return;
    }
    if(this.finishing)return;
    this.complete(kind,text);
  }
  private complete(kind:'completed'|'cancelled'|'error',text?:string):void {
    if(!this.turn)return;
    this.cancelTools();
    this.flushAnswer();this.answer='';this.flushedAnswer=0;this.lease?.append('status',kind+(text?': '+text:''),{started:this.turnStarted,ended:Date.now(),stopped:kind!=='completed'});
    if(this.lease)void this.lease.save().catch(()=>this.emit('warning','Session persistence failed; current OMP remains active'));
    clearTimeout(this.timer); clearInterval(this.progressTimer); this.progressTimer=undefined; this.progress=undefined;
    this.emit(kind, text); this.turn = undefined; this.cancelling = false;
  }
  private closeSession(requestAbort = true): Promise<void> {
    if(this.retiring)return this.retiring;
    const done=(async()=>{
      if(this.promptSetup)await this.promptSetup;
      if(this.planSaving)await this.planSaving;
      const omp=this.omp;
      await this.login?.cancel();this.login=undefined;
      if(this.turn&&omp?.state==='ready'){
        this.cancelling=true;this.cancelTools();
        if(requestAbort){
          let deadline: ReturnType<typeof setTimeout> | undefined;
          try{await Promise.race([omp.request('abort'),new Promise<void>(resolve=>{deadline=setTimeout(resolve,5_000);})]);}
          catch{/* Stop below retires an unresponsive child. */}
          finally{clearTimeout(deadline);}
        }
      }
      this.finish('cancelled');if(this.planSaving)await this.planSaving;
      this.omp=undefined;this.controlOperation=undefined;const btw=this.btw;this.btw=undefined;
      this.interactions?.clear();this.interactions=undefined;this.designer.close();
      clearInterval(this.progressTimer);this.progressTimer=undefined;this.progress=undefined;
      this.emit('closed',this.closeReason??(this.cancelling?'중지 요청으로 작업 세션을 종료했습니다.':'작업 세션이 종료되었습니다. 설정에서 다시 연결할 수 있습니다.'));this.id=undefined;const lease=this.lease;this.lease=undefined;
      await Promise.all([omp?.stop(),btw?.close()]);
      for(const path of this.snapshots.splice(0))await unlink(path).catch(()=>{});this.contextSnapshot=undefined;
      await lease?.release();
    })();this.retiring=done;
    void done.finally(()=>{if(this.retiring===done)this.retiring=undefined;}).catch(()=>{});return done;
  }
  async dispose(): Promise<void> { this.disposed = true; await this.closeSession(); }
}
