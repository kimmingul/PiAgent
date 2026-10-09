import {randomUUID} from 'node:crypto';
import {isObject} from '@piagent/protocol';
import {guiHarness} from './gui-harness.js';
export const DESIGNER_CAPABILITY='ide.designer.v1';
/** Host workflow guidance, selected only by negotiated capabilities, never IDE identity. */
export function designerPrompt(message:string,enabled:boolean,writesEnabled:boolean):string {
  // Native OMP slash commands must retain their original parsing and semantics.
  if(!enabled||message.trimStart().startsWith('/'))return message;
  return `PiAgent GUI development workflow:\nFor GUI app development or visual layout changes, use the IDE form designer by default. First call ide_designer_inspect on the target document, read the returned harness instructions/catalog, component hierarchy, references and supported operations, and prefer designer tools for supported visual changes. ${writesEnabled?'Use ide_designer_set_property for supported existing scalar properties, with explicit user approval. Use ide_designer_set_reference and ide_designer_reparent only when the live snapshot advertises them and permits the target. For component creation/deletion or event binding, use the advertised designer preview/apply tools and concrete approval; recovery needs a separate restore preview and approval.':'Designer access is read-only; do not attempt visual writes.'} Preserve the user\'s existing UI/UX unless explicitly asked to change it. Read hostAccess, writeBlockCode and writeBlockReason from the inspection result. Distinguish an OMP approval denial, plan/read-only host access, unsaved IDE changes and unsupported operations; report the actual reason and recovery action, never assume administrator privileges are required. Do not invent controls, properties or designer support. If the form is not open, ask the user to open it. For operations absent from the live catalog or supportedOperations, explain the limitation and use approved source edits only when necessary; then reopen/refresh the designer, inspect and build/run to verify. Never overwrite dirty IDE buffers or bypass approvals. Follow an explicit user request to use a different workflow. This guidance applies to GUI tasks; unrelated tasks do not require designer calls.\n\n${message}`;
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
export const designerExtendedTools=[{
  name:'ide_designer_preview_change',description:'Preview a supported designer component creation/deletion/event binding. Inspect first; only live advertised operations and creatable types are accepted. Returns a concrete review token without applying.',
  parameters:{type:'object',properties:{changeOperation:{enum:['createComponent','deleteComponent','bindEvent']},type:{type:'string'},name:{type:'string'},parent:{type:'string'},x:{type:'integer',minimum:-32768,maximum:32767},y:{type:'integer',minimum:-32768,maximum:32767},width:{type:'integer',minimum:1,maximum:32767},height:{type:'integer',minimum:1,maximum:32767},component:{type:'string'},property:{type:'string'},eventMethod:{type:'string'},create:{type:'boolean'}},required:['changeOperation'],additionalProperties:false}
},{
  name:'ide_designer_apply_change',description:'Apply an unchanged cached designer preview after explicit approval of its concrete diff. The adapter revalidates all source/form state and records supported recovery.',
  parameters:{type:'object',properties:{proposalId:{type:'string'},revision:{type:'string'}},required:['proposalId','revision'],additionalProperties:false}
},{
  name:'ide_designer_preview_restore',description:'Preview restoration of an owned designer checkpoint. Later user changes and unsaved buffers must not be overwritten.',
  parameters:{type:'object',properties:{checkpointId:{type:'string'}},required:['checkpointId'],additionalProperties:false}
},{
  name:'ide_designer_restore_change',description:'Restore a reviewed designer checkpoint after separate approval and exact current-state validation. This is distinct from chat history restore.',
  parameters:{type:'object',properties:{proposalId:{type:'string'},revision:{type:'string'}},required:['proposalId','revision'],additionalProperties:false}
}];
type DesignerPreview={proposalId:string;document:string;revision:string;inspectedRevision:string;diff:string;expiresAt:number;operation:string;kind:'change'|'restore';checkpointId?:string};
type Pending={resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void;cleanup:()=>void};
/** SDK-free request broker; the adapter alone discovers and manipulates its designer. */
export class DesignerBridge {
  get waiting(): boolean { return this.approvals.size > 0; }
  enabled=false;
  writesEnabled=false;
  cancellationEnabled=false;
  extendedEnabled=false;
  private previews=new Map<string,DesignerPreview>();
  writeBlockReason='Designer writes are disabled on this connection; check the session access mode and negotiated workspace writes.';
  private pending=new Map<string,Pending>();
  private approvals=new Map<string,{resolve:(value:boolean)=>void;cleanup:()=>void}>();
  constructor(private readonly emit:(frame:Record<string,unknown>)=>void,private readonly extendedAvailable:(name:string)=>boolean=()=>true) {}
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
      const stop=():void=>{this.pending.delete(id);cleanup();if(this.cancellationEnabled)this.emit({type:'designer_cancel',id});reject(new Error(['applyChange','restoreChange','setProperty','setReference','reparent'].includes(operation)?'Designer execution cancelled or timed out; effects may already be applied. Verify state before retrying.':'Designer request cancelled or timed out'));};
      const timer=setTimeout(stop,30000);
      const cleanup=():void=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
      signal.addEventListener('abort',stop,{once:true});this.pending.set(id,{resolve,reject,cleanup});
      this.emit({type:'designer_request',id,operation,args});
    });
  }
  async execute(name:string,args:unknown,signal:AbortSignal):Promise<Record<string,unknown>> {
    if(!this.enabled||!isObject(args))throw new Error('Designer adapter unavailable');
    if(designerExtendedTools.some(t=>t.name===name))return await this.executeExtended(name,args,signal);
    if(name==='ide_designer_inspect') {
      if(Object.keys(args).length)throw new Error('Invalid inspect arguments');
      const snapshot=await this.request('inspect',{},signal);
      const harness=await guiHarness(snapshot);
      return {...snapshot,hostAccess:{canWrite:this.writesEnabled,...(!this.writesEnabled?{reason:this.writeBlockReason}:{})},...(harness?{harness}:{})};
    }
    const operation=name==='ide_designer_set_property'?'setProperty':name==='ide_designer_set_reference'?'setReference':name==='ide_designer_reparent'?'reparent':undefined;
    const fields=operation==='setProperty'?['component','property','value']:operation==='setReference'?['component','property','target']:['component','parent'];
    if(!operation||Object.keys(args).some(k=>!fields.includes(k))||!fields.every(k=>typeof args[k]==='string'&&String(args[k]).length<=4096))throw new Error('Invalid designer request');
    if(!this.writesEnabled)throw new Error(this.writeBlockReason);
    const snapshot=await this.request('inspect',{},signal);
    if(snapshot['canSetProperty']!==true)throw new Error(typeof snapshot['writeBlockReason']==='string'?snapshot['writeBlockReason'].slice(0,2048):'This designer does not expose property edits; inspect its supported operations and save any unsaved IDE changes first');
    if(typeof snapshot['revision']!=='string'||typeof snapshot['document']!=='string')throw new Error('Invalid designer snapshot: document/revision missing');
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
  private async executeExtended(name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>{
    if(!this.extendedEnabled)throw new Error('Designer preview/recovery was not negotiated');
    if(!this.extendedAvailable(name))throw new Error('Designer operation is not advertised');
    const definition=designerExtendedTools.find(t=>t.name===name)!;
    const fields=definition.parameters.properties as Record<string,{type?:string;enum?:string[];minimum?:number;maximum?:number}>;
    if(Object.keys(args).some(k=>!Object.hasOwn(fields,k))||definition.parameters.required.some(k=>!Object.hasOwn(args,k)))throw new Error('Invalid designer change arguments');
    for(const [key,value] of Object.entries(args)){
      const schema=fields[key]!;
      if(schema.enum&&!schema.enum.includes(String(value))||schema.type==='string'&&(typeof value!=='string'||!value||Buffer.byteLength(value)>4096)||schema.type==='boolean'&&typeof value!=='boolean'||schema.type==='integer'&&(!Number.isSafeInteger(value)||Number(value)<schema.minimum!||Number(value)>schema.maximum!))throw new Error('Invalid designer change argument');
    }
    const snapshot=await this.request('inspect',{},signal);
    if(typeof snapshot['document']!=='string'||typeof snapshot['revision']!=='string'||!Array.isArray(snapshot['supportedOperations']))throw new Error('Designer has no verified change/recovery contract');
    const supported=snapshot['supportedOperations'] as unknown[];
    if(name==='ide_designer_preview_change'){
      const operation=String(args['changeOperation']);
      if(!supported.includes(operation)||!supported.includes('previewChange')||!supported.includes('applyChange'))throw new Error('Designer operation is unsupported');
      if(operation==='createComponent'){
        if(typeof args['type']!=='string'||!Array.isArray(snapshot['creatableTypes'])||!snapshot['creatableTypes'].includes(args['type']))throw new Error('Designer component type is not advertised');
      }else{
        if(!Array.isArray(snapshot['components'])||!snapshot['components'].some(c=>isObject(c)&&c['id']===args['component']))throw new Error('Designer component is unavailable');
        if(operation==='bindEvent'&&(!args['property']||!args['eventMethod']))throw new Error('Event property and method required');
      }
      const result=await this.request('previewChange',{...args,document:snapshot['document'],revision:snapshot['revision']},signal);
      this.cacheExtended(result,snapshot,'change',operation);return result;
    }
    if(name==='ide_designer_preview_restore'){
      if(!supported.includes('previewRestoreChange')||!supported.includes('restoreChange'))throw new Error('Designer restoration is unsupported');
      const result=await this.request('previewRestoreChange',{checkpointId:args['checkpointId'],document:snapshot['document'],revision:snapshot['revision']},signal);
      this.cacheExtended({...result,checkpointId:args['checkpointId']},snapshot,'restore','restoreChange');return result;
    }
    if(!this.writesEnabled)throw new Error(this.writeBlockReason);
    const item=this.previews.get(String(args['proposalId'])),restoring=name==='ide_designer_restore_change';
    if(!item||item.kind!==(restoring?'restore':'change')||item.revision!==args['revision']||item.expiresAt<=Date.now()||snapshot['document']!==item.document||snapshot['revision']!==item.inspectedRevision)throw new Error('Designer preview expired or state changed');
    const operation=restoring?'restoreChange':'applyChange';if(!supported.includes(operation)||!restoring&&!supported.includes(item.operation))throw new Error('Designer operation is no longer supported');
    const consentId=randomUUID();
    const approved=await new Promise<boolean>(resolve=>{
      const stop=()=>{this.approvals.delete(consentId);cleanup();resolve(false);};
      const timer=setTimeout(stop,Math.max(0,Math.min(300000,item.expiresAt-Date.now())));
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
      if(signal.aborted){cleanup();resolve(false);return;}
      signal.addEventListener('abort',stop,{once:true});this.approvals.set(consentId,{resolve,cleanup});
      this.emit({type:'designer_approval',proposalId:consentId,path:item.document,reason:item.operation,diff:item.diff,expiresAt:item.expiresAt});
    });
    if(!approved||signal.aborted){this.emit({type:'designer_resolved',proposalId:consentId,approved:false});return {applied:false,cancellation:'before_execution',reason:'Declined, expired or cancelled'};}
    this.previews.delete(item.proposalId);
    try{
      const current=await this.request('inspect',{},signal);
      if(item.expiresAt<=Date.now()||current['document']!==item.document||current['revision']!==item.inspectedRevision)throw new Error('Designer changed during approval; preview again');
      if(!this.extendedAvailable(name)||!Array.isArray(current['supportedOperations'])||!current['supportedOperations'].includes(operation)||!restoring&&!current['supportedOperations'].includes(item.operation))throw new Error('Designer operation is no longer supported');
      const result=await this.request(operation,{document:item.document,revision:item.revision,proposalId:item.proposalId,...(restoring?{checkpointId:item.checkpointId}:{})},signal);
      this.emit({type:'designer_resolved',proposalId:consentId,approved:true});return result;
    }catch(error){this.emit({type:'designer_resolved',proposalId:consentId,approved:false});throw error;}
  }
  private cacheExtended(result:Record<string,unknown>,snapshot:Record<string,unknown>,kind:'change'|'restore',operation:string):void{
    const recovery=result['recovery'];
    if(typeof result['proposalId']!=='string'||!result['proposalId']||result['proposalId'].length>128||result['document']!==snapshot['document']||typeof result['revision']!=='string'||!result['revision']||result['revision'].length>256||typeof result['diff']!=='string'||!result['diff'].trim()||Buffer.byteLength(result['diff'])>131072||!Number.isSafeInteger(result['expiresAt'])||Number(result['expiresAt'])<=Date.now()||Number(result['expiresAt'])>Date.now()+300000||!isObject(recovery)||recovery['supported']!==true||recovery['scope']!=='source_and_form')throw new Error('Designer preview has no valid concrete recovery contract');
    for(const [id,item] of this.previews)if(item.expiresAt<=Date.now())this.previews.delete(id);
    if(this.previews.size>=8)this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(result['proposalId'],{proposalId:result['proposalId'],document:String(result['document']),revision:result['revision'],inspectedRevision:String(snapshot['revision']),diff:result['diff'],expiresAt:Number(result['expiresAt']),operation,kind,...(kind==='restore'?{checkpointId:String(result['checkpointId'])}:{})});
  }
  close():void {
    for(const [id,item] of this.pending){item.cleanup();if(this.cancellationEnabled)this.emit({type:'designer_cancel',id});item.reject(new Error('Designer connection closed'));}this.pending.clear();
    for(const item of this.approvals.values()){item.cleanup();item.resolve(false);}this.approvals.clear();
    this.previews.clear();
  }
}
