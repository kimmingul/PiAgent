import {randomUUID,createHash} from 'node:crypto';
import {isObject} from '@piagent/protocol';
import {parseIdeCatalog,catalogEntry,actionable,type IdeCatalog} from './ide-catalog.js';
import {changeDiff} from './change-diff.js';
export const IDE_CAPABILITY='ide.tools.v1';
export const EDITOR_CAPABILITY='editor.suggestions.v1';
const string={type:'string',maxLength:4096};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]=[])=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false},loadMode:'essential'});
export const ideTools=[
  tool('ide_context','Start with one snapshot for an IDE overview: it already includes the bounded project inventory, active configuration/platform, open documents and active unsaved editor text when available. Request additional operations only when more detail is needed. Read-only observation; not a disk-file replacement.',{operation:{enum:['snapshot','configurations','projects','documents','dependencies']}}),
  tool('ide_diagnostics','Read connected IDE diagnostics with file, line, code, severity and provenance. May be stale until a build finishes.',{}),
  tool('ide_symbols','Use the IDE semantic workspace for supported symbol navigation. Unsupported languages return explicit availability; do not substitute text matches as semantic results.',{operation:{enum:['search','definition','references','callers','implementations','overrides','baseTypes','signature']},query:string,file:string,line:{type:'integer',minimum:1},column:{type:'integer',minimum:1}},['operation']),
  tool('ide_build','Build, rebuild or clean the bound IDE project/solution. Requires user approval; refuses unsaved buffers. Returns actual completion and diagnostic provenance. An explicit external backend must be supported by the adapter; never silently run a second build.',{operation:{enum:['build','rebuild','clean']},backend:{enum:['native','external']},rebuild:{type:'boolean'},project:string,configuration:string,platform:string}),
  tool('ide_tests','Discover or run tests in a supported existing project and parse actual results. Execution requires approval, including discovery because it can build. Does not claim Test Explorer state.',{project:string,operation:{enum:['discover','run']},filter:string,configuration:string,framework:string,settings:string,timeoutSeconds:{type:'integer',minimum:60,maximum:150}},['project','operation']),
  tool('ide_debug','Read a bounded debugger snapshot, breakpoints or threads; control and expression evaluation require approval. Evaluation can execute getters or functions.',{operation:{enum:['snapshot','breakpoints','threads','breakpoint','start','continue','stepOver','stepInto','stepOut','stop','evaluate','pause','removeBreakpoint','enableBreakpoint','selectThread','selectFrame']},file:string,line:{type:'integer',minimum:1},expression:string,breakpointId:string,enabled:{type:'boolean'},threadId:{type:'integer',minimum:1},frameIndex:{type:'integer',minimum:0},condition:string,hitCount:{type:'integer',minimum:1}},['operation']),
  tool('ide_profile','Capture bounded CPU/GC observations from the advertised adapter backend or compare CPU against a previous opaque trace ID. Requires approval; availability, measurement scope and runtime constraints come from the IDE catalog. Process CPU counters do not imply allocation data or function call stacks.',{operation:{enum:['cpu','gc','compare']},processId:{type:'integer',minimum:1},durationSeconds:{type:'integer',minimum:1,maximum:30},baselineTrace:string},['processId']),
  tool('ide_refactor','Preview a supported semantic rename, format or simplify operation. Review returned files before apply; apply requires user approval and unchanged saved documents. Only advertised operations are supported.',{operation:{enum:['rename','format','simplify','apply']},file:string,line:{type:'integer',minimum:1},column:{type:'integer',minimum:1},newName:string,proposalId:string,revision:string},['operation']),
  tool('ide_run','Inspect run/publish configuration, preview an isolated local publish, or publish a reviewed plan. Publish executes project build targets and requires approval. No cloud or remote target is accepted.',{operation:{enum:['inspect','publish-preview','publish']},project:string,configuration:string,framework:string,proposalId:string,revision:string},['operation'])
];
export const ideCatalogTool=tool('ide_catalog','Inspect connected IDE operations, availability, blocking reasons, supported languages and current state. Availability is an observation, not permission.',{});
export function ideAction(name:string,args:Record<string,unknown>):boolean{return name==='ide_build'||name==='ide_tests'||name==='ide_profile'||name==='ide_debug'&&!['snapshot','breakpoints','threads'].includes(String(args['operation']))||name==='ide_refactor'&&args['operation']==='apply'||name==='ide_run'&&args['operation']==='publish';}
type RefactorPreview={proposalId:string;revision:string;expiresAt:number;files:{path:string;before:string;after:string;beforeRevision:string}[]};
type PublishPreview={proposalId:string;revision:string;expiresAt:number;proposal:Record<string,unknown>};
const legacyFields:Record<string,string[]>={ide_context:[],ide_diagnostics:[],ide_symbols:['operation','query','file','line','column'],ide_build:['rebuild'],ide_tests:['project','operation','filter'],ide_debug:['operation','file','line','expression'],ide_profile:['processId','durationSeconds']};
const legacyOperations:Record<string,string[]>={ide_symbols:['search','definition','references','callers'],ide_debug:['snapshot','breakpoint','start','continue','stepOver','stepInto','stepOut','stop','evaluate']};
type Pending={resolve:(v:Record<string,unknown>)=>void;reject:(e:Error)=>void;cleanup:()=>void};
/** Connection-local IDE request and consent broker. Never executes SDK calls in Core. */
export class IdeBridge {
  enabled=false;
  controlsEnabled=false;
  catalogEnabled=false;
  private catalog:IdeCatalog|undefined;
  private catalogWorkspaceUri:string|undefined;
  private previews=new Map<string,RefactorPreview>();
  private publishPreviews=new Map<string,PublishPreview>();
  private pending=new Map<string,Pending>();
  private approvals=new Map<string,{resolve:(approved:boolean)=>void;cleanup:()=>void}>();
  constructor(private readonly emit:(frame:Record<string,unknown>)=>void,private readonly approvalTimeoutMs=300000){}
  get snapshot():IdeCatalog|undefined{return this.catalog?structuredClone(this.catalog):undefined;}
  bindCatalog(value:unknown,workspaceUri:string):void {
    this.catalogWorkspaceUri=workspaceUri;
    if(value!==undefined){this.publish(value,workspaceUri);return;}
    if(this.catalog)try{parseIdeCatalog(this.catalog,workspaceUri);}catch{this.catalog=undefined;}
  }
  publish(value:unknown,workspaceUri?:string):IdeCatalog {
    this.catalog=parseIdeCatalog(value,workspaceUri??this.catalogWorkspaceUri??this.catalog?.workspaceUri);
    this.emit({type:'ide_catalog',catalog:this.snapshot});return this.snapshot!;
  }
  registeredTools(){
    const tools=ideTools.filter(t=>this.catalogEnabled||!['ide_refactor','ide_run'].includes(t.name)).flatMap(t=>{
      const properties=this.catalogEnabled?t.parameters.properties:Object.fromEntries(Object.entries(t.parameters.properties).filter(([key])=>legacyFields[t.name]?.includes(key))),operation=properties['operation'] as {enum?:string[]}|undefined;
      if(operation?.enum){
        const allowed=operation.enum.filter(op=>(this.controlsEnabled||!ideAction(t.name,{operation:op}))&&(this.catalogEnabled?!!this.catalog&&actionable(catalogEntry(this.catalog,t.name,op)):!legacyOperations[t.name]||legacyOperations[t.name]!.includes(op)));
        return allowed.length?[{...t,parameters:{...t.parameters,properties:{...properties,operation:{enum:allowed}}}}]:[];
      }
      return (this.controlsEnabled||!ideAction(t.name,{}))&&(!this.catalogEnabled||!!this.catalog&&actionable(catalogEntry(this.catalog,t.name,t.name==='ide_build'?'build':undefined)))?[{...t,parameters:{...t.parameters,properties}}]:[];
    });
    return this.catalogEnabled?[ideCatalogTool,...tools]:tools;
  }
  get waiting():boolean{return this.approvals.size>0;}
  ownsApproval(id:unknown):boolean{return typeof id==='string'&&this.approvals.has(id);}
  async confirm(review:{path:string;reason:string;diff:string;expiresAt?:number},signal:AbortSignal):Promise<boolean>{
    if(this.approvals.size>=4)throw new Error('Too many pending approvals');
    const id=randomUUID(),expiresAt=Math.min(review.expiresAt??Infinity,Date.now()+this.approvalTimeoutMs);
    const approved=await new Promise<boolean>(resolve=>{
      const stop=()=>{this.approvals.delete(id);cleanup();resolve(false);};
      const timer=setTimeout(stop,Math.max(0,expiresAt-Date.now()));
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
      if(signal.aborted||expiresAt<=Date.now()){cleanup();resolve(false);return;}
      signal.addEventListener('abort',stop,{once:true});this.approvals.set(id,{resolve,cleanup});
      this.emit({type:'designer_approval',proposalId:id,path:review.path,reason:review.reason,diff:review.diff,expiresAt});
    });this.emit({type:'designer_resolved',proposalId:id,approved});return approved;
  }
  decide(id:unknown,approved:unknown):{accepted:true}{
    if(typeof id!=='string'||typeof approved!=='boolean'||!this.approvals.has(id))throw new Error('IDE approval expired');
    const item=this.approvals.get(id)!;this.approvals.delete(id);item.cleanup();item.resolve(approved);return {accepted:true};
  }
  reply(id:unknown,result:unknown,error:unknown):{accepted:true}{
    if(typeof id!=='string'||!this.pending.has(id))throw new Error('IDE request expired');
    const item=this.pending.get(id)!;this.pending.delete(id);item.cleanup();
    if(typeof error==='string')item.reject(new Error(error.slice(0,2048)));
    else if(isObject(result)&&Buffer.byteLength(JSON.stringify(result))<=240*1024)item.resolve(result);
    else item.reject(new Error('Invalid IDE result'));return {accepted:true};
  }
  async execute(name:string,args:unknown,signal:AbortSignal):Promise<Record<string,unknown>>{
    if(!this.enabled||!isObject(args))throw new Error('IDE tools were not negotiated');
    if(name==='ide_catalog'){
      if(!this.catalogEnabled||Object.keys(args).length)throw new Error('IDE catalog was not negotiated');
      return await this.refresh(signal) as unknown as Record<string,unknown>;
    }
    const definition=ideTools.find(t=>t.name===name);if(!definition)throw new Error('Unknown IDE tool');
    if(!this.catalogEnabled&&(Object.keys(args).some(k=>!legacyFields[name]?.includes(k))||legacyOperations[name]&&!legacyOperations[name]!.includes(String(args['operation']))))throw new Error('Invalid IDE arguments: operation extension was not negotiated');
    const fields=definition.parameters.properties;
    if(Object.keys(args).some(k=>!Object.hasOwn(fields,k))||definition.parameters.required.some(k=>!Object.hasOwn(args,k)))throw new Error('Invalid IDE arguments');
    for(const [key,value] of Object.entries(args)){
      const schema=fields[key] as {type?:string;enum?:unknown[];minimum?:number;maximum?:number};
      if(schema.enum&&!schema.enum.includes(value)||schema.type==='string'&&(typeof value!=='string'||value.length>4096)||schema.type==='boolean'&&typeof value!=='boolean'||schema.type==='integer'&&(!Number.isSafeInteger(value)||Number(value)<(schema.minimum??0)||Number(value)>(schema.maximum??2147483647)))throw new Error('Invalid IDE arguments');
    }
    if(name==='ide_symbols'&&args['operation']!=='search'&&(!args['file']||!args['line']||!args['column']))throw new Error('Symbol position required');
    if(name==='ide_symbols'&&args['operation']==='search'&&!args['query'])throw new Error('Symbol query required');
    if(name==='ide_debug'&&args['operation']==='breakpoint'&&(!args['file']||!args['line'])||name==='ide_debug'&&args['operation']==='evaluate'&&!args['expression'])throw new Error('Debug arguments required');
    if(name==='ide_refactor'&&!this.catalogEnabled)throw new Error('IDE refactoring was not negotiated');
    if(name==='ide_refactor'&&args['operation']==='apply'&&(!args['proposalId']||!args['revision']))throw new Error('Refactoring preview and revision required');
    if(name==='ide_refactor'&&args['operation']!=='apply'&&!args['file'])throw new Error('Refactoring file required');
    if(name==='ide_run'&&!this.catalogEnabled)throw new Error('IDE run configuration was not negotiated');
    const publish=name==='ide_run'&&args['operation']==='publish'?this.publishPreviews.get(String(args['proposalId'])):undefined;
    if(name==='ide_run'&&args['operation']==='publish'&&(!publish||publish.revision!==args['revision']||publish.expiresAt<=Date.now()))throw new Error('Publish preview expired or changed; request a new preview');
    const preview=name==='ide_refactor'&&args['operation']==='apply'?this.previews.get(String(args['proposalId'])):undefined;
    if(name==='ide_refactor'&&args['operation']==='apply'&&(!preview||preview.revision!==args['revision']||preview.expiresAt<=Date.now()))throw new Error('Refactoring preview expired or changed; request a new preview');
    const action=ideAction(name,args);
    let state:IdeCatalog|undefined;
    if(this.catalogEnabled)this.requireAvailable(name,args,this.catalog);
    if(action&&!this.controlsEnabled)throw new Error('IDE execution is disabled in plan/read-only mode');
    if(this.approvals.size+this.pending.size>=4)throw new Error('Too many IDE requests');
    if(this.catalogEnabled){state=action?await this.refresh(signal):this.catalog;this.requireAvailable(name,args,state);}
    if(action){
      if(!this.controlsEnabled)throw new Error('IDE execution is disabled in plan/read-only mode');
      const id=randomUUID();
      const approved=await new Promise<boolean>(resolve=>{
        const stop=()=>{this.approvals.delete(id);cleanup();resolve(false);};
        const timer=setTimeout(stop,this.approvalTimeoutMs);
        const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
        if(signal.aborted){cleanup();resolve(false);return;}
        signal.addEventListener('abort',stop,{once:true});this.approvals.set(id,{resolve,cleanup});
        this.emit({type:'designer_approval',proposalId:id,path:preview?.files.map(f=>f.path).join(', ')??state?.workspaceUri??'IDE',reason:`${name}: ${String(args['operation']??'execute')}`,diff:preview?preview.files.map(f=>changeDiff(f.path,Buffer.from(f.before),Buffer.from(f.after))).join('\n\n'):JSON.stringify(publish?.proposal??args,null,2),expiresAt:Date.now()+this.approvalTimeoutMs});
      });
      this.emit({type:'designer_resolved',proposalId:id,approved});
      if(!approved||signal.aborted)return {executed:false,status:'cancelled',cancellation:'before_execution',reason:'User declined, approval expired or cancelled'};
      if(state){const current=await this.refresh(signal);this.requireAvailable(name,args,current);if(current.revision!==state.revision)throw new Error('IDE state changed after preview; approve again');}
      if(preview){if(preview.expiresAt<=Date.now())throw new Error('Refactoring preview expired');this.previews.delete(preview.proposalId);}
      if(publish){if(publish.expiresAt<=Date.now())throw new Error('Publish preview expired');this.publishPreviews.delete(publish.proposalId);}
    }
    const result=await this.request(name,args,signal,action,action&&state?{workspaceUri:state.workspaceUri,revision:state.revision}:undefined);
    if(name==='ide_refactor'&&!action&&result['available']===true)this.cachePreview(result);
    if(name==='ide_run'&&args['operation']==='publish-preview'&&result['available']===true)this.cachePublish(result);
    return result;
  }
  private cachePublish(result:Record<string,unknown>):void {
    const proposal=result['proposal'];
    if(typeof result['proposalId']!=='string'||!result['proposalId']||result['proposalId'].length>128||typeof result['revision']!=='string'||!result['revision']||result['revision'].length>256||!isObject(proposal)||Buffer.byteLength(JSON.stringify(proposal))>32768||!['project','backend','outputDirectory','scope'].every(k=>typeof proposal[k]==='string'&&!!proposal[k]&&String(proposal[k]).length<=4096)||!Array.isArray(proposal['arguments'])||proposal['arguments'].length>64||!proposal['arguments'].every(v=>typeof v==='string'&&v.length<=4096)||!String(proposal['scope']).toLowerCase().includes('local'))throw new Error('Invalid local publish preview');
    for(const [id,item] of this.publishPreviews)if(item.expiresAt<=Date.now())this.publishPreviews.delete(id);
    if(this.publishPreviews.size>=8)this.publishPreviews.delete(this.publishPreviews.keys().next().value!);
    this.publishPreviews.set(String(result['proposalId']),{proposalId:String(result['proposalId']),revision:String(result['revision']),expiresAt:Date.now()+300000,proposal:structuredClone(proposal)});
  }
  private cachePreview(result:Record<string,unknown>):void {
    const fail=():never=>{throw new Error('Invalid refactoring preview');};
    if(typeof result['proposalId']!=='string'||!result['proposalId']||result['proposalId'].length>128||typeof result['revision']!=='string'||!result['revision']||result['revision'].length>256||!Array.isArray(result['files'])||!result['files'].length||result['files'].length>8)fail();
    let beforeBytes=0,afterBytes=0;const paths=new Set<string>();
    const files=(result['files'] as unknown[]).map(file=>{
      if(!isObject(file)||typeof file['path']!=='string'||file['path'].length>4096||/[:\0\r\n]/.test(file['path'])||file['path'].split(/[\\/]/).some(p=>!p||p==='.'||p==='..')||typeof file['before']!=='string'||typeof file['after']!=='string'||typeof file['beforeRevision']!=='string')return fail();
      const path=file['path'];if(paths.has(path.toLowerCase()))return fail();paths.add(path.toLowerCase());
      beforeBytes+=Buffer.byteLength(file['before']);afterBytes+=Buffer.byteLength(file['after']);
      if(beforeBytes>131072||afterBytes>131072||[file['before'],file['after']].some(text=>text.includes('\0')||Buffer.from(text).toString('utf8')!==text)||createHash('sha256').update(file['before']).digest('hex')!==file['beforeRevision']||file['before']===file['after'])return fail();
      return {path,before:file['before'],after:file['after'],beforeRevision:file['beforeRevision']};
    });
    for(const [id,item] of this.previews)if(item.expiresAt<=Date.now())this.previews.delete(id);
    if(this.previews.size>=8)this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(String(result['proposalId']),{proposalId:String(result['proposalId']),revision:String(result['revision']),files,expiresAt:Date.now()+300000});
  }
  private requireAvailable(name:string,args:Record<string,unknown>,state:IdeCatalog|undefined):void {
    const operation=args['operation']??(name==='ide_build'?(args['rebuild']?'rebuild':'build'):name==='ide_context'?'snapshot':name==='ide_profile'?'cpu':undefined);
    const entry=state?catalogEntry(state,name,operation):undefined;
    if(!actionable(entry))throw new Error(entry?`${entry.reasonCode??entry.availability}: ${entry.reason??'IDE operation unavailable'}`:'IDE operation is not advertised');
  }
  private async refresh(signal:AbortSignal):Promise<IdeCatalog>{return this.publish(await this.request('ide_catalog',{},signal));}
  private async request(name:string,args:Record<string,unknown>,signal:AbortSignal,action=false,expectedState?:{workspaceUri:string;revision:string}):Promise<Record<string,unknown>>{
    if(signal.aborted)throw new Error('IDE request cancelled');
    if(this.pending.size>=4)throw new Error('Too many IDE requests');
    const id=randomUUID();
    return await new Promise((resolve,reject)=>{
      const stop=()=>{this.pending.delete(id);cleanup();this.emit({type:'ide_cancel',id});reject(new Error(action?'IDE execution cancelled or timed out; effects may already be applied. Verify IDE state before retrying.':'IDE request cancelled or timed out'));};
      const timer=setTimeout(stop,action?180000:30000);
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
      signal.addEventListener('abort',stop,{once:true});this.pending.set(id,{resolve,reject,cleanup});
      this.emit({type:'ide_request',id,operation:name,args,...(expectedState?{expectedState}:{})});
    });
  }
  close():void{
    for(const [id,item] of this.pending){item.cleanup();this.emit({type:'ide_cancel',id});item.reject(new Error('IDE connection closed'));}this.pending.clear();
    for(const item of this.approvals.values()){item.cleanup();item.resolve(false);}this.approvals.clear();
    this.previews.clear();
    this.publishPreviews.clear();
  }
}
