import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,lstat,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const run=promisify(execFile);
const ignores=['.vs/','.idea/','**/bin/','**/obj/','**/Win32/','**/Win64/','**/Debug/','**/Release/','node_modules/','dist/','artifacts/','__history/','__recovery/','*.dcu','*.dcp','*.bpl','*.exe','*.dll','*.msi','*.pdb','*.identcache','*.local','*.log','.env','.env.*','!.env.example','*.pfx','*.p12','*.pem','*.key','*.clixml','.omp/','.piagent/'];
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
type File={path:string;hash:string};
type Preview={id:string;revision:string;files:File[];ignore:string;beforeIgnore:string;state:string};
/** Local-only bootstrap. It never configures remotes, pushes or changes global Git settings. */
export class GitSetup {
  private pending:Preview|undefined;
  constructor(readonly root:string){}
  private async git(args:string[],cwd=this.root){
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));
    const isolated=await mkdtemp(join(tmpdir(),'piagent-git-command-'));
    try{const config=join(isolated,'config');await writeFile(config,'');
      return (await run('git',['--no-optional-locks','-c','core.hooksPath='+isolated,'-c','core.fsmonitor=false',...args],{cwd,env:{...env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:config},windowsHide:true,timeout:30000,maxBuffer:2*1024*1024})).stdout;
    }finally{await rm(isolated,{recursive:true,force:true});}
  }
  async status():Promise<Record<string,unknown>>{
    try{await this.git(['--version']);}catch{return {state:'unavailable',message:'Git 실행파일을 찾을 수 없습니다.'};}
    for(let path=this.root;;path=dirname(path)){
      const entry=await lstat(join(path,'.git')).catch(()=>undefined);
      if(entry){
        if(entry.isSymbolicLink()||!entry.isDirectory())return {state:'unsupported',message:'연결된 Git/worktree는 기존 관리 상태를 보존합니다. PiAgent 파일 checkpoint는 독립 저장소 루트에서 지원합니다.'};
        if(path!==this.root)return {state:'parent',message:'상위 폴더의 Git 저장소에서 관리 중입니다. 중첩 저장소를 만들지 않습니다. 파일 checkpoint에는 저장소 루트를 작업영역으로 열어 주세요.'};
        try{await this.git(['rev-parse','--verify','HEAD']);return {state:'ready',message:'로컬 Git 관리 중'};}catch{return {state:'unborn',message:'Git 저장소에 첫 커밋이 없습니다.'};}
      }
      if(dirname(path)===path)break;
    }
    return {state:'missing',message:'로컬 Git이 없습니다. 채팅·개발은 가능하지만 PiAgent 파일 복원은 사용할 수 없습니다.'};
  }
  private async bytes(path:string){
    if(!path||/[\r\n\0]/.test(path)||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='..'||p==='.'||p.includes(':')))throw new Error('Unsafe Git preview path');
    let full=this.root;for(const part of path.split('/')){full=join(full,part);if((await lstat(full)).isSymbolicLink())throw new Error('Linked files cannot be included');}
    const stat=await lstat(full);if(!stat.isFile()||stat.nlink!==1||stat.size>16*1024*1024)throw new Error('Only regular files under 16 MiB can be included');
    return readFile(full);
  }
  async preview(){
    const state=String((await this.status())['state']);if(!['missing','unborn'].includes(state))throw new Error('This project does not require Git initialization');
    if(state==='unborn'&&(await this.git(['diff','--cached','--name-only'])).trim())throw new Error('Existing staged files must be reviewed manually before the first commit');
    if(state==='unborn'){
      const filters=await this.git(['config','--local','--get-regexp','^filter\\.']).catch(()=> '');
      if(filters.trim())throw new Error('Custom Git filters require manual initialization');
    }
    const ignoreStat=await lstat(join(this.root,'.gitignore')).catch(()=>undefined);
    if(ignoreStat&&(ignoreStat.isSymbolicLink()||!ignoreStat.isFile()||ignoreStat.nlink!==1||ignoreStat.size>65536))throw new Error('Unsafe .gitignore');
    const beforeIgnore=ignoreStat?(await readFile(join(this.root,'.gitignore'),'utf8')):'';
    const additions=ignores.filter(pattern=>!beforeIgnore.split(/\r?\n/).includes(pattern));
    const ignore=beforeIgnore+(beforeIgnore&&!beforeIgnore.endsWith('\n')?'\n':'')+'\n# PiAgent local development exclusions\n'+additions.join('\n')+'\n';
    const temporary=await mkdtemp(join(tmpdir(),'piagent-git-preview-'));
    const files:File[]=[],excluded:string[]=[];let totalBytes=0;
    try{
      await this.git(['init','--quiet',temporary]);await writeFile(join(temporary,'excludes'),ignore);
      const candidates=(await this.git(['--git-dir='+join(temporary,'.git'),'--work-tree='+this.root,'ls-files','--others','--exclude-standard','--exclude-from='+join(temporary,'excludes'),'-z'])).split('\0').filter(Boolean);
      if(candidates.length>3000)throw new Error('More than 3000 candidate files: refine .gitignore before initialization');
      for(const path of candidates){
        if(path==='.gitignore')continue;
        try{const data=await this.bytes(path);totalBytes+=data.length;
          if(totalBytes>128*1024*1024)throw new Error('Preview size exceeded');
          if(/(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*["']?\s*[:=]\s*["'][^"'\r\n]{8,}/i.test(data.toString('utf8'))||/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(data.toString('utf8'))){excluded.push(path);continue;}
          files.push({path,hash:digest(data)});
        }catch{excluded.push(path);}
      }
      if(totalBytes>128*1024*1024)throw new Error('Preview exceeds 128 MiB; refine .gitignore');
    }finally{await rm(temporary,{recursive:true,force:true});}
    const revision=digest(JSON.stringify({state,files,ignore}));
    this.pending={id:randomUUID(),revision,files,ignore,beforeIgnore,state};
    return {state,previewId:this.pending.id,revision,files:files.map(f=>f.path),excluded,ignoreBefore:beforeIgnore,ignoreAfter:ignore,message:'표시된 파일과 .gitignore만 첫 커밋에 포함합니다. 비밀정보 탐지는 완전하지 않으므로 목록을 확인해 주세요.'};
  }
  async apply(id:unknown,revision:unknown,name:unknown,email:unknown){
    const reviewed=this.pending;
    if(!reviewed||id!==reviewed.id||revision!==reviewed.revision)throw new Error('Preview expired; review again');
    if(typeof name!=='string'||typeof email!=='string'||!name.trim()||!email.includes('@')||[name,email].some(v=>v.length>254||/[\r\n\0<>]/.test(v)))throw new Error('Enter a valid commit author name and email');
    const fresh=await this.preview();this.pending=undefined;
    if(fresh.revision!==reviewed.revision)throw new Error('Project files changed; review again before committing');
    if(reviewed.state==='missing')await this.git(['init','--quiet','--initial-branch=main']);
    // Only an unborn repository is admitted. Never disturb a user's existing commits/index.
    if((await this.status())['state']!=='unborn')throw new Error('Git state changed; initialization stopped');
    await writeFile(join(this.root,'.gitignore'),reviewed.ignore);
    // Secret/linked/oversized candidates stay ignored in future agent commits too.
    const excluded=fresh.excluded;
    if(excluded.length){
      const info=join(this.root,'.git','info');if((await lstat(info)).isSymbolicLink()||await realpath(info)!==info)throw new Error('Unsafe Git info directory');
      const exclude=join(info,'exclude'),stat=await lstat(exclude).catch(()=>undefined);
      if(stat&&(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1))throw new Error('Unsafe Git exclude file');
      if(excluded.some(p=>/[\r\n\0]/.test(p)))throw new Error('Unsafe excluded path');
      await writeFile(exclude,'\n# PiAgent excluded review candidates\n'+excluded.map(p=>'/'+p.replace(/([\[\]*?\\])/g,'\\$1')).join('\n')+'\n',{flag:'a'});
    }
    for(const file of reviewed.files){if(digest(await this.bytes(file.path))!==file.hash)throw new Error('Project file changed during initialization');}
    for(let i=0;i<reviewed.files.length;i+=100)await this.git(['add','--','.gitignore',...reviewed.files.slice(i,i+100).map(f=>f.path)]);
    if(!reviewed.files.length)await this.git(['add','--','.gitignore']);
    await this.git(['-c','user.name='+name.trim(),'-c','user.email='+email.trim(),'-c','commit.gpgSign=false','commit','-m','Initial project snapshot']);
    return {...await this.status(),commit:(await this.git(['rev-parse','HEAD'])).trim()};
  }
}
