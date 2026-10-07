import {createHash, randomUUID} from 'node:crypto';
import {link, lstat, open, readFile, unlink} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join, resolve} from 'node:path';
import {isObject} from '@piagent/protocol';

const busy='Saved session is already active in another connection. Close that conversation before retrying';
const inspection='Saved session needs interrupted-session inspection (legacy or incomplete owner record)';
interface Owner {version:1; token:string; pid:number; starting:boolean; childPid?:number;}
const validPid=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
function alive(pid:number):boolean {
  try{process.kill(pid,0);return true;}
  catch(error){if(isObject(error)&&error['code']==='ESRCH')return false;return true;}
}
async function owner(path:string):Promise<Owner|undefined> {
  const stat=await lstat(path).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(!stat)return undefined;
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)throw new Error(inspection);
  // Each durable transition is one newline-terminated record. Ignore only the
  // incomplete last append: before spawning, the previous record is already
  // marked starting, so a crash during child registration remains fail-closed.
  const bytes=await readFile(path,'utf8');const lines=bytes.split('\n');lines.pop();
  let value:unknown;try{value=JSON.parse(lines.at(-1)??'');}catch{throw new Error(inspection);}
  if(!isObject(value)||value['version']!==1||typeof value['token']!=='string'||!validPid(value['pid'])
    ||typeof value['starting']!=='boolean'||(value['childPid']!==undefined&&!validPid(value['childPid'])))throw new Error(inspection);
  return value as unknown as Owner;
}

/** Windows pipe ownership is released by the OS even after TerminateProcess/reboot.
 * Hold it for the whole lease, including recovery, so two reclaimers cannot unlink
 * each other's files. The durable marker also excludes older Core versions.
 */
export class SessionLock {
  private releasing:Promise<void>|undefined;
  private constructor(private readonly path:string,private readonly value:Owner,private readonly unlock:()=>Promise<void>) {}
  static async acquire(directory:string):Promise<SessionLock> {
    let unlock=async()=>{};
    if(process.platform==='win32'){
      const name='\\\\.\\pipe\\piagent-session-'+createHash('sha256').update(resolve(directory).toLowerCase()).digest('hex');
      const server=createServer(socket=>socket.destroy());
      await new Promise<void>((resolve,reject)=>{
        server.once('error',error=>reject(new Error((error as NodeJS.ErrnoException).code==='EADDRINUSE'?busy:`Session lock unavailable: ${error.message}`)));
        server.listen(name,resolve);
      });
      server.unref();
      unlock=()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
    const path=join(directory,'active.lock');
    try{
      const previous=await owner(path);
      if(previous){
        if(alive(previous.pid)||(previous.childPid!==undefined&&alive(previous.childPid)))throw new Error(busy);
        // Non-Windows tests keep exclusive file semantics; automatic reclamation
        // requires the Windows OS guard. An interrupted spawn is fail-closed.
        if(process.platform!=='win32'||previous.starting)throw new Error(inspection);
        await unlink(path);
      }
      const value:Owner={version:1,token:randomUUID(),pid:process.pid,starting:false};
      const lock=new SessionLock(path,value,unlock);
      await lock.persist(true);
      return lock;
    }catch(error){await unlock();throw error;}
  }
  static async active(directory:string):Promise<boolean> {
    try{const value=await owner(join(directory,'active.lock'));
      return !!value&&(value.starting||alive(value.pid)||(value.childPid!==undefined&&alive(value.childPid)));
    }catch{return true;}
  }
  private async persist(initial=false):Promise<void> {
    if(!initial){
      // Avoid Windows EPERM failures when replacing a recently created marker.
      // An incomplete append retains the last durable state.
      const file=await open(this.path,'a');
      try{await file.writeFile(JSON.stringify(this.value)+'\n');await file.sync();}
      finally{await file.close();}
      return;
    }
    const temp=this.path+'.'+randomUUID()+'.tmp';const file=await open(temp,'wx',0o600);
    try{
      await file.writeFile(JSON.stringify(this.value)+'\n');await file.sync();await file.close();
      // A complete owner record becomes visible atomically, with no empty-file window.
      await link(temp,this.path);
    }finally{await file.close().catch(()=>{});await unlink(temp).catch(()=>{});}
  }
  async starting():Promise<void>{this.value.starting=true;await this.persist();}
  async started(pid:number|undefined):Promise<void>{
    if(pid!==undefined)this.value.childPid=pid;
    this.value.starting=false;await this.persist();
  }
  release():Promise<void>{
    return this.releasing??=this.releaseOnce();
  }
  private async releaseOnce():Promise<void>{
    try{const current=await owner(this.path);if(current?.token===this.value.token)await unlink(this.path);}
    finally{await this.unlock();}
  }
}
