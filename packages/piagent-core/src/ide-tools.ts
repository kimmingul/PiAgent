import {randomUUID} from 'node:crypto';
import {isObject} from '@piagent/protocol';
export const IDE_CAPABILITY='ide.tools.v1';
export const EDITOR_CAPABILITY='editor.suggestions.v1';
const string={type:'string',maxLength:4096};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]=[])=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false},loadMode:'essential'});
export const ideTools=[
  tool('ide_context','Read actual Visual Studio solution/project configuration and active unsaved editor text. Bounded snapshot; not a disk-file replacement.',{}),
  tool('ide_diagnostics','Read current Visual Studio Error List diagnostics with file, line, code and severity. May be stale until a build finishes.',{}),
  tool('ide_symbols','Use the IDE semantic workspace for C#/VB symbol search, definitions, references or callers. Unsupported languages return explicit availability; do not substitute text matches as semantic results.',{operation:{enum:['search','definition','references','callers']},query:string,file:string,line:{type:'integer',minimum:1},column:{type:'integer',minimum:1}},['operation']),
  tool('ide_build','Build or rebuild the current Visual Studio solution. Requires user approval; refuses unsaved buffers. Returns completion state and diagnostics.',{rebuild:{type:'boolean'}}),
  tool('ide_tests','Discover or run .NET tests in an existing solution project using dotnet test/VSTest and parse TRX results. Execution requires approval, including discovery because it can build. Does not claim Test Explorer state.',{project:string,operation:{enum:['discover','run']},filter:string},['project','operation']),
  tool('ide_debug','Read a bounded paused debugger stack/locals snapshot, or propose a breakpoint/start/continue/step/stop. Control and expression evaluation require approval. Evaluation can execute getters or functions.',{operation:{enum:['snapshot','breakpoint','start','continue','stepOver','stepInto','stepOut','stop','evaluate']},file:string,line:{type:'integer',minimum:1},expression:string},['operation']),
  tool('ide_profile','Capture a bounded .NET CPU trace for a process attached to this VS debugger and return top methods. Requires approval and installed dotnet-trace; native/.NET Framework processes are not promised.',{processId:{type:'integer',minimum:1},durationSeconds:{type:'integer',minimum:1,maximum:30}},['processId'])
];
type Pending={resolve:(v:Record<string,unknown>)=>void;reject:(e:Error)=>void;cleanup:()=>void};
/** Connection-local IDE request and consent broker. Never executes SDK calls in Core. */
export class IdeBridge {
  enabled=false;
  controlsEnabled=false;
  private pending=new Map<string,Pending>();
  private approvals=new Map<string,{resolve:(approved:boolean)=>void;cleanup:()=>void}>();
  constructor(private readonly emit:(frame:Record<string,unknown>)=>void){}
  get waiting():boolean{return this.approvals.size>0;}
  ownsApproval(id:unknown):boolean{return typeof id==='string'&&this.approvals.has(id);}
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
    const definition=ideTools.find(t=>t.name===name);if(!definition)throw new Error('Unknown IDE tool');
    const fields=definition.parameters.properties;
    if(Object.keys(args).some(k=>!(k in fields))||definition.parameters.required.some(k=>!(k in args)))throw new Error('Invalid IDE arguments');
    for(const [key,value] of Object.entries(args)){
      const schema=fields[key] as {type?:string;enum?:unknown[];minimum?:number;maximum?:number};
      if(schema.enum&&!schema.enum.includes(value)||schema.type==='string'&&(typeof value!=='string'||value.length>4096)||schema.type==='boolean'&&typeof value!=='boolean'||schema.type==='integer'&&(!Number.isSafeInteger(value)||Number(value)<(schema.minimum??0)||Number(value)>(schema.maximum??2147483647)))throw new Error('Invalid IDE arguments');
    }
    if(name==='ide_symbols'&&args['operation']!=='search'&&(!args['file']||!args['line']||!args['column']))throw new Error('Symbol position required');
    if(name==='ide_symbols'&&args['operation']==='search'&&!args['query'])throw new Error('Symbol query required');
    if(name==='ide_debug'&&args['operation']==='breakpoint'&&(!args['file']||!args['line'])||name==='ide_debug'&&args['operation']==='evaluate'&&!args['expression'])throw new Error('Debug arguments required');
    const action=name==='ide_build'||name==='ide_tests'||name==='ide_profile'||name==='ide_debug'&&args['operation']!=='snapshot';
    if(action){
      if(!this.controlsEnabled)throw new Error('IDE execution is disabled in plan/read-only mode');
      const id=randomUUID();
      const approved=await new Promise<boolean>(resolve=>{
        const stop=()=>{this.approvals.delete(id);cleanup();resolve(false);};
        const cleanup=()=>{signal.removeEventListener('abort',stop);};
        if(signal.aborted){resolve(false);return;}
        signal.addEventListener('abort',stop,{once:true});this.approvals.set(id,{resolve,cleanup});
        this.emit({type:'designer_approval',proposalId:id,path:'Visual Studio',reason:`${name}: ${String(args['operation']??'execute')}`,diff:JSON.stringify(args,null,2)});
      });
      this.emit({type:'designer_resolved',proposalId:id,approved});
      if(!approved||signal.aborted)return {executed:false,reason:'User declined or cancelled'};
    }
    if(signal.aborted)throw new Error('IDE request cancelled');
    if(this.pending.size>=4)throw new Error('Too many IDE requests');
    const id=randomUUID();
    return await new Promise((resolve,reject)=>{
      const stop=()=>{this.pending.delete(id);cleanup();this.emit({type:'ide_cancel',id});reject(new Error('IDE request cancelled or timed out'));};
      const timer=setTimeout(stop,action?180000:30000);
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
      signal.addEventListener('abort',stop,{once:true});this.pending.set(id,{resolve,reject,cleanup});
      this.emit({type:'ide_request',id,operation:name,args});
    });
  }
  close():void{
    for(const [id,item] of this.pending){item.cleanup();this.emit({type:'ide_cancel',id});item.reject(new Error('IDE connection closed'));}this.pending.clear();
    for(const item of this.approvals.values()){item.cleanup();item.resolve(false);}this.approvals.clear();
  }
}
