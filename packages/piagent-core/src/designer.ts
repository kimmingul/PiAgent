import {randomUUID} from 'node:crypto';
import {isObject} from '@piagent/protocol';
import {guiHarness} from './gui-harness.js';
export const DESIGNER_CAPABILITY='ide.designer.v1';
/** Host workflow guidance, selected only by negotiated capabilities, never IDE identity. */
export function designerPrompt(message:string,enabled:boolean,writesEnabled:boolean):string {
  // Native OMP slash commands must retain their original parsing and semantics.
  if(!enabled||message.trimStart().startsWith('/'))return message;
  return `PiAgent GUI development workflow:\nFor GUI app development or visual layout changes, use the IDE form designer by default. First call ide_designer_inspect on the target document, read the returned harness instructions/catalog, component hierarchy, references and supported operations, and prefer designer tools for supported visual changes. ${writesEnabled?'Use ide_designer_set_property for supported existing scalar properties, with explicit user approval. Use ide_designer_set_reference and ide_designer_reparent only when the live snapshot advertises them and permits the target.':'Designer access is read-only; do not attempt visual writes.'} Preserve the user\'s existing UI/UX unless explicitly asked to change it. Do not invent controls, properties or designer support. If the form is not open, ask the user to open it. For unsupported operations (including adding controls or event handlers), explain the limitation and use approved source edits only when necessary; then reopen/refresh the designer, inspect and build/run to verify. Never overwrite dirty IDE buffers or bypass approvals. Follow an explicit user request to use a different workflow. This guidance applies to GUI tasks; unrelated tasks do not require designer calls.\n\n${message}`;
}
export const designerTools=[{
  name:'ide_designer_inspect',description:'Inspect the active IDE form/XAML document, component tree, current properties and supported designer operations. Use before UI edits. Unsupported frameworks are reported, never guessed.',
  parameters:{type:'object',properties:{},additionalProperties:false}
},{
  name:'ide_designer_set_property',description:'Propose one visual property change using the active IDE designer. The host checks document revision and asks the user before changing anything. Inspect first; use the returned component ID and writable property name.',
  parameters:{type:'object',properties:{component:{type:'string'},property:{type:'string'},value:{type:'string'}},required:['component','property','value'],additionalProperties:false}
},{
  name:'ide_designer_set_reference',description:'Connect an existing component reference such as Action or Menu, with user approval. Inspect first; use only reference names and allowedTargets returned by the live adapter. Empty target disconnects only when explicitly allowed.',
  parameters:{type:'object',properties:{component:{type:'string'},property:{type:'string'},target:{type:'string'}},required:['component','property','target'],additionalProperties:false}
},{
  name:'ide_designer_reparent',description:'Move an existing component to an allowed designer parent with user approval. Inspect first; select an allowedParentIds entry. Parentage is distinct from lifetime ownership; this tool does not create controls.',
  parameters:{type:'object',properties:{component:{type:'string'},parent:{type:'string'}},required:['component','parent'],additionalProperties:false}
}];
type Pending={resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void;cleanup:()=>void};
/** SDK-free request broker; the adapter alone discovers and manipulates its designer. */
export class DesignerBridge {
  get waiting(): boolean { return this.approvals.size > 0; }
  enabled=false;
  writesEnabled=false;
  private pending=new Map<string,Pending>();
  private approvals=new Map<string,{resolve:(value:boolean)=>void;cleanup:()=>void}>();
  constructor(private readonly emit:(frame:Record<string,unknown>)=>void) {}
  reply(id:unknown,result:unknown,error:unknown):{accepted:true} {
    if(typeof id!=='string'||!this.pending.has(id))throw new Error('Designer request expired');
    const pending=this.pending.get(id)!;this.pending.delete(id);pending.cleanup();
    if(typeof error==='string')pending.reject(new Error(error.slice(0,2048)));
    else if(isObject(result)&&Buffer.byteLength(JSON.stringify(result))<=240*1024)pending.resolve(result);
    else pending.reject(new Error('Invalid designer result'));
    return {accepted:true};
  }
  decide(id:unknown,approved:unknown):{accepted:true} {
    if(typeof id!=='string'||typeof approved!=='boolean'||!this.approvals.has(id))throw new Error('Designer approval expired');
    const pending=this.approvals.get(id)!;this.approvals.delete(id);pending.cleanup();pending.resolve(approved);return {accepted:true};
  }
  private request(operation:string,args:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>> {
    if(signal.aborted)return Promise.reject(new Error('Designer operation cancelled'));
    if(this.pending.size>=4)return Promise.reject(new Error('Too many designer operations'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const stop=():void=>{this.pending.delete(id);cleanup();reject(new Error('Designer request cancelled or timed out'));};
      const timer=setTimeout(stop,30000);
      const cleanup=():void=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
      signal.addEventListener('abort',stop,{once:true});this.pending.set(id,{resolve,reject,cleanup});
      this.emit({type:'designer_request',id,operation,args});
    });
  }
  async execute(name:string,args:unknown,signal:AbortSignal):Promise<Record<string,unknown>> {
    if(!this.enabled||!isObject(args))throw new Error('Designer adapter unavailable');
    if(name==='ide_designer_inspect') {
      if(Object.keys(args).length)throw new Error('Invalid inspect arguments');
      const snapshot=await this.request('inspect',{},signal);
      const harness=await guiHarness(snapshot);
      return {...snapshot,...(harness?{harness}:{})};
    }
    const operation=name==='ide_designer_set_property'?'setProperty':name==='ide_designer_set_reference'?'setReference':name==='ide_designer_reparent'?'reparent':undefined;
    const fields=operation==='setProperty'?['component','property','value']:operation==='setReference'?['component','property','target']:['component','parent'];
    if(!operation||Object.keys(args).some(k=>!fields.includes(k))||!fields.every(k=>typeof args[k]==='string'&&String(args[k]).length<=4096))throw new Error('Invalid designer request');
    if(!this.writesEnabled)throw new Error('Designer writes are disabled');
    const snapshot=await this.request('inspect',{},signal);
    if(snapshot['canSetProperty']!==true||typeof snapshot['revision']!=='string'||typeof snapshot['document']!=='string')throw new Error('This designer does not expose property edits');
    const component=Array.isArray(snapshot['components'])?snapshot['components'].filter(isObject).find(c=>c['id']===args['component']):undefined;
    if(!component)throw new Error('Component is not available in this designer');
    let reason:string,diff:string;
    if(operation==='setProperty') {
      const property=Array.isArray(component['properties'])?component['properties'].filter(isObject).find(p=>p['name']===args['property']&&p['writable']===true):undefined;
      if(!property)throw new Error('Component/property is not writable in this designer');
      reason=`${String(args['component'])}.${String(args['property'])}`;diff=`-${String(property['value'])}\n+${String(args['value'])}`;
    } else {
      if(snapshot['schemaVersion']!==2||!Array.isArray(snapshot['supportedOperations'])||!snapshot['supportedOperations'].includes(operation))throw new Error('Designer operation is unsupported');
      if(operation==='setReference') {
        const reference=Array.isArray(component['references'])?component['references'].filter(isObject).find(p=>p['name']===args['property']&&p['writable']===true):undefined;
        if(!reference||!Array.isArray(reference['allowedTargets'])||!reference['allowedTargets'].includes(args['target']))throw new Error('Component reference target is not allowed');
        reason=`${String(args['component'])}.${String(args['property'])} (reference setters may synchronize related properties)`;diff=`-${String(reference['target'])}\n+${String(args['target'])}`;
      } else {
        if(!Array.isArray(component['allowedParentIds'])||!component['allowedParentIds'].includes(args['parent']))throw new Error('Designer parent is not allowed');
        reason=`${String(args['component'])} parent`;diff=`-${String(component['parentId'])}\n+${String(args['parent'])}`;
      }
    }
    const proposalId=randomUUID();
    const approved=await new Promise<boolean>(resolve=>{
      const stop=():void=>{this.approvals.delete(proposalId);cleanup();resolve(false);};
      const timer=setTimeout(stop,300000);
      const cleanup=():void=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
      if(signal.aborted){clearTimeout(timer);resolve(false);return;}
      signal.addEventListener('abort',stop,{once:true});this.approvals.set(proposalId,{resolve,cleanup});
      this.emit({type:'designer_approval',proposalId,path:snapshot['document'],reason,diff});
    });
    if(!approved||signal.aborted){this.emit({type:'designer_resolved',proposalId,approved:false});return {applied:false,reason:'User declined or cancelled'};}
    try {
      const result=await this.request(operation,{...args,document:snapshot['document'],revision:snapshot['revision']},signal);
      this.emit({type:'designer_resolved',proposalId,approved:true});return result;
    } catch(error){this.emit({type:'designer_resolved',proposalId,approved:false});throw error;}
  }
  close():void {
    for(const item of this.pending.values()){item.cleanup();item.reject(new Error('Designer connection closed'));}this.pending.clear();
    for(const item of this.approvals.values()){item.cleanup();item.resolve(false);}this.approvals.clear();
  }
}
