import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isObject } from '@piagent/protocol';

export const SESSION_CAPABILITY = 'chat.sessions.v1';
export const USAGE_CAPABILITY = 'chat.usage.v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonical=(path:string):string=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
export interface TranscriptLine { role: 'user'|'assistant'|'status'; text: string; }
export interface SavedSession {
  version: 1; savedSessionId: string; title: string; createdAt: number; updatedAt: number;
  ompFile?: string; transcript: TranscriptLine[];
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
    if (!isObject(value) || value['version']!==1 || value['savedSessionId']!==id || typeof value['title']!=='string'
      || typeof value['createdAt']!=='number' || typeof value['updatedAt']!=='number' || !Array.isArray(value['transcript'])
      || value['transcript'].length>200 || value['transcript'].some(line=>!isObject(line)||!['user','assistant','status'].includes(String(line['role']))||typeof line['text']!=='string')) throw new Error('Invalid saved session');
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
      record={version:1,savedSessionId:randomUUID(),title:'New conversation',createdAt:Date.now(),updatedAt:Date.now(),transcript:[]};
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
  append(role:TranscriptLine['role'],text:string):void {
    if (!text) return;
    const part=text.slice(0,2_000_000);this.record.transcript.push({role,text:part});this.record.updatedAt=Date.now();
    if (role==='user'&&this.record.title==='New conversation') this.record.title=part.replace(/\s+/g,' ').slice(0,100);
  }
  async release():Promise<void> {if(this.released)return;this.released=true;try{await this.save();}finally{await this.lock.close();await unlink(join(this.store.root,this.record.savedSessionId,'active.lock'));}}
}
