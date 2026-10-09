import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,readFile,realpath,mkdtemp,copyFile,open,rename,unlink,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {workspacePathParts} from './workspace.js';
const run=promisify(execFile);
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
export type GitReview={previewId:string;revision:string;operation:'stage'|'commit';title:string;diff:string;files:string[];message?:string;expiresAt:number};
type Pending=GitReview&{fingerprint:string};
/** Local Git operations. Consent belongs to the caller; only cached immutable previews can be applied. */
export class GitWorkflow {
  private pending=new Map<string,Pending>();
  private applying=false;
  constructor(readonly root:string){}
  close(){this.pending.clear();}
  private async git(args:string[],signal:AbortSignal,indexFile?:string){
    signal.throwIfAborted();
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));
    return (await run('git',['--no-optional-locks','--literal-pathspecs','-c','core.fsmonitor=false','-c','color.ui=false',...args],{cwd:this.root,env:{...env,GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat',...(indexFile?{GIT_INDEX_FILE:indexFile}:{})},windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,signal})).stdout;
  }
  private async ready(signal:AbortSignal){
    const top=(await this.git(['rev-parse','--show-toplevel'],signal)).trim();
    if(await realpath(top)!==await realpath(this.root))throw new Error('Open the repository root for Git operations');
    if((await this.git(['ls-files','--unmerged'],signal)).trim())throw new Error('Resolve merge conflicts before using Git operations');
  }
  private async file(path:string){
    if(!path||path.length>1024||/[\0\r\n\\]/.test(path)||isAbsolute(path)||path.split('/').some(p=>!p||p==='.'||p==='..'||p.includes(':')||p.toLowerCase()==='.git'))throw new Error('Unsafe repository path');
    workspacePathParts(path);
    let full=resolve(this.root);
    for(const part of path.split('/')){full=join(full,part);const st=await lstat(full).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});if(st?.isSymbolicLink())throw new Error('Linked paths require manual Git review');}
    if(relative(this.root,full).startsWith('..'))throw new Error('Path escapes repository');
    const stat=await lstat(full).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
    if(!stat)return 'deleted';
    if(!stat.isFile()||stat.nlink!==1||stat.size>1024*1024)throw new Error('Select regular files up to 1 MiB individually');
    return hash(await readFile(full));
  }
  private async contentPaths(staged:boolean,signal:AbortSignal):Promise<string[]>{
    // Split renames into deletion/addition endpoints before reading content. An
    // ordinary destination must not expose the old contents of an excluded file.
    const files=(await this.git(['diff','--no-renames','--name-only','-z',...(staged?['--cached']:[])],signal)).split('\0').filter(Boolean);
    for(const path of files)workspacePathParts(path);
    return files;
  }
  private async status(signal:AbortSignal):Promise<string>{
    const rows=(await this.git(['-c','status.renames=false','status','--porcelain=v1','-z','--branch'],signal)).split('\0').filter(Boolean);
    return rows.filter(row=>{
      if(row.startsWith('## '))return true;
      try{workspacePathParts(row.slice(3));return true;}catch{return false;}
    }).join('\n');
  }
  private async fingerprint(files:string[],signal:AbortSignal){
    const head=await this.git(['rev-parse','--verify','HEAD'],signal).catch(()=> 'unborn');
    const index=await this.git(['ls-files','--stage','-z'],signal);
    const status=await this.git(['status','--porcelain=v1','-z','--untracked-files=all'],signal);
    const content=[];for(const path of files)content.push([path,await this.file(path)]);
    return hash(JSON.stringify({head,index,status,content}));
  }
  review(id:unknown):GitReview{
    const item=typeof id==='string'?this.pending.get(id):undefined;
    if(!item||item.expiresAt<=Date.now()){if(typeof id==='string')this.pending.delete(id);throw new Error('Git preview expired; review again');}
    const {fingerprint:_,...review}=item;return {...review,files:[...review.files]};
  }
  async execute(args:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
    await this.ready(signal);
    const operation=args.operation??'status';
    if(operation==='status')return {status:await this.status(signal)};
    if(operation==='diff'){
      const files=await this.contentPaths(args.staged===true,signal);
      return {diff:files.length?await this.git(['diff','--no-renames','--no-ext-diff','--no-textconv',...(args.staged===true?['--cached']:[]),'--',...files],signal):''};
    }
    if(operation==='log')return {log:await this.git(['log','-20','--format=%h %s'],signal)};
    if(operation==='branches')return {branches:await this.git(['branch','--list','--format=%(refname:short) %(objectname:short) %(HEAD)'],signal)};
    if(operation!=='preview-stage'&&operation!=='preview-commit')throw new Error('Unsupported Git operation');
    let files:string[],diff:string,message:string|undefined,initialFingerprint:string;
    if(operation==='preview-stage'){
      if(!Array.isArray(args.files)||!args.files.length||args.files.length>64||args.files.some(p=>typeof p!=='string'))throw new Error('Select 1–64 explicit files to stage');
      files=[...new Set(args.files as string[])];for(const path of files)await this.file(path);
      await this.contentPaths(false,signal);
      const attributes=(await this.git(['check-attr','-z','filter','--',...files],signal)).split('\0');
      for(let index=2;index<attributes.length;index+=3)if(!['unspecified','unset'].includes(attributes[index]!))throw new Error('Custom Git filters require manual staging');
      const staged=(await this.git(['diff','--cached','--name-only','-z'],signal)).split('\0');
      if(files.some(p=>staged.includes(p)))throw new Error('Selected files already have staged changes; review them manually to preserve partial staging');
      initialFingerprint=await this.fingerprint(files,signal);
      diff=await this.git(['diff','--no-renames','--no-ext-diff','--no-textconv','--',...files],signal);
      const untracked=(await this.git(['ls-files','--others','--exclude-standard','-z','--',...files],signal)).split('\0').filter(Boolean);
      for(const path of untracked){const content=await readFile(join(this.root,path));if(content.includes(0))throw new Error('Binary additions require manual staging');diff+='\n--- /dev/null\n+++ '+path+'\n'+content.toString('utf8').split('\n').map(s=>'+'+s).join('\n');}
    }else{
      if(typeof args.message!=='string'||!args.message.trim()||args.message.length>4096||args.message.includes('\0'))throw new Error('A commit message is required');
      message=args.message;files=await this.contentPaths(true,signal);
      initialFingerprint=await this.fingerprint(files,signal);
      diff=files.length?await this.git(['diff','--cached','--no-renames','--no-ext-diff','--no-textconv','--',...files],signal):'';
    }
    if(!diff.trim()||!files.length)throw new Error('No changes to review');
    if(/^Binary files .* differ$/m.test(diff)||/^GIT binary patch$/m.test(diff))throw new Error('Binary changes require manual Git review');
    if(Buffer.byteLength(diff)>256*1024)throw new Error('Git review exceeds 256 KiB; select fewer changes');
    const fingerprint=await this.fingerprint(files,signal),previewId=randomUUID();
    if(initialFingerprint!==fingerprint)throw new Error('Git state or files changed while preparing review; review again');
    const item:Pending={previewId,revision:fingerprint,fingerprint,operation:operation==='preview-stage'?'stage':'commit',title:operation==='preview-stage'?'Stage selected files':'Commit staged changes',diff,files,...(message===undefined?{}:{message}),expiresAt:Date.now()+300000};
    for(const [id,value]of this.pending)if(value.expiresAt<=Date.now())this.pending.delete(id);
    if(this.pending.size>=16)this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(previewId,item);return this.review(previewId);
  }
  async apply(args:{previewId?:unknown;revision?:unknown},signal:AbortSignal):Promise<unknown>{
    if(this.applying)throw new Error('Another Git operation is running');
    const review=this.review(args.previewId);if(args.revision!==review.revision)throw new Error('Git review revision mismatch');
    this.pending.delete(review.previewId);this.applying=true;
    let directory:string|undefined,lockPath:string|undefined;
    let commandStarted=false,commandCompleted=false,indexPublished=false,beforeHead:string|undefined,outcome:Record<string,unknown>|undefined;
    try{
      await this.ready(signal);
      const indexPath=resolve(this.root,(await this.git(['rev-parse','--git-path','index'],signal)).trim());
      const indexStat=await lstat(indexPath).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
      if(indexStat&&(indexStat.isSymbolicLink()||!indexStat.isFile()||indexStat.nlink!==1))throw new Error('Unsafe Git index');
      // Own the native index lock before revalidation. Other sessions and external Git
      // writers cannot stage/checkout underneath a reviewed operation.
      const lock=await open(indexPath+'.lock','wx');lockPath=indexPath+'.lock';await lock.close();
      if(await this.fingerprint(review.files,signal)!==review.revision)throw new Error('Git state or files changed; review again');
      directory=await mkdtemp(join(tmpdir(),'piagent-git-reviewed-'));const isolatedIndex=join(directory,'index');
      if(indexStat)await copyFile(indexPath,isolatedIndex);
      signal.throwIfAborted();
      if(review.operation==='commit')beforeHead=(await this.git(['rev-parse','--verify','HEAD'],signal).catch(()=> 'unborn')).trim();
      signal.throwIfAborted();commandStarted=true;
      const output=review.operation==='stage'?await this.git(['add','--',...review.files],signal,isolatedIndex):await this.git(['commit','-m',review.message!],signal,isolatedIndex);
      commandCompleted=true;
      if(review.operation==='stage'&&await this.fingerprint(review.files,signal)!==review.revision)throw new Error('Files changed while staging; index preserved, review again');
      await copyFile(isolatedIndex,lockPath);await rename(lockPath,indexPath);lockPath=undefined;indexPublished=true;
      return outcome={executed:true,operation:review.operation,output,state:'completed',status:await this.status(signal)};
    }catch(error){
      if(indexPublished)return outcome={executed:true,operation:review.operation,state:'applied_verification_failed',warning:'Git operation applied, but final verification failed. Inspect HEAD/index before any retry.'};
      if(commandStarted&&review.operation==='commit'){
        const inspection=new AbortController();
        const afterHead=(await this.git(['rev-parse','--verify','HEAD'],inspection.signal).catch(()=>undefined))?.trim();
        return outcome={executed:commandCompleted?true:null,operation:'commit',state:commandCompleted?'partial':'outcome_unknown',headChanged:beforeHead!==undefined&&afterHead!==undefined?beforeHead!==afterHead:null,warning:commandCompleted?'Commit completed, but reviewed index publication failed. Inspect HEAD/index before any retry.':'Commit execution was interrupted; hooks or a commit may already have run. Inspect HEAD/index before any retry.'};
      }
      throw error;
    }finally{
      try{if(lockPath)await unlink(lockPath);if(directory)await rm(directory,{recursive:true,force:true});}
      catch{if(outcome)outcome['cleanupWarning']='Owned Git lock or temporary index cleanup failed; inspect before another write.';}
      this.applying=false;
    }
  }
}
