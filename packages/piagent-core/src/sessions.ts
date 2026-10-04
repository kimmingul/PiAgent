import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isObject } from '@piagent/protocol';

export const SESSION_CAPABILITY = 'chat.sessions.v1';
export const USAGE_CAPABILITY = 'chat.usage.v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonical=(path:string):string=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
export interface TranscriptLine { role: 'user'|'assistant'|'status'|'event'; text: string; seq?:number; ts?:number;started?:number;ended?:number;stopped?:boolean;event?:Record<string,unknown>;attachments?:string[]; }
export interface SavedSession {
  version: 1|2; savedSessionId: string; title: string; createdAt: number; updatedAt: number;
  ompFile?: string; approvalMode?:string; transcript: TranscriptLine[];
  plan?:{path:string;hash:string};
  needsFork?:boolean;
  messagePoints?:{seq:number;id:string}[];
  parent?:{savedSessionId:string;message:number;mode:'branch'|'restore'};
}
/** Storage is scoped by the daemon to one workspace and private credential directory. */
export class SessionStore {
  constructor(readonly root: string) {}
  async initialize(): Promise<void> {
    await mkdir(this.root, {recursive:true});
    await this.directory(this.root);
  }
  private async directory(path: string): Promise<void> {
    const value=await lstat(path);
    if (!value.isDirectory() || value.isSymbolicLink() || canonical(await realpath(path))!==canonical(path)) throw new Error('Session directory links are forbidden');
  }
  private path(id: unknown): string {
    if (typeof id!=='string' || !uuid.test(id)) throw new Error('Invalid saved session ID');
    return join(this.root,id);
  }
  async load(id: unknown): Promise<SavedSession> {
    const dir=this.path(id); await this.directory(dir);
    const file=join(dir,'session.json'), stat=await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size>3*1024*1024) throw new Error('Invalid saved session');
    const value:unknown=JSON.parse(await readFile(file,'utf8'));
    if (!isObject(value) || ![1,2].includes(Number(value['version'])) || value['savedSessionId']!==id || typeof value['title']!=='string'
      || typeof value['createdAt']!=='number' || typeof value['updatedAt']!=='number' || !Array.isArray(value['transcript'])
      || value['transcript'].length>200 || value['transcript'].some(line=>!isObject(line)||!['user','assistant','status','event'].includes(String(line['role']))||typeof line['text']!=='string')) throw new Error('Invalid saved session');
    if(value['approvalMode']!==undefined&&!['always-ask','write','yolo','plan'].includes(String(value['approvalMode'])))throw new Error('Invalid approval mode');
    if(value['plan']!==undefined&&(!isObject(value['plan'])||!/^docs\/plans\/piagent-[0-9a-f-]{36}\.md$/.test(String(value['plan']['path']))||!/^[0-9a-f]{64}$/.test(String(value['plan']['hash']))))throw new Error('Invalid saved plan');
    if(value['messagePoints']!==undefined&&(!Array.isArray(value['messagePoints'])||value['messagePoints'].length>50||value['messagePoints'].some(point=>!isObject(point)||!Number.isSafeInteger(point['seq'])||Number(point['seq'])<1||typeof point['id']!=='string'||!uuid.test(point['id']))))throw new Error('Invalid message checkpoints');
    if(value['needsFork']!==undefined&&typeof value['needsFork']!=='boolean')throw new Error('Invalid pending fork');
    if(value['parent']!==undefined&&(!isObject(value['parent'])||typeof value['parent']['savedSessionId']!=='string'||!uuid.test(value['parent']['savedSessionId'])||!Number.isSafeInteger(value['parent']['message'])||Number(value['parent']['message'])<1||!['branch','restore'].includes(String(value['parent']['mode']))))throw new Error('Invalid conversation parent');
    if(value['transcript'].some(line=>isObject(line)&&line['seq']!==undefined&&(!Number.isSafeInteger(line['seq'])||Number(line['seq'])<1)))throw new Error('Invalid message sequence');
    if (value['ompFile']!==undefined) await this.verifyOmpFile(String(id),value['ompFile']);
    return value as unknown as SavedSession;
  }
  async list(): Promise<Record<string,unknown>[]> {
    const names=(await readdir(this.root)).filter(name=>uuid.test(name));
    if (names.length>1000) throw new Error('Saved session limit reached');
    const values=await Promise.all(names.map(async name=>{ try{return await this.load(name);}catch{return undefined;} }));
    return values.filter((value):value is SavedSession=>!!value).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,50)
      .map(({savedSessionId,title,updatedAt,createdAt,ompFile})=>({savedSessionId,title,updatedAt,createdAt,resumable:!!ompFile}));
  }
  async acquire(id?: unknown): Promise<SessionLease> {
    let record:SavedSession;
    if (id!==undefined) record=await this.load(id);
    else {
      if ((await readdir(this.root)).filter(name=>uuid.test(name)).length>=1000) throw new Error('Saved session limit reached');
      record={version:2,savedSessionId:randomUUID(),title:'New conversation',createdAt:Date.now(),updatedAt:Date.now(),transcript:[]};
      await mkdir(this.path(record.savedSessionId));
    }
    const dir=this.path(record.savedSessionId); await this.directory(dir);
    let lock:FileHandle;
    try {lock=await open(join(dir,'active.lock'),'wx');}
    catch {throw new Error('Saved session is already active or needs interrupted-session inspection');}
    const lease=new SessionLease(this,record,lock);
    try {await lease.save(); return lease;} catch(error){await lease.release();throw error;}
  }
  ompDirectory(id:string):string {return join(this.path(id),'omp');}
  async prepareOmpDirectory(id:string):Promise<string> {
    await this.directory(this.path(id));
    const dir=this.ompDirectory(id);await mkdir(dir,{recursive:true});await this.directory(dir);return dir;
  }
  async verifyOmpFile(id:string,value:unknown):Promise<string> {
    if (typeof value!=='string' || basename(value)!==value || !value.endsWith('.jsonl')) throw new Error('Invalid OMP session file');
    const dir=this.ompDirectory(id);await this.directory(dir);
    const file=join(dir,value),stat=await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size>64*1024*1024 || canonical(await realpath(file))!==canonical(file)) throw new Error('Invalid OMP session file');
    return file;
  }
  async bind(record:SavedSession,path:unknown):Promise<void> {
    if (typeof path!=='string' || canonical(dirname(path))!==canonical(this.ompDirectory(record.savedSessionId))) throw new Error('OMP session escaped private directory');
    await this.verifyOmpFile(record.savedSessionId,basename(path));record.ompFile=basename(path);
  }
  async save(record:SavedSession):Promise<void> {
    record.version=2;
    const dir=this.path(record.savedSessionId);await this.directory(dir);
    // Keep bounded displayed history; the full model conversation remains in OMP's JSONL.
    record.transcript=record.transcript.slice(-200);
    while (Buffer.byteLength(JSON.stringify(record.transcript))>256*1024) record.transcript.shift();
    const temporary=join(dir,randomUUID()+'.tmp');const file=await open(temporary,'wx');
    try {await file.writeFile(JSON.stringify(record));await file.sync();}finally{await file.close();}
    await rename(temporary,join(dir,'session.json'));
  }
}
export class SessionLease {
  private tail:Promise<void>=Promise.resolve();private released=false;
  constructor(readonly store:SessionStore,readonly record:SavedSession,private readonly lock:FileHandle) {}
  save():Promise<void> {const next=this.tail.then(()=>this.store.save(this.record));this.tail=next.catch(()=>{});return next;}
  append(role:TranscriptLine['role'],text:string,timing?:{started:number;ended:number;stopped:boolean},attachments?:string[]):void {
    if (!text) return;
    const part=text.slice(0,2_000_000);this.record.transcript.push({role,text:part,ts:Date.now(),...timing,...(attachments?.length?{attachments}: {})});this.record.updatedAt=Date.now();
    if (role==='user'&&this.record.title==='New conversation') this.record.title=part.replace(/\s+/g,' ').slice(0,100);
  }
  appendEvent(event:Record<string,unknown>):void {
    if(!['thinkingDelta','thinkingEnd','toolStart','toolInputDelta','toolUpdate','toolEnd','todos','subagent','notice','model','plan'].includes(String(event['t'])))return;
    const last=this.record.transcript.at(-1);
    if(event['t']==='toolInputDelta'&&last?.role==='event'&&last.event?.['t']==='toolInputDelta'&&last.event['id']===event['id']&&typeof last.event['text']==='string'){last.event['text']=(last.event['text']+String(event['text']??'')).slice(0,32768);return;}
    if(event['t']==='thinkingDelta'&&last?.role==='event'&&last.event?.['t']==='thinkingDelta'&&typeof last.event['text']==='string'){last.event['text']=(last.event['text']+String(event['text']??'')).slice(0,32768);return;}
    this.record.transcript.push({role:'event',text:'',ts:Date.now(),event});
  }
  async release():Promise<void> {if(this.released)return;this.released=true;try{await this.save();}finally{await this.lock.close();await unlink(join(this.store.root,this.record.savedSessionId,'active.lock'));}}
}
