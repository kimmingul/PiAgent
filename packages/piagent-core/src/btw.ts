import {randomUUID} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,rename,readdir,copyFile,realpath,rm} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {OmpProcess,type OmpOptions} from '@piagent/omp';
import {isObject} from '@piagent/protocol';

export const BTW_CAPABILITY='chat.btw.v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
interface Turn {q:string;a:string;state:'running'|'done'|'stopped'|'error';asked:string;error?:string;}
interface Accounting {cost:number|null;tokens:number|null;}
const amount=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
interface Topic {id:string;mainSession:string;mainTitle:string;created:string;turns:Turn[];sessionFile?:string;baseline?:Accounting;usage?:Accounting;}
interface Active {omp:OmpProcess;topic:Topic;turn:Turn;timer:NodeJS.Timeout;done:Promise<void>;finish:(state:Turn['state'],error?:string)=>void;}
/** Project-private, tool-free side conversations; never sends questions to the main child. */
export class BtwService {
  private readonly active=new Map<string,Active>();
  private tail:Promise<unknown>=Promise.resolve();
  private admission:Promise<unknown>=Promise.resolve();
  private closing=false;
  private readonly updates=new Map<string,NodeJS.Timeout>();
  constructor(private readonly root:string,private readonly options:OmpOptions,private readonly send:(event:Record<string,unknown>)=>void) {}
  private async directory():Promise<void>{await mkdir(this.root,{recursive:true});const stat=await lstat(this.root);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(this.root)!==this.root)throw new Error('Invalid BTW directory');}
  private file(id:unknown):string{if(typeof id!=='string'||!uuid.test(id))throw new Error('Invalid BTW topic');return join(this.root,id+'.json');}
  private async load(id:unknown):Promise<Topic>{const path=this.file(id),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024)throw new Error('Invalid BTW topic');const value:unknown=JSON.parse(await readFile(path,'utf8'));if(!isObject(value)||value['id']!==id||!Array.isArray(value['turns'])||value['turns'].length>32||value['turns'].some(turn=>!isObject(turn)||typeof turn['q']!=='string'||typeof turn['a']!=='string'||!['running','done','stopped','error'].includes(String(turn['state']))))throw new Error('Invalid BTW topic');const topic=value as unknown as Topic;for(const turn of topic.turns)if(turn.state==='running')turn.state='stopped';return topic;}
  private save(topic:Topic):Promise<void>{const next=this.tail.then(async()=>{const temp=join(this.root,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(topic),{flag:'wx',mode:0o600});await rename(temp,this.file(topic.id));});this.tail=next.catch(()=>{});return next;}
  private update(topic:Topic):void{const {sessionFile:_,baseline:_baseline,...publicTopic}=topic;this.send({t:'btw',topic:publicTopic,turn:topic.turns.length-1});}
  async list(mainSession:string,offset=0):Promise<Record<string,unknown>>{if(!Number.isSafeInteger(offset)||offset<0||offset>500)throw new Error('Invalid BTW cursor');await this.directory();const names=(await readdir(this.root)).filter(name=>name.endsWith('.json')&&uuid.test(name.slice(0,-5)));if(names.length>500)throw new Error('BTW topic limit reached');const items=[];let bytes=0;for(const name of names.sort().slice(offset)){if(items.length>=50)break;const topic=this.active.get(name.slice(0,-5))?.topic??await this.load(name.slice(0,-5));const {sessionFile:_,baseline:_baseline,...publicTopic}=topic;const size=Buffer.byteLength(JSON.stringify(publicTopic));if(bytes+size>800000)break;bytes+=size;items.push(publicTopic);}return {t:'btwList',session:mainSession,items,append:offset>0,...(offset+items.length<names.length?{nextOffset:offset+items.length}:{})};}
  ask(text:unknown,id:unknown,mainSession:string,title:string,mainFile?:string,model?:{provider:string;id:string;thinking?:string}):Promise<Record<string,unknown>> {
    const operation=this.admission.then(()=>this.start(text,id,mainSession,title,mainFile,model));this.admission=operation.catch(()=>{});return operation;
  }
  private async start(text:unknown,id:unknown,mainSession:string,title:string,mainFile?:string,model?:{provider:string;id:string;thinking?:string}):Promise<Record<string,unknown>> {
    if(this.closing)throw new Error('BTW service is closing');
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>65536)throw new Error('Expected a side question up to 64 KiB');
    await this.directory();if(this.active.size>=2)throw new Error('At most two side questions may run');
    let topic:Topic;
    if(id!==undefined){if(this.active.has(String(id)))throw new Error('Topic is busy');topic=await this.load(id);}
    else {if((await readdir(this.root)).filter(name=>name.endsWith('.json')).length>=500)throw new Error('BTW topic limit reached');topic={id:randomUUID(),mainSession,mainTitle:title,created:new Date().toLocaleString(),turns:[]};}
    if(topic.turns.length>=32)throw new Error('Topic turn limit reached');
    const dir=join(this.root,topic.id);await mkdir(dir,{recursive:true});if((await lstat(dir)).isSymbolicLink()||await realpath(dir)!==dir)throw new Error('Invalid BTW process directory');
    const args=['--no-tools','--no-skills','--no-extensions','--no-rules','--no-lsp','--no-title','--no-pty','--session-dir',dir];
    if(topic.sessionFile){await this.verifySession(dir,topic.sessionFile);args.push('--resume',topic.sessionFile);}
    else if(mainFile){const snapshot=join(dir,'context.snapshot.jsonl');await copyFile(mainFile,snapshot);args.push('--fork',snapshot);}
    const omp=new OmpProcess({...this.options,profile:'restricted',executableArgs:[...this.options.executableArgs??[],...args]});
    const turn:Turn={q:text.trim(),a:'',state:'running',asked:new Date().toLocaleString()};topic.turns.push(turn);
    if(Buffer.byteLength(JSON.stringify(topic))>240000)throw new Error('Topic history exceeds limit. Start a new side topic');
    let complete!:()=>void;const done=new Promise<void>(resolve=>{complete=resolve;});let ended=false;
    const finish=(state:Turn['state'],error?:string):void=>{if(ended)return;ended=true;turn.state=state;if(error)turn.error=error.slice(0,2048);clearTimeout(active.timer);clearTimeout(this.updates.get(topic.id));this.updates.delete(topic.id);this.update(topic);void (async()=>{if(omp.state==='ready')try{const stats=await this.accounting(omp),base=topic.baseline;const delta=(a:number|null,b:number|null):number|null=>a!==null&&b!==null&&a>=b?a-b:null;topic.usage={cost:delta(stats.cost,base?.cost??null),tokens:delta(stats.tokens,base?.tokens??null)};}catch{topic.usage={cost:null,tokens:null};}await this.save(topic);})().catch(error=>{turn.state='error';turn.error='Side history could not be saved: '+String(error instanceof Error?error.message:error).slice(0,1024);this.update(topic);}).finally(async()=>{await omp.stop();this.active.delete(topic.id);complete();}).catch(()=>{});};
    const active:Active={omp,topic,turn,done,finish,timer:setTimeout(()=>finish('error','Side question timed out'),300000)};this.active.set(topic.id,active);
    omp.on('frame',(frame:Record<string,unknown>)=>{if(ended)return;const stream=frame['assistantMessageEvent'];if(frame['type']==='message_update'&&isObject(stream)&&stream['type']==='text_delta'&&typeof stream['delta']==='string'){const delta=stream['delta'];if(Buffer.byteLength(JSON.stringify(topic))+Buffer.byteLength(delta)>480000){finish('error','Side answer exceeds display limit');return;}turn.a+=delta;if(!this.updates.has(topic.id))this.updates.set(topic.id,setTimeout(()=>{this.updates.delete(topic.id);if(!ended)this.update(topic);},100));}if(frame['type']==='extension_ui_request'){void omp.uiResponse(String(frame['id']),{cancelled:true}).catch(()=>{});}if(frame['type']==='host_tool_call'){void omp.hostToolResult(String(frame['id']),'Tools are unavailable in BTW',true).catch(()=>{});}if(frame['type']==='message_end'&&isObject(frame['message'])&&frame['message']['stopReason']==='error')finish('error',String(frame['message']['errorMessage']??'Side question failed'));if(frame['type']==='agent_end'&&frame['isTerminal']!==false||frame['type']==='session_settled'||frame['type']==='prompt_result'&&frame['sessionSettled']!==false)finish(frame['status']==='error'?'error':'done');});
    omp.on('exit',()=>finish('error','Side question process disconnected'));omp.on('diagnostic',(error:Error)=>finish('error',error.message));
    try {await this.save(topic);await omp.start();const state=await omp.request('get_state');if(isObject(state['data'])&&typeof state['data']['sessionFile']==='string'){await this.verifySession(dir,state['data']['sessionFile']);topic.sessionFile=state['data']['sessionFile'];}
      if(!topic.baseline)topic.baseline=await this.accounting(omp).catch(()=>({cost:null,tokens:null}));
      if(model){await omp.request('set_model',{provider:model.provider,modelId:model.id});if(model.thinking)await omp.request('set_thinking_level',{level:model.thinking});}
      this.update(topic);await omp.request('prompt',{message:'This is a separate side question. Answer only this question using the conversation as context. Do not continue the main task or claim tools, file changes or actions.\n\n'+turn.q});return {accepted:true,topicId:topic.id};
    }catch(error){finish('error',error instanceof Error?error.message:'BTW failed');await done;throw error;}
  }
  private async accounting(omp:OmpProcess):Promise<Accounting>{const response=await omp.request('get_session_stats'),data=isObject(response['data'])?response['data']:{},tokens=isObject(data['tokens'])?data['tokens']:{};return {cost:amount(data['cost']),tokens:amount(tokens['total'])};}
  async usage(mainSession:string):Promise<Record<string,unknown>>{await this.directory();const topics:Topic[]=[];for(const name of (await readdir(this.root)).filter(name=>name.endsWith('.json')&&uuid.test(name.slice(0,-5))).slice(0,500)){const topic=this.active.get(name.slice(0,-5))?.topic??await this.load(name.slice(0,-5));if(topic.mainSession===mainSession)topics.push(topic);}const sum=(key:keyof Accounting):number|null=>topics.every(topic=>!this.active.has(topic.id)&&amount(topic.usage?.[key])!==null)?topics.reduce((total,topic)=>total+topic.usage![key]!,0):null;return {scope:'retained-side-topics',topics:topics.length,cost:sum('cost'),tokens:sum('tokens'),running:topics.filter(topic=>this.active.has(topic.id)).length};}
  private async verifySession(dir:string,path:string):Promise<void>{const rel=relative(dir,path),stat=await lstat(path);if(isAbsolute(rel)||rel.startsWith('..')||dirname(path)!==dir||!path.endsWith('.jsonl')||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>64*1024*1024||await realpath(path)!==path)throw new Error('BTW session escaped private directory');}
  async cancel(id:unknown):Promise<Record<string,unknown>>{this.file(id);const item=this.active.get(String(id));if(item){item.finish('stopped');await item.done;}return {stopped:true};}
  async delete(id:unknown):Promise<void>{await this.cancel(id);const {unlink}=await import('node:fs/promises');await this.load(id);const dir=join(this.root,String(id));try{const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(dir)!==dir||dirname(dir)!==this.root)throw new Error('Invalid BTW process directory');await rm(dir,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await unlink(this.file(id));}
  async close():Promise<void>{this.closing=true;await this.admission;await Promise.all([...this.active.keys()].map(id=>this.cancel(id)));}
}
