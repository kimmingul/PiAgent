/** Translate the existing RADAgent UI contract; never interpret transcript text as host actions. */
import {knownAction} from './contracts.js';
export type Frame = Record<string, unknown>;
export const object = (value: unknown): Frame => value && typeof value === 'object' && !Array.isArray(value) ? value as Frame : {};
export const rows = (value: unknown): Frame[] => Array.isArray(value) ? value.map(object) : [];
const localCommands=[{name:'new',description:'새 대화'},{name:'sessions',description:'저장된 대화'},{name:'usage',description:'사용량'},{name:'restore',description:'파일 변경 기록'},{name:'selection',description:'편집기 선택 영역'},{name:'btw',description:'별도 질문'}];
export interface View {
  emit(frame: Frame): void;
  list(title: string, items: {label: string; disabled?: boolean; remove?:(()=>void)|undefined; run(): void}[]): void;
  capabilities(frame: Frame): void;
  clearInteractions?():void;
  interaction?(frame:Frame,answer:(value:Frame)=>void):void;
  settings?(frame:Frame,save:(value:Frame)=>void):void;
  settingsResult?(ok:boolean,message?:string):void;
  gitStatus?(data:Frame,enabled:boolean):void;
  gitPanel?(data:Frame,error?:string):void;
  accountStatus?(providers:Frame[],error?:string):void;
  accountEvent?(frame:Frame,answer:(value:Frame)=>void):void;
  clearAccount?():void;
  rolesResult?(frame:Frame,error?:string):void;
  clearRoles?():void;
  executionResult?(command:string,data:Frame,fields?:Frame,error?:string):void;
  executionEvent?(frame:Frame):void;
  clearExecution?():void;
  sheet?(title:string,text:string,next?:()=>void):void;
}
export class Controller {
  private lastTurnError = '';
  private connected = false;
  private busy = false;
  private switching = false;
  private session = '';
  private turn = '';
  private sequence = 0;
  private model = '';
  private thinking = '';
  private title = '';
  private context = -1;
  private workspace = '';
  private submission: Frame | undefined;
  private review: {id: string; restore: boolean; data: Frame; deciding: boolean} | undefined;
  private features: Frame = {};
  private tool = '';
  private models:string[]=[];
  private approvalMode='always-ask';
  private turnApproved=false;
  private levels:unknown[]=[];
  private controlPending=false;
  private started=0;
  private usageReport=false;
  private settingsOpen=false;
  private settingsSaving=false;
  private loginBusy=false;
  private accountTab=false;
  private readonly executionRequests=new Set<string>();
  private readonly completedOperations=new Set<string>();
  private readonly btwSubmissions=new Set<unknown>();
  private readonly queueSubmissions=new Map<unknown,{text:string;queue:string}>();
  private queue:Frame={};
  private preferences:Frame={};
  private cancelAfterStart=false;
  private catalog():void {this.emit('catalog',{models:this.models,levels:this.levels});this.status();}
  constructor(private readonly post: (frame: Frame) => void, private readonly view: View) {}
  private emit(t: string, data: Frame = {}): void { this.view.emit({t, ...data}); }
  private notice(text: string): void { this.emit('notice', {level: 'info', text}); }
  private status(state = '연결됨', error = false): void {
    this.emit('status', {connected: this.connected, busy: this.busy || this.switching || this.controlPending || !!this.review || this.loginBusy,
      state, error, activity: state, model: this.model, thinking:this.thinking, title: this.title, cwd: this.workspace, queueEnabled: this.busy&&!!this.turn&&!this.switching&&!this.review&&!this.controlPending&&this.features['ompProfile']==='native'&&this.features['ompControlsEnabled']===true,
      project: decodeURIComponent(this.workspace.replace(/\/$/,'').split(/[\\/]/).filter(Boolean).at(-1)??''), approval: this.approvalMode, context: this.context});
    this.view.capabilities({...this.features,connected:this.connected,busy:this.busy||this.switching||this.controlPending||!!this.review||this.loginBusy});
  }
  private idle(): boolean { return this.connected && !this.busy && !this.switching && !this.controlPending && !this.review && !this.loginBusy; }
  private refresh(state=true): void {
    if (this.features['usageEnabled']) this.post({action: 'usage'});
    if(state&&this.features['ompControlsEnabled'])this.post({action:'ompControl',command:'get_state'});
  }
  action(msg: Frame): void {
    if(!knownAction(msg['t'])){this.notice('현재 연결에서 지원하지 않는 기능입니다.');return;}
    switch (msg['t']) {
      case 'gitSetup':
        if(this.idle()&&this.features['gitSetupEnabled']){this.controlPending=true;this.status();this.post({action:'gitSetup',...Object.fromEntries(['op','previewId','revision','name','email'].filter(k=>k in msg).map(k=>[k,msg[k]]))});}
        else this.notice('현재 작업을 마친 뒤 쓰기 가능한 native 연결에서 Git을 설정해 주세요.');break;
      case 'accountStatus':if(this.connected&&this.features['ompControlsEnabled'])this.post({action:'ompControl',command:'get_login_providers'});else this.view.accountStatus?.([],'Core 연결과 OMP 지원 상태를 확인해 주세요.');break;
      case 'accountLogin':
        if(typeof msg['providerId']!=='string'){this.accountTab=true;this.action({t:'settings'});break;}
        if(this.idle()&&this.features['ompControlsEnabled']&&this.features['ompProfile']==='native'){this.loginBusy=true;this.post({action:'ompControl',command:'login',fields:{providerId:msg['providerId']}});}
        else this.view.accountEvent?.({type:'login_status',state:'failed',message:'현재 응답을 마친 뒤 연결된 native OMP에서 로그인해 주세요.'},()=>{});break;
      case 'cancelLogin':if(this.connected&&this.loginBusy)this.post({action:'ompControl',command:'cancel_login'});break;
      case 'modelRoles':if(this.idle()&&this.features['ompControlsEnabled']&&this.features['ompProfile']==='native')this.post({action:'ompControl',command:'model_roles',fields:Object.fromEntries(['revision','changes','scope','op','name'].filter(key=>key in msg).map(key=>[key,msg[key]]))});else this.view.rolesResult?.({},'현재 응답·로그인을 마친 뒤 연결된 native OMP에서 설정하세요.');break;
      case 'executionControl':{
        const command=String(msg['command']);
        const allowed=['feature_catalog','feature_settings','get_state','get_subagents','get_subagent_messages','cancel_subagent','steer_subagent','set_fast_mode','set_auto_compaction','set_auto_retry','set_cache_warming','set_steering_mode','set_follow_up_mode','set_interrupt_mode','compact','abort_retry'];
        const live=['get_subagents','get_subagent_messages','cancel_subagent','steer_subagent','abort_retry'];
        if(!allowed.includes(command)||!this.connected||!this.features['ompControlsEnabled']||this.features['ompProfile']!=='native'||(!this.idle()&&!live.includes(command))){this.view.executionResult?.(command,{}, {},'현재 응답을 마친 뒤 native OMP 연결에서 실행하세요.');break;}
        if(this.executionRequests.size){this.view.executionResult?.(command,{}, {},'이전 실행 제어 요청을 기다려 주세요.');break;}
        this.executionRequests.add(command);if(command==='compact'){this.controlPending=true;this.status('컨텍스트 압축 중…');}
        this.post({action:'ompControl',command,fields:object(msg['fields'])});break;
      }
      case 'btw':
        if(!this.connected||this.switching||!this.features['btwEnabled']){if(msg['composer'])this.emit('submitted',{id:msg['id'],ok:false});this.notice('연결된 BTW를 이용해 주세요.');break;}
        if(msg['composer'])this.btwSubmissions.add(msg['id']);
        this.post({action:'btw',text:msg['text'],topicId:msg['topic'],id:msg['id'],composer:msg['composer']});break;
      case 'btwList':if(this.connected&&this.features['btwEnabled'])this.post({action:'btwList'});break;
      case 'btwStop':case 'btwDelete':if(this.connected&&this.features['btwEnabled'])this.post({action:msg['t'],topicId:msg['id']});break;
      case 'openFile':case 'openUrl':case 'copy':
        this.post({action:msg['t'],...Object.fromEntries(Object.entries(msg).filter(([key])=>key!=='t'))});break;
      case 'listFiles':if(this.connected&&this.features['filesEnabled']!==false)this.post({action:'listFiles'});else if(this.connected)this.emit('files',{items:[]});else this.notice('Core 연결을 먼저 확인해 주세요. 설정에서 연결을 다시 시도할 수 있습니다.');break;
      case 'export':if(this.idle()&&this.features['exportEnabled'])this.post({action:'export'});break;
      case 'abortRetry':if(this.connected&&this.features['ompControlsEnabled'])this.post({action:'ompControl',command:'abort_retry'});break;
      case 'cancelQueued':if(this.connected&&this.features['ompControlsEnabled'])this.post({action:'ompControl',command:'remove_queued_message',fields:{message:msg['sent'],queue:msg['queue']}});break;
      case 'subagentLog':if(this.connected&&this.features['ompControlsEnabled'])this.post({action:'ompControl',command:'get_subagent_messages',fields:{subagentId:msg['id']}});break;
      case 'restore':if(this.idle()&&this.features['messageRestoreEnabled'])this.post({action:'previewMessageRestore',seq:msg['seq'],branch:msg['branch']===true});else this.notice('현재 연결에서는 메시지 복원을 사용할 수 없습니다.');break;
      case 'proceedPlan':if(this.idle()&&this.approvalMode==='plan'){this.switching=true;this.status('승인된 계획 실행 준비 중…');this.post({action:'proceedPlan',path:msg['path']});}break;
      case 'setApproval':
        if(this.idle()&&Array.isArray(this.features['approvalModes'])&&this.features['approvalModes'].includes(msg['value'])) {
          this.switching=true;this.status('접근 모드 변경 중…');this.post({action:'setApproval',mode:msg['value']});
        }break;
      case 'manageExtensions':if(msg['kind']==='plugins'){this.command('/plugins');break;}if(this.idle())this.post({action:'manageExtensions'});break;
      case 'attachFiles':case 'addFolder':case 'listExtensions':case 'toggleMcpServer':case 'togglePlugin':case 'compile':
        if(this.idle())this.post({action:msg['t'],...Object.fromEntries(Object.entries(msg).filter(([key])=>key!=='t'))});break;
      case 'setModel': {
        if(!this.idle()||!this.features['ompControlsEnabled'])return;
        const value=String(msg['value']), at=value.indexOf('/');if(at<1)return;
        this.controlPending=true;this.status('모델 변경 중…');
        this.post({action:'ompControl',command:'set_model',fields:{provider:value.slice(0,at),modelId:value.slice(at+1)}});break;
      }
      case 'setThinking':
        if(this.idle()&&this.features['ompControlsEnabled']){this.controlPending=true;this.status('추론 수준 변경 중…');this.post({action:'ompControl',command:'set_thinking_level',fields:{level:msg['value']}});}break;
      case 'ready': this.post({action: 'ready'}); this.status('연결 중…'); this.post({action: 'connect'}); break;
      case 'connect': if (!this.connected && !this.switching) { this.switching = true; this.status('연결 중…'); this.post({action: 'connect'}); } break;
      case 'newSession': if (this.idle()) { this.switching = true; this.status('새 대화 준비 중…'); this.post({action: 'reset'}); } break;
      case 'sessions': if (this.idle() && this.features['sessionsEnabled']) this.post({action: 'listSessions'}); break;
      case 'usage': if (this.idle()) this.refresh(); break;
      case 'submit': {
        const text = String(msg['text'] ?? '');
        const compact = /^\/compact(?:\s+([\s\S]*))?$/i.exec(text.trim());
        if(compact&&this.features['ompProfile']==='native'){
          if(!this.idle()||this.submission||!this.features['ompControlsEnabled']||this.executionRequests.size||new TextEncoder().encode(text).length>65536||msg['withSelection']||Array.isArray(msg['attachments'])&&msg['attachments'].length){
            this.emit('submitted',{id:msg['id'],ok:false});this.notice('현재 응답·승인을 마친 뒤 첨부·선택 영역 없이 압축 명령을 실행해 주세요.');return;
          }
          const customInstructions=compact[1]?.trim();
          this.action({t:'executionControl',command:'compact',fields:customInstructions?{customInstructions}:{}});
          this.emit('submitted',{id:msg['id'],ok:this.executionRequests.has('compact')});return;
        }
        if(this.connected&&this.busy&&!this.review&&this.features['ompProfile']==='native'&&this.features['ompControlsEnabled']&&!this.submission&&text.trim()&&new TextEncoder().encode(text).length<=65536) {
          if(msg['withSelection']||Array.isArray(msg['attachments'])&&msg['attachments'].length){this.emit('submitted',{id:msg['id'],ok:false});this.notice('첨부·선택 영역 메시지는 현재 응답을 마친 뒤 보내 주세요.');break;}
          const queue=msg['followUp']?'followUp':'steering';
          if([...this.queueSubmissions.values()].some(item=>item.text===text&&item.queue===queue)||(Array.isArray(this.queue[queue])&&(this.queue[queue] as unknown[]).includes(text))){this.emit('submitted',{id:msg['id'],ok:false});this.notice('같은 메시지가 이미 대기 중입니다.');break;}
          this.queueSubmissions.set(msg['id'],{text,queue});this.post({action:'queuePrompt',id:msg['id'],command:msg['followUp']?'follow_up':'steer',message:text});break;
        }
        if (!this.idle() || this.submission || !text.trim() || new TextEncoder().encode(text).length > 65536) {
          this.emit('submitted', {id: msg['id'], ok: false}); this.notice('현재 응답·승인을 마친 뒤 64 KiB 이하의 메시지를 보내 주세요.'); return;
        }
        if (text.trim().startsWith('/') && (this.features['ompProfile']!=='native'||/^\/login$/i.test(text.trim())||['/new','/sessions','/usage','/restore','/selection'].includes(text.trim()))) {
          const accepted = this.command(text.trim()); this.emit('submitted', {id: msg['id'], ok: accepted}); return;
        }
        this.submission = msg; this.busy = true; this.status('응답 대기 중…');
        // Selection was captured by the IDE; only an explicit chip selection includes it.
        if (!msg['withSelection'] && this.features['selectionEnabled']) this.post({action: 'clearSelection'});
        this.post({action: 'prompt', message: text,...(Array.isArray(msg['attachments'])&&msg['attachments'].length?{attachments:msg['attachments']}: {})}); break;
      }
      case 'abort': if (this.turn) this.post({action: 'cancel', turnId: this.turn});else if(this.submission)this.cancelAfterStart=true;break;
      case 'approval': {
        const review = this.review;
        if (!review || review.deciding || msg['id'] !== review.id || typeof msg['ok'] !== 'boolean') return;
        if (review.restore && !msg['ok']) { this.resolve(false); this.status(); return; }
        review.deciding = true;
        if(msg['ok']&&!review.restore)this.turnApproved=true;
        if(review.data['messageRestoreId']){this.post({action:'restoreMessage',messageRestoreId:review.id});break;}
        if(review.data['designer']===true){this.post({action:'designerDecide',proposalId:review.id,approved:msg['ok']});break;}
        this.post(review.restore ? {action: 'restoreChange', checkpointId: review.id} :
          {action: 'decideChange', proposalId: review.id, decision: msg['ok'] ? 'approve' : 'reject'}); break;
      }
      case 'runCommand': this.command(String(msg['text'])); break;
      case 'settings':
        if(this.connected&&this.features['preferencesEnabled']){this.settingsOpen=true;this.post({action:'preferences'});break;}
        this.view.list('PiAgent', [
          {label: '연결 다시 시도', disabled: this.connected || this.switching, run: () => this.action({t: 'connect'})},
          {label: '파일 변경 기록', disabled: !this.idle() || !this.features['checkpointsEnabled'], run: () => this.post({action: 'listCheckpoints'})}
        ]); break;
      case 'captureSelection': if (this.idle() && this.features['selectionEnabled']) this.post({action: 'captureSelection'}); break;
      default: this.notice(this.connected ? '현재 연결에서 지원하지 않는 기능입니다.' : 'Core 연결을 먼저 확인해 주세요. 설정에서 연결을 다시 시도할 수 있습니다.');
    }
  }
  private command(text: string): boolean {
    if(/^\/login$/i.test(text.trim())){this.action({t:'accountLogin'});return true;}
    switch (text) {
      case '/new': this.action({t: 'newSession'}); return true;
      case '/sessions': this.action({t: 'sessions'}); return true;
      case '/usage': this.usageReport=true; this.refresh(); return true;
      case '/restore': if (this.idle() && this.features['checkpointsEnabled']) this.post({action: 'listCheckpoints'}); else this.notice('이 작업영역에서는 복원 가능한 파일 변경 기록이 없습니다.');return true;
      case '/selection': this.action({t: 'captureSelection'}); return true;
      default: if(this.idle()&&this.features['ompProfile']==='native'){this.action({t:'submit',id:`command-${Date.now()}`,text});return true;}this.notice('현재 모드에서는 이 OMP 명령을 실행할 수 없습니다.');return false;
    }
  }
  private showReview(data: Frame, restore: boolean, auto=true): void {
    const id = String(data['messageRestoreId']??data[restore ? 'checkpointId' : 'proposalId']);
    this.review = {id, restore, data, deciding: false};
    if(auto&&!restore&&(this.approvalMode==='yolo'||(this.approvalMode==='write'&&this.turnApproved))) {this.action({t:'approval',id,ok:true});return;}
    this.emit('approval', {id, target: rows(data['files']).map(f => f['path']).join(', ') || data['path'],
      summary: data['messageRestoreId']?String(data['reason']):restore ? '파일 복원 확인 · 대화 기록은 되돌리지 않습니다. 이후 파일이 바뀌었다면 복원이 거부됩니다.' : data['reason'],
      lines: String(data['diff'] ?? '').split('\n').map(line => ({k: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx', t: /^[+-]/.test(line) ? line.slice(1) : line}))});
    this.status('승인 대기 중');
  }
  private resolve(ok: boolean): void {
    if (this.review) this.emit('approvalResult', {id: this.review.id, ok}); this.review = undefined;
  }
  receive(frame: Frame): void {
    if(frame['type']==='event'&&!this.connected&&this.switching)return;
    if(frame['type']!=='session'&&typeof frame['ownerSessionId']==='string'&&frame['ownerSessionId']!==this.session)return;
    switch (frame['type']) {
      case 'workspaceChanging':
        this.connected=false;this.switching=true;this.busy=false;this.turn='';this.resolve(false);
        if(this.submission)this.emit('submitted',{id:this.submission['id'],ok:false});this.submission=undefined;
        this.view.clearInteractions?.();this.emit('files',{items:null});this.emit('context',{});
        this.workspace=String(frame['workspaceUri']??'');this.status(this.workspace?'프로젝트 다시 연결 중…':'열린 프로젝트가 없습니다.');break;
      case 'workspaceDisconnected':
        this.connected=false;this.switching=this.busy=false;this.status('프로젝트를 열면 자동으로 연결합니다.');break;
      case 'messageRestorePreview':this.showReview(object(frame['data']),true,false);break;
      case 'folderAdded':this.notice('OMP 작업영역에 폴더를 추가했습니다: '+String(frame['path']??''));break;
      case 'buildResult':this.notice(frame['success']?'빌드 완료':'빌드 실패 · IDE 오류 목록을 확인해 주세요.');break;
      case 'files':this.emit('files',{items:frame['items']??[]});break;
      case 'btwList':if(this.features['savedSessionId']&&frame['session']!==this.features['savedSessionId'])break;this.view.emit({...frame,t:'btwList'});if(typeof frame['nextOffset']==='number')this.post({action:'btwList',offset:frame['nextOffset']});break;
      case 'btwAccepted':if(this.btwSubmissions.delete(frame['id']))this.emit('submitted',{id:frame['id'],ok:true});break;
      case 'queueAccepted':{const item=this.queueSubmissions.get(frame['id']);if(item){this.queueSubmissions.delete(frame['id']);this.emit('user',{text:item.text,queue:item.queue==='followUp'?'followUp':'steer',sent:item.text,ts:Date.now()});this.emit('submitted',{id:frame['id'],ok:true});this.post({action:'ompControl',command:'get_state'});}break;}
      case 'preferences':
        this.preferences=object(frame['values']);
        this.emit('preferences',{values:frame['values']});
        if(this.settingsSaving){this.settingsSaving=false;this.view.settingsResult?.(true);}
        if(this.settingsOpen){this.settingsOpen=false;const owner=this.session;this.view.settings?.({...frame,accountTab:this.accountTab},values=>{if(owner!==this.session||!this.connected){this.view.settingsResult?.(false,'대화가 변경되었습니다. 설정을 다시 열어 주세요.');return;}if(this.settingsSaving)return;this.settingsSaving=true;this.post({action:'preferences',values});});this.accountTab=false;}break;
      case 'copied':this.emit('copyResult',{id:frame['id'],ok:true});this.notice('복사했습니다.');break;
      case 'attachments':this.emit('attachments',{items:frame['items']??[]});break;
      case 'extensions':this.emit('extensions',frame);break;
      case 'ompControl': {
        const command=frame['command'],data=object(frame['data']),fields=object(frame['fields']);
        if(this.executionRequests.delete(String(command))){if(!(command==='compact'&&this.completedOperations.has(String(data['operationId']))))this.view.executionResult?.(String(command),data,fields);if(!['get_state','get_available_models','get_available_thinking_levels'].includes(String(command)))break;}
        if(command==='get_available_models') {this.models=rows(data['models']).map(m=>`${String(m['provider'])}/${String(m['id'])}`);this.catalog();}
        else if(command==='get_available_thinking_levels') {this.levels=Array.isArray(data['levels'])?data['levels']:[];this.catalog();}
        else if(command==='get_state') {const model=object(data['model']);this.model=[model['provider'],model['id']].filter(Boolean).join('/');this.thinking=String(data['thinkingLevel']??'');this.emit('todos',{items:rows(data['todoPhases']).flatMap(phase=>rows(phase['tasks']).map(task=>({...task,phase:phase['name']})))});this.queue=object(data['queuedMessages']);if(Object.keys(this.queue).length)this.emit('queue',this.queue);this.status();}
        else if(command==='remove_queued_message'){this.emit('queueRemoved',{sent:fields['message'],queue:fields['queue'],removed:data['removed']===true});this.post({action:'ompControl',command:'get_state'});}
        else if(command==='get_available_commands')this.commands(data['commands']);
        else if(command==='get_subagent_messages'){
          const text=rows(data['messages']).map(message=>`**${String(message['role']??'agent')}**\n\n${typeof message['content']==='string'?message['content']:rows(message['content']).filter(part=>part['type']==='text').map(part=>String(part['text']??'')).join('\n')}`).join('\n\n---\n\n')||String(data['text']??'아직 기록이 없습니다.');
          const next=typeof data['nextByte']==='number'&&Number(data['nextByte'])>Number(fields['fromByte']??0)?()=>this.post({action:'ompControl',command:'get_subagent_messages',fields:{subagentId:fields['subagentId'],fromByte:data['nextByte']}}):undefined;
          if(this.view.sheet)this.view.sheet('하위 에이전트 기록',text,next);else this.emit('sheet',{title:'하위 에이전트 기록',text});
        }
        else if(command==='get_login_providers')this.view.accountStatus?.(rows(data['providers']));
        else if(command==='model_roles')this.view.rolesResult?.(data);
        else if(command==='login_terminal'){this.notice('OMP 로그인 터미널을 열었습니다. 로그인 후 계정 탭에서 제공자 상태를 다시 조회하세요.');this.view.accountStatus?.([],'OMP 로그인 터미널에서 인증을 진행한 뒤 로그인 제공자 상태를 다시 조회하세요.');}
        else if(command==='set_model'||command==='set_thinking_level') {
          this.controlPending=false;this.status();
          this.post({action:'ompControl',command:'get_state'});
          this.post({action:'ompControl',command:'get_available_thinking_levels'});
        }
        break;
      }
      case 'session':
        this.lastTurnError='';
        this.executionRequests.clear();this.completedOperations.clear();this.view.clearExecution?.();
        this.view.clearRoles?.();
        this.loginBusy=false;this.view.clearAccount?.();
        this.settingsOpen=false;if(this.settingsSaving)this.view.settingsResult?.(false,'대화가 변경되었습니다.');this.settingsSaving=false;
        this.cancelAfterStart=false;
        if(this.submission)this.emit('submitted',{id:this.submission['id'],ok:false});
        for(const id of this.btwSubmissions)this.emit('submitted',{id,ok:false});this.btwSubmissions.clear();
        for(const id of this.queueSubmissions.keys())this.emit('submitted',{id,ok:false});this.queueSubmissions.clear();this.queue={};
        this.view.clearInteractions?.();this.models=[];this.levels=[];this.thinking='';
        this.connected = true; this.busy = this.switching = this.controlPending = false; this.submission = undefined;
        this.session = String(frame['sessionId']); this.turn = ''; this.sequence = 0; this.features = frame;
        this.approvalMode=String(frame['approvalMode']??'always-ask');this.turnApproved=false;
        this.workspace = String(frame['workspaceUri'] ?? ''); this.model = ''; this.resolve(false);
        this.context = -1; this.title = String(rows(frame['transcript']).find(item => item['role'] === 'user')?.['text'] ?? '').slice(0, 80);
        this.emit('history', {items: frame['transcript'] ?? []}); this.status(); this.refresh(false); this.emit('focusInput');
        this.emit('files',{items:null});
        this.view.gitStatus?.(object(frame['gitStatus']),frame['gitSetupEnabled']===true);
        if(this.features['btwEnabled'])this.post({action:'btwList'});
        if(this.features['preferencesEnabled'])this.post({action:'preferences'});
        if(this.features['ompControlsEnabled'])for(const command of ['get_available_models','get_available_thinking_levels','get_state','get_available_commands'])this.post({action:'ompControl',command});
        if(typeof frame['restoredDraft']==='string')this.emit('setInput',{text:frame['restoredDraft']});if(frame['restoreNotice'])this.notice(String(frame['restoreNotice']));if(frame['restoreError'])this.notice(String(frame['restoreError']));
        if(typeof frame['planPrompt']==='string')this.action({t:'submit',id:`plan-${Date.now()}`,text:frame['planPrompt']});
        break;
      case 'gitSetup': {
        this.controlPending=false;const data=object(frame['data']);
        if(data['checkpointsEnabled'])this.features['checkpointsEnabled']=true;
        if(frame['op']==='preview')this.view.gitPanel?.(data);
        else {this.view.gitStatus?.(data,this.features['gitSetupEnabled']===true);this.view.gitPanel?.(data);}
        this.status();break;
      }
      case 'selection': {
        const ctx = object(frame['context']), selection = object(ctx['selection']);
        this.emit('context', {file: String(ctx['documentUri'] ?? '').split('/').at(-1), path: ctx['documentUri'],
          selection: ctx['selection'] ? `${String(selection['startLine'])}–${String(selection['endLine'])}` : ''}); break;
      }
      case 'sessions':
        this.view.list('대화', rows(frame['sessions']).map(item => ({label: `${String(item['title'])} · ${new Date(Number(item['updatedAt'])).toLocaleString()}${item['active']?' · 사용 중':item['empty']?' · 빈 세션':''}`,
          remove:item['deletable']===true&&item['savedSessionId']!==this.features['savedSessionId']?()=>{
            if(!this.idle())return;this.controlPending=true;this.status('빈 세션 삭제 중…');
            this.post({action:'deleteEmptySession',savedSessionId:item['savedSessionId'],confirmed:true});
          }:undefined,
          disabled: item['resumable'] !== true, run: () => {
            if (!this.idle()) return; this.switching = true; this.status('대화 재개 중…');
            this.post({action: 'resumeSession', savedSessionId: item['savedSessionId']});
          }}))); break;
      case 'sessionDeleted':
        this.controlPending=false;this.notice('빈 세션을 삭제했습니다.');this.status();this.post({action:'listSessions'});break;
      case 'checkpoints':
        this.view.list('파일 변경 기록', rows(frame['items']).map(item => ({label: `${rows(item['files']).map(f => f['path']).join(', ') || String(item['path'])} · ${String(item['state'])} · ${new Date(Number(item['createdAt'])).toLocaleString()}`,
          disabled: item['state'] !== 'applied', run: () => { if (this.idle()) this.post({action: 'previewRestore', checkpointId: item['checkpointId']}); }}))); break;
      case 'restorePreview': if (this.idle()) this.showReview(object(frame['data']), true); break;
      case 'restored': this.resolve(true); this.notice(String(frame['warning'] ?? '파일을 복원했습니다. 새 대화로 이어가세요.')); this.status(); break;
      case 'usage': {
        const data = object(frame['data']), context = object(data['context']), limits = object(data['providerLimits']);
        this.model = [data['provider'], data['model']].filter(Boolean).join('/');
        this.context = typeof context['tokens'] === 'number' && typeof context['contextWindow'] === 'number' && context['contextWindow'] > 0 ? context['tokens'] / context['contextWindow'] * 100 : -1;
        this.emit('usage', {provider: data['provider'], stats: {...data, contextUsage: context['contextWindow'] ? context : null},
          limits: {...limits, limits: rows(limits['limits']).filter(l => typeof l['usedFraction'] === 'number').map(l => ({...l, used: l['usedFraction'], windowLabel: l['label'] || l['window']}))}, error: data['limitsError']});
        if(this.usageReport){this.usageReport=false;const tokens=object(data['tokens']),number=(value:unknown):string=>typeof value==='number'?value.toLocaleString():'확인 불가';this.emit('sheet',{title:'사용량 · 비용',text:`${String(data['provider']??'')} / ${String(data['model']??'')}\n\n| 항목 | 값 |\n|---|---|\n| 입력 토큰 | ${number(tokens['input'])} |\n| 출력 토큰 | ${number(tokens['output'])} |\n| 캐시 읽기 | ${number(tokens['cacheRead'])} |\n| 캐시 쓰기 | ${number(tokens['cacheWrite'])} |\n| 전체 토큰 | ${number(tokens['total'])} |\n| 비용 (USD) | ${typeof data['cost']==='number'?'$'+data['cost'].toFixed(4):'확인 불가'} |\n\nBTW는 메인 통계에 합산하지 않습니다. 보관된 BTW 토픽 비용 (USD): ${typeof object(data['btw'])['cost']==='number'?'$'+Number(object(data['btw'])['cost']).toFixed(4):'확인 불가'} · 진행 중/삭제된 토픽은 전체 비용을 보장하지 않습니다.\n\n${rows(limits['limits']).map(limit=>`- ${String(limit['label']??limit['window']??'사용량')}: ${typeof limit['usedFraction']==='number'?Math.round(limit['usedFraction']*100)+'%':'확인 불가'}`).join('\n')}${data['limitsError']?'\n\n제공자 한도를 조회하지 못했습니다.':''}`});}
        this.status(); break;
      }
      case 'error': case 'operationError':
        if(frame['action']==='deleteEmptySession'){this.controlPending=false;this.post({action:'listSessions'});}
        if(frame['action']==='gitSetup'){this.controlPending=false;this.view.gitPanel?.({},String(frame['message']));}
        if(frame['command']==='model_roles')this.view.rolesResult?.({},String(frame['message']));
        if(this.executionRequests.delete(String(frame['command']))){this.view.executionResult?.(String(frame['command']),{}, {},String(frame['message']));if(frame['command']==='compact')this.controlPending=false;}
        if(frame['command']==='login'||frame['command']==='cancel_login'){this.loginBusy=false;this.view.accountEvent?.({type:'login_status',state:'failed',message:frame['message']},()=>{});}
        if(frame['command']==='get_login_providers')this.view.accountStatus?.([],String(frame['message']));
        if(frame['command']==='login_terminal')this.view.accountStatus?.([],String(frame['message']));
        if(frame['action']==='proceedPlan')this.emit('planResult',{ok:false,text:String(frame['message'])});
        if(frame['action']==='preferences'){this.settingsOpen=false;this.settingsSaving=false;this.view.settingsResult?.(false,String(frame['message']));}
        if(frame['action']==='listFiles')this.emit('files',{items:[],error:true});
        if(frame['action']==='copy')this.emit('copyResult',{id:frame['id'],ok:false});
        if(this.btwSubmissions.delete(frame['id']))this.emit('submitted',{id:frame['id'],ok:false});
        if(frame['action']==='queuePrompt'){this.queueSubmissions.delete(frame['id']);this.emit('submitted',{id:frame['id'],ok:false});}
        if(frame['command']==='remove_queued_message'){const fields=object(frame['fields']);this.emit('queueRemoved',{sent:fields['message'],queue:fields['queue'],removed:false});}
        if(!frame['action']||frame['action']==='ompControl'&&(!frame['command']||['set_model','set_thinking_level'].includes(String(frame['command']))))this.controlPending=false;
        if ((!frame['action']||frame['action']==='prompt')&&this.submission) {this.cancelAfterStart=false;this.emit('submitted', {id: this.submission['id'], ok: false});this.submission = undefined;}
        if (!this.turn) this.busy = this.switching = false;
        if (this.review&&(!frame['action']||['decideChange','designerDecide','restoreChange','restoreMessage'].includes(String(frame['action'])))) { const {data, restore} = this.review; this.resolve(false); this.turnApproved=false; this.showReview(data, restore,false); }
        this.status(String(frame['message']), true); break;
      case 'disconnected':
        this.view.gitStatus?.({},false);
        this.executionRequests.clear();this.completedOperations.clear();this.view.executionResult?.('get_state',{}, {},'Core 연결이 종료되었습니다. 다시 연결한 뒤 조회해 주세요.');
        this.loginBusy=false;this.view.clearAccount?.();
        this.view.accountStatus?.([],'Core 연결이 종료되었습니다. 다시 연결한 뒤 조회해 주세요.');
        this.settingsOpen=false;if(this.settingsSaving)this.view.settingsResult?.(false,'연결이 종료되었습니다.');this.settingsSaving=false;
        this.cancelAfterStart=false;
        this.view.clearInteractions?.();
        if (this.submission) this.emit('submitted', {id: this.submission['id'], ok: false}); this.submission = undefined;
        for(const id of this.btwSubmissions)this.emit('submitted',{id,ok:false});this.btwSubmissions.clear();this.features={};this.controlPending=false;
        for(const id of this.queueSubmissions.keys())this.emit('submitted',{id,ok:false});this.queueSubmissions.clear();this.queue={};
        this.connected = this.busy = this.switching = false; this.turn = ''; this.resolve(false); this.status(String(frame['message'] ?? '연결 종료 · 설정에서 다시 연결할 수 있습니다.'), true); break;
      case 'event': this.event(object(frame['data'])); break;
    }
  }
  private event(data: Frame): void {
    if (data['sessionId'] !== this.session || typeof data['sequence'] !== 'number' || data['sequence'] <= this.sequence) return;
    this.sequence = data['sequence']; const kind = data['kind'];
    if(kind==='omp_event') {
      const frame=object(data['frame']);
      if(frame['type']==='login_status'){
        this.loginBusy=frame['state']==='pending';this.view.accountEvent?.(frame,()=>{});this.status(this.loginBusy?'로그인 진행 중…':'연결됨');
        if(frame['state']==='completed'){this.post({action:'ompControl',command:'get_login_providers'});this.post({action:'ompControl',command:'get_available_models'});this.post({action:'ompControl',command:'get_state'});}return;
      }
      if(frame['type']==='control_operation'){
        this.controlPending=frame['state']==='running';if(!this.controlPending){this.completedOperations.add(String(frame['operationId']));if(this.completedOperations.size>32)this.completedOperations.delete(this.completedOperations.values().next().value!);}
        if(frame['state']==='failed')this.notice(String(frame['message']??'컨텍스트 압축을 완료하지 못했습니다.'));
        else if(frame['state']==='completed')this.notice('컨텍스트를 압축했습니다.');
        this.view.executionEvent?.(frame);this.status(this.controlPending?'컨텍스트 압축 중…':'연결됨');if(!this.controlPending)this.refresh();return;
      }
      if(frame['type']==='extension_ui_request'&&frame['login']===true){this.view.accountEvent?.(frame,answer=>this.post({action:'ompRespond',requestId:frame['id'],answer}));return;}
      if(frame['type']==='designer_approval'){this.showReview({...frame,designer:true},false);return;}
      if(frame['type']==='designer_resolved'){this.resolve(frame['approved']===true);this.status('응답 중…');return;}
      if(frame['type']==='ui_event'){const event=object(frame['event']);if(event['t']==='queue')this.queue=event;if(event['t']==='commands'){this.commands(event['items']);return;}this.view.emit(event);if(event['t']==='toolEnd'&&this.features['ompControlsEnabled'])this.post({action:'ompControl',command:'get_state'});return;}
      if(frame['type']==='extension_ui_request') {
        const method=frame['method'];
        if(['select','confirm','input','editor','cancel'].includes(String(method)))this.view.interaction?.(frame,answer=>this.post({action:'ompRespond',requestId:frame['id'],answer}));
        else if(method==='notify'||method==='setStatus')this.notice(String(frame['message']??frame['statusText']??''));
        else if(method==='set_editor_text')this.emit('setInput',{text:frame['text']});
        else if(method==='open_url'){const url=String(frame['launchUrl']??frame['url']??'');this.notice(String(frame['instructions']??'OMP 요청으로 브라우저를 엽니다.'));this.post({action:'openUrl',url});}
        else if(method==='setTitle'){this.title=String(frame['title']??'');this.status();}
        else if(method==='setWidget')this.notice(Array.isArray(frame['widgetLines'])?frame['widgetLines'].join('\n'):'');
      }
      return;
    }
    if (kind === 'warning') { this.notice(String(data['text'])); return; }
    if (kind === 'closed') {
      this.view.clearInteractions?.(); this.connected = this.busy = false; this.turn = ''; this.controlPending=false;this.resolve(false);
      this.status(this.switching ? '대화 준비 중…' : String(data['text']??(this.lastTurnError||'작업 세션이 종료되었습니다. 설정에서 다시 연결할 수 있습니다.')),!!this.lastTurnError); return;
    }
    if (kind === 'started') {
      this.lastTurnError='';
      this.started=Date.now();
      this.turn = String(data['turnId']); this.busy = true; this.turnApproved=false;
      if (this.submission) { this.title ||= String(this.submission['text']).slice(0, 80); this.emit('user', {text: this.submission['text'],attachments:this.submission['attachments'],ts:this.started}); this.emit('submitted', {id: this.submission['id'], ok: true}); this.submission = undefined; }
      this.status('응답 중…');if(this.cancelAfterStart){this.cancelAfterStart=false;this.post({action:'cancel',turnId:this.turn});}return;
    }
    if (!this.turn || data['turnId'] !== this.turn) return;
    switch (kind) {
      case 'activity': {
        const activity=object(data['frame']),elapsed=Number(activity['elapsedMs']);
        const duration=Number.isFinite(elapsed)&&elapsed>=0?` · ${Math.floor(elapsed/60000)}분 ${Math.floor(elapsed/1000)%60}초`:'';
        this.status(String(data['text']??'작업 진행 중')+duration);break;
      }
      case 'delta': this.emit('assistantDelta', {text: String(data['text'] ?? '')}); break;
      case 'tool_started': this.tool = String(data['toolId']??`${this.turn}-${this.sequence}`); this.emit('toolStart', {id: this.tool, name: data['text']}); break;
      case 'tool_completed': this.emit('toolEnd', {id: data['toolId']??this.tool, ok: data['text'] !== 'Workspace request rejected', result: data['text']}); break;
      case 'approval_requested': this.showReview(object(data['approval']), false); break;
      case 'approval_resolved': { const result = object(data['approval']); this.resolve(result['approved'] === true); if (result['warning']) this.notice(String(result['warning'])); this.status('응답 중…'); break; }
      case 'completed': case 'cancelled': case 'error':
        if(kind==='error'){this.lastTurnError=String(data['text']??'작업 오류가 발생했습니다.');this.notice(this.lastTurnError);}
        if(kind==='completed'&&this.preferences['notifications'])this.post({action:'notify'});
        this.emit('assistantEnd'); this.emit('turnEnd',{started:this.started,ended:Date.now(),stopped:kind!=='completed'}); this.busy = false; this.turn = ''; this.resolve(false);
        this.status(kind === 'completed' ? '응답 완료' : kind === 'cancelled' ? '취소됨' : String(data['text']), kind === 'error');
        this.refresh(); this.emit('focusInput'); break;
    }
  }
  private commands(items:unknown):void {this.emit('commands',{items:[...localCommands,...rows(items).filter(item=>typeof item['name']==='string'&&!localCommands.some(local=>local.name===item['name']))]});}
}
