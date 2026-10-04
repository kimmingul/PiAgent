/** Translate the existing RADAgent UI contract; never interpret transcript text as host actions. */
export type Frame = Record<string, unknown>;
export const object = (value: unknown): Frame => value && typeof value === 'object' && !Array.isArray(value) ? value as Frame : {};
export const rows = (value: unknown): Frame[] => Array.isArray(value) ? value.map(object) : [];
export interface View {
  emit(frame: Frame): void;
  list(title: string, items: {label: string; disabled?: boolean; run(): void}[]): void;
  capabilities(frame: Frame): void;
  clearInteractions?():void;
  interaction?(frame:Frame,answer:(value:Frame)=>void):void;
}
export class Controller {
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
  private catalog():void {this.emit('catalog',{models:this.models,levels:this.levels});this.status();}
  constructor(private readonly post: (frame: Frame) => void, private readonly view: View) {}
  private emit(t: string, data: Frame = {}): void { this.view.emit({t, ...data}); }
  private notice(text: string): void { this.emit('notice', {level: 'info', text}); }
  private status(state = '연결됨', error = false): void {
    this.emit('status', {connected: this.connected, busy: this.busy || this.switching || !!this.review,
      state, error, activity: state, model: this.model, thinking:this.thinking, title: this.title, cwd: this.workspace, queueEnabled: false,
      project: decodeURIComponent(this.workspace.replace(/\/$/,'').split(/[\\/]/).filter(Boolean).at(-1)??''), approval: this.approvalMode, context: this.context});
    this.view.capabilities({...this.features,connected:this.connected,busy:this.busy||this.switching||!!this.review});
  }
  private idle(): boolean { return this.connected && !this.busy && !this.switching && !this.review; }
  private refresh(): void {
    if (this.features['usageEnabled']) this.post({action: 'usage'});
  }
  action(msg: Frame): void {
    switch (msg['t']) {
      case 'setApproval':
        if(this.idle()&&Array.isArray(this.features['approvalModes'])&&this.features['approvalModes'].includes(msg['value'])) {
          this.switching=true;this.status('접근 모드 변경 중…');this.post({action:'setApproval',mode:msg['value']});
        }break;
      case 'attachFiles':case 'addFolder':case 'listExtensions':case 'manageExtensions':case 'toggleMcpServer':case 'togglePlugin':case 'compile':
        if(this.idle())this.post({action:msg['t'],...Object.fromEntries(Object.entries(msg).filter(([key])=>key!=='t'))});break;
      case 'setModel': {
        if(!this.idle()||!this.features['ompControlsEnabled'])return;
        const value=String(msg['value']), at=value.indexOf('/');if(at<1)return;
        this.post({action:'ompControl',command:'set_model',fields:{provider:value.slice(0,at),modelId:value.slice(at+1)}});break;
      }
      case 'setThinking':
        if(this.idle()&&this.features['ompControlsEnabled'])this.post({action:'ompControl',command:'set_thinking_level',fields:{level:msg['value']}});break;
      case 'ready': this.post({action: 'ready'}); this.status('연결 중…'); this.post({action: 'connect'}); break;
      case 'connect': if (!this.connected && !this.switching) { this.switching = true; this.status('연결 중…'); this.post({action: 'connect'}); } break;
      case 'newSession': if (this.idle()) { this.switching = true; this.status('새 대화 준비 중…'); this.post({action: 'reset'}); } break;
      case 'sessions': if (this.idle() && this.features['sessionsEnabled']) this.post({action: 'listSessions'}); break;
      case 'usage': if (this.idle()) this.refresh(); break;
      case 'submit': {
        const text = String(msg['text'] ?? '');
        if (!this.idle() || this.submission || !text.trim() || new TextEncoder().encode(text).length > 65536) {
          this.emit('submitted', {id: msg['id'], ok: false}); this.notice('현재 응답·승인을 마친 뒤 64 KiB 이하의 메시지를 보내 주세요.'); return;
        }
        if (text.trim().startsWith('/') && (this.features['ompProfile']!=='native'||['/new','/sessions','/usage','/restore','/selection'].includes(text.trim()))) {
          const accepted = this.command(text.trim()); this.emit('submitted', {id: msg['id'], ok: accepted}); return;
        }
        this.submission = msg; this.busy = true; this.status('응답 대기 중…');
        // Selection was captured by the IDE; only an explicit chip selection includes it.
        if (!msg['withSelection'] && this.features['selectionEnabled']) this.post({action: 'clearSelection'});
        this.post({action: 'prompt', message: text,...(Array.isArray(msg['attachments'])&&msg['attachments'].length?{attachments:msg['attachments']}: {})}); break;
      }
      case 'abort': if (this.turn) this.post({action: 'cancel', turnId: this.turn}); break;
      case 'approval': {
        const review = this.review;
        if (!review || review.deciding || msg['id'] !== review.id || typeof msg['ok'] !== 'boolean') return;
        if (review.restore && !msg['ok']) { this.resolve(false); this.status(); return; }
        review.deciding = true;
        if(msg['ok']&&!review.restore)this.turnApproved=true;
        if(review.data['designer']===true){this.post({action:'designerDecide',proposalId:review.id,approved:msg['ok']});break;}
        this.post(review.restore ? {action: 'restoreChange', checkpointId: review.id} :
          {action: 'decideChange', proposalId: review.id, decision: msg['ok'] ? 'approve' : 'reject'}); break;
      }
      case 'runCommand': this.command(String(msg['text'])); break;
      case 'settings':
        this.view.list('PiAgent', [
          {label: '연결 다시 시도', disabled: this.connected || this.switching, run: () => this.action({t: 'connect'})},
          {label: '파일 변경 기록', disabled: !this.idle() || !this.features['writeEnabled'], run: () => this.post({action: 'listCheckpoints'})}
        ]); break;
      case 'captureSelection': if (this.idle() && this.features['selectionEnabled']) this.post({action: 'captureSelection'}); break;
      case 'copy': break; // The original renderer already writes to the browser clipboard.
      default: this.notice(this.connected ? '현재 연결에서 지원하지 않는 기능입니다.' : 'Core 연결을 먼저 확인해 주세요. 설정에서 연결을 다시 시도할 수 있습니다.');
    }
  }
  private command(text: string): boolean {
    switch (text) {
      case '/new': this.action({t: 'newSession'}); return true;
      case '/sessions': this.action({t: 'sessions'}); return true;
      case '/usage': this.refresh(); return true;
      case '/restore': if (this.idle() && this.features['writeEnabled']) this.post({action: 'listCheckpoints'}); return true;
      case '/selection': this.action({t: 'captureSelection'}); return true;
      default: this.notice('지원하는 명령: /new, /sessions, /usage, /restore, /selection'); return false;
    }
  }
  private showReview(data: Frame, restore: boolean): void {
    const id = String(data[restore ? 'checkpointId' : 'proposalId']);
    this.review = {id, restore, data, deciding: false};
    if(!restore&&(this.approvalMode==='yolo'||(this.approvalMode==='write'&&this.turnApproved))) {this.action({t:'approval',id,ok:true});return;}
    this.emit('approval', {id, target: rows(data['files']).map(f => f['path']).join(', ') || data['path'],
      summary: restore ? '파일 복원 확인 · 대화 기록은 되돌리지 않습니다. 이후 파일이 바뀌었다면 복원이 거부됩니다.' : data['reason'],
      lines: String(data['diff'] ?? '').split('\n').map(line => ({k: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx', t: /^[+-]/.test(line) ? line.slice(1) : line}))});
    this.status('승인 대기 중');
  }
  private resolve(ok: boolean): void {
    if (this.review) this.emit('approvalResult', {id: this.review.id, ok}); this.review = undefined;
  }
  receive(frame: Frame): void {
    switch (frame['type']) {
      case 'attachments':this.emit('attachments',{items:frame['items']??[]});break;
      case 'extensions':this.emit('extensions',frame);break;
      case 'ompControl': {
        const command=frame['command'],data=object(frame['data']);
        if(command==='get_available_models') {this.models=rows(data['models']).map(m=>`${String(m['provider'])}/${String(m['id'])}`);this.catalog();}
        else if(command==='get_available_thinking_levels') {this.levels=Array.isArray(data['levels'])?data['levels']:[];this.catalog();}
        else if(command==='get_state') {const model=object(data['model']);this.model=[model['provider'],model['id']].filter(Boolean).join('/');this.thinking=String(data['thinkingLevel']??'');this.status();}
        else if(command==='set_model'||command==='set_thinking_level') {
          this.post({action:'ompControl',command:'get_state'});
          this.post({action:'ompControl',command:'get_available_thinking_levels'});
        }
        break;
      }
      case 'session':
        this.view.clearInteractions?.();this.models=[];this.levels=[];this.thinking='';
        this.connected = true; this.busy = this.switching = false; this.submission = undefined;
        this.session = String(frame['sessionId']); this.turn = ''; this.sequence = 0; this.features = frame;
        this.approvalMode=String(frame['approvalMode']??'always-ask');this.turnApproved=false;
        this.workspace = String(frame['workspaceUri'] ?? ''); this.model = ''; this.resolve(false);
        this.context = -1; this.title = String(rows(frame['transcript']).find(item => item['role'] === 'user')?.['text'] ?? '').slice(0, 80);
        this.emit('history', {items: frame['transcript'] ?? []}); this.status(); this.refresh(); this.emit('focusInput');
        if(this.features['ompControlsEnabled'])for(const command of ['get_available_models','get_available_thinking_levels','get_state'])this.post({action:'ompControl',command});
        break;
      case 'selection': {
        const ctx = object(frame['context']), selection = object(ctx['selection']);
        this.emit('context', {file: String(ctx['documentUri'] ?? '').split('/').at(-1), path: ctx['documentUri'],
          selection: ctx['selection'] ? `${String(selection['startLine'])}–${String(selection['endLine'])}` : ''}); break;
      }
      case 'sessions':
        this.view.list('대화', rows(frame['sessions']).map(item => ({label: `${String(item['title'])} · ${new Date(Number(item['updatedAt'])).toLocaleString()}`,
          disabled: item['resumable'] !== true, run: () => {
            if (!this.idle()) return; this.switching = true; this.status('대화 재개 중…');
            this.post({action: 'resumeSession', savedSessionId: item['savedSessionId']});
          }}))); break;
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
        this.status(); break;
      }
      case 'error': case 'operationError':
        if (this.submission) this.emit('submitted', {id: this.submission['id'], ok: false}); this.submission = undefined;
        if (!this.turn) this.busy = this.switching = false;
        if (this.review) { const {data, restore} = this.review; this.resolve(false); this.showReview(data, restore); }
        this.status(String(frame['message']), true); break;
      case 'disconnected':
        this.view.clearInteractions?.();
        if (this.submission) this.emit('submitted', {id: this.submission['id'], ok: false}); this.submission = undefined;
        this.connected = this.busy = this.switching = false; this.turn = ''; this.resolve(false); this.status(String(frame['message'] ?? '연결 종료 · 설정에서 다시 연결할 수 있습니다.'), true); break;
      case 'event': this.event(object(frame['data'])); break;
    }
  }
  private event(data: Frame): void {
    if (data['sessionId'] !== this.session || typeof data['sequence'] !== 'number' || data['sequence'] <= this.sequence) return;
    this.sequence = data['sequence']; const kind = data['kind'];
    if(kind==='omp_event') {
      const frame=object(data['frame']);
      if(frame['type']==='designer_approval'){this.showReview({...frame,designer:true},false);return;}
      if(frame['type']==='designer_resolved'){this.resolve(frame['approved']===true);this.status('응답 중…');return;}
      if(frame['type']==='ui_event'){this.view.emit(object(frame['event']));return;}
      if(frame['type']==='extension_ui_request') {
        const method=frame['method'];
        if(['select','confirm','input','editor','cancel'].includes(String(method)))this.view.interaction?.(frame,answer=>this.post({action:'ompRespond',requestId:frame['id'],answer}));
        else if(method==='notify'||method==='setStatus')this.notice(String(frame['message']??frame['statusText']??''));
        else if(method==='set_editor_text')this.emit('setInput',{text:frame['text']});
      }
      return;
    }
    if (kind === 'warning') { this.notice(String(data['text'])); return; }
    if (kind === 'closed') { this.view.clearInteractions?.(); this.connected = this.busy = false; this.turn = ''; this.resolve(false); this.status(this.switching ? '대화 준비 중…' : '연결 종료'); return; }
    if (kind === 'started') {
      this.turn = String(data['turnId']); this.busy = true; this.turnApproved=false;
      if (this.submission) { this.title ||= String(this.submission['text']).slice(0, 80); this.emit('user', {text: this.submission['text']}); this.emit('submitted', {id: this.submission['id'], ok: true}); this.submission = undefined; }
      this.status('응답 중…'); return;
    }
    if (!this.turn || data['turnId'] !== this.turn) return;
    switch (kind) {
      case 'delta': this.emit('assistantDelta', {text: String(data['text'] ?? '')}); break;
      case 'tool_started': this.tool = `${this.turn}-${this.sequence}`; this.emit('toolStart', {id: this.tool, name: data['text']}); break;
      case 'tool_completed': this.emit('toolEnd', {id: this.tool, ok: data['text'] !== 'Workspace request rejected', result: data['text']}); break;
      case 'approval_requested': this.showReview(object(data['approval']), false); break;
      case 'approval_resolved': { const result = object(data['approval']); this.resolve(result['approved'] === true); if (result['warning']) this.notice(String(result['warning'])); this.status('응답 중…'); break; }
      case 'completed': case 'cancelled': case 'error':
        this.emit('assistantEnd'); this.emit('turnEnd'); this.busy = false; this.turn = ''; this.resolve(false);
        this.status(kind === 'completed' ? '응답 완료' : kind === 'cancelled' ? '취소됨' : String(data['text']), kind === 'error');
        this.refresh(); this.emit('focusInput'); break;
    }
  }
}

