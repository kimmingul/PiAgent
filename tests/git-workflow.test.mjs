import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,access,rename,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {GitWorkflow} from '../packages/piagent-core/dist/git-workflow.js';
import {WorkspaceReader} from '../packages/piagent-core/dist/workspace.js';
const signal=()=>new AbortController().signal;
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'piagent-workflow-'));const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});try{git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','commit.gpgSign','false');await writeFile(join(root,'one.txt'),'one\n');git('add','.');git('commit','-qm','initial');await fn(new GitWorkflow(root),root,git);}finally{await rm(root,{recursive:true,force:true});}}
test('Git review stages explicit files and commits reviewed index without staging unrelated work',()=>fixture(async(service,root,git)=>{
 await writeFile(join(root,'one.txt'),'updated\n');await writeFile(join(root,'other.txt'),'unrelated\n');
 const preview=await service.execute({operation:'preview-stage',files:['one.txt']},signal());assert.match(preview.diff,/updated/);
 preview.files.push('other.txt');assert.deepEqual(service.review(preview.previewId).files,['one.txt']);
 await service.apply(preview,signal());assert.equal(git('diff','--cached','--name-only').trim(),'one.txt');
 await assert.rejects(service.apply(preview,signal()),/expired/);
 const commit=await service.execute({operation:'preview-commit',message:'Reviewed update'},signal());await service.apply(commit,signal());
 assert.equal(git('log','-1','--format=%s').trim(),'Reviewed update');assert.match(git('status','--porcelain'),/\?\? other.txt/);
}));
test('Git rejects stale file/index reviews and partial staging without altering user content',()=>fixture(async(service,root,git)=>{
 await writeFile(join(root,'one.txt'),'second\n');const preview=await service.execute({operation:'preview-stage',files:['one.txt']},signal());
 await writeFile(join(root,'one.txt'),'third\n');await assert.rejects(service.apply(preview,signal()),/changed/);assert.equal(git('diff','--cached'), '');
 git('add','one.txt');await writeFile(join(root,'one.txt'),'fourth\n');await assert.rejects(service.execute({operation:'preview-stage',files:['one.txt']},signal()),/already have staged/);
 const commit=await service.execute({operation:'preview-commit',message:'stale'},signal());git('reset','-q','HEAD','--','one.txt');await assert.rejects(service.apply(commit,signal()),/changed/);assert.equal(await readFile(join(root,'one.txt'),'utf8'),'fourth\n');
}));
test('Git rejects path escapes, directories, binary additions and cancelled requests',()=>fixture(async(service,root)=>{
 for(const path of ['../outside','.git/config','.',':(glob)*','one.txt\nother'])await assert.rejects(service.execute({operation:'preview-stage',files:[path]},signal()));
 await writeFile(join(root,'binary.bin'),Buffer.from([0,1,2]));await assert.rejects(service.execute({operation:'preview-stage',files:['binary.bin']},signal()),/Binary/);
 const abort=new AbortController();abort.abort();await assert.rejects(service.execute({operation:'status'},abort.signal));
}));
test('Git respects an existing native index lock and never removes another writer lock',()=>fixture(async(service,root,git)=>{
 await writeFile(join(root,'one.txt'),'pending\n');const preview=await service.execute({operation:'preview-stage',files:['one.txt']},signal());
 const lock=join(root,'.git','index.lock');await writeFile(lock,'owned by another process');
 await assert.rejects(service.apply(preview,signal()),/EEXIST/);assert.equal(await readFile(lock,'utf8'),'owned by another process');assert.equal(git('diff','--cached'),'');
}));

test('Git content tools share workspace exclusions before consent and refuse an excluded staged index',()=>fixture(async(service,root,git)=>{
 const sentinel='SYNTHETIC_PROTECTED_CONTENT_SENTINEL',reader=await WorkspaceReader.create(root);
 await writeFile(join(root,'.env'),'FAKE='+sentinel+'\n');
 await assert.rejects(reader.execute('workspace_read_file',{path:'.env'},signal()),/excluded/);
 await assert.rejects(service.execute({operation:'preview-stage',files:['.env']},signal()),/excluded/);
 git('add','.env');git('commit','-qm','protected fixture');
 await writeFile(join(root,'.env'),'FAKE='+sentinel+'_changed\n');await writeFile(join(root,'one.txt'),'ordinary changed\n');
 await assert.rejects(service.execute({operation:'diff'},signal()),/excluded/);
 await assert.rejects(service.execute({operation:'preview-stage',files:['one.txt']},signal()),/excluded/);
 const status=await service.execute({operation:'status'},signal());assert.doesNotMatch(status.status,/\.env|PROTECTED_CONTENT/);assert.match(status.status,/one.txt/);
 git('add','.env','one.txt');const head=git('rev-parse','HEAD'),index=await readFile(join(root,'.git','index'));
 await assert.rejects(service.execute({operation:'diff',staged:true},signal()),/excluded/);
 await assert.rejects(service.execute({operation:'preview-commit',message:'must be refused'},signal()),/excluded/);
 assert.equal(git('rev-parse','HEAD'),head);assert.deepEqual(await readFile(join(root,'.git','index')),index);
}));

test('Git checks protected rename and deletion endpoints instead of reading a safe destination alone',()=>fixture(async(service,root,git)=>{
 await writeFile(join(root,'.env'),'FAKE=ORIGINAL_PROTECTED_SENTINEL\n');git('add','.env');git('commit','-qm','protected fixture');
 await rename(join(root,'.env'),join(root,'ordinary.txt'));
 await assert.rejects(service.execute({operation:'preview-stage',files:['ordinary.txt']},signal()),/excluded/);
 await assert.rejects(service.execute({operation:'diff'},signal()),/excluded/);
 git('add','-A');
 await assert.rejects(service.execute({operation:'diff',staged:true},signal()),/excluded/);
 await assert.rejects(service.execute({operation:'preview-commit',message:'protected source rename'},signal()),/excluded/);
 git('reset','--hard','-q','HEAD');git('mv','one.txt','private.pem');
 await assert.rejects(service.execute({operation:'preview-commit',message:'protected destination rename'},signal()),/excluded/);
 git('reset','--hard','-q','HEAD');git('rm','-q','.env');
 await assert.rejects(service.execute({operation:'diff',staged:true},signal()),/excluded/);
 await assert.rejects(service.execute({operation:'preview-commit',message:'protected deletion'},signal()),/excluded/);
}));

test('Git rejects shared excluded names and pathspec tricks while retaining literal ordinary filenames',()=>fixture(async(service,root,git)=>{
 await mkdir(join(root,'.ssh'));await writeFile(join(root,'.ssh','config'),'synthetic protected configuration');
 for(const path of ['.ssh/config','credentials.json','secrets.local','private.key','.env.local','bin/generated.txt','one.txt.','NUL.txt',':(glob)*']){
  await assert.rejects(service.execute({operation:'preview-stage',files:[path]},signal()));
 }
 await writeFile(join(root,'[literal].txt'),'ordinary bracket path\n');
 const preview=await service.execute({operation:'preview-stage',files:['[literal].txt']},signal());await service.apply(preview,signal());
 assert.equal(git('diff','--cached','--name-only').trim(),'[literal].txt');
}));
test('Git reports completed commit with unpublished index as partial and consumes review',()=>fixture(async(service,root,git)=>{
 await writeFile(join(root,'one.txt'),'faulted commit\n');git('add','one.txt');
 const beforeHead=git('rev-parse','HEAD').trim(),beforeIndex=await readFile(join(root,'.git','index'));
 const helper=join(root,'.git','remove-owned-test-index.cjs');
 // The hook fault removes only this operation's private index after Git has
 // committed. Never delete a path solely because a hook environment supplied it.
 await writeFile(helper,`const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const target=process.env.GIT_INDEX_FILE;
if(!target||!path.isAbsolute(target)||path.basename(target)!=='index')throw Error('unsafe test index');
const directory=fs.realpathSync(path.dirname(target));
if(fs.realpathSync(path.dirname(directory))!==fs.realpathSync(os.tmpdir())||!/^piagent-git-reviewed-[A-Za-z0-9]+$/.test(path.basename(directory)))throw Error('unsafe test directory');
const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('unsafe test file');
fs.unlinkSync(target);
`);
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 await writeFile(join(root,'.git','hooks','post-commit'),'#!/bin/sh\n'+quote(process.execPath.replaceAll('\\','/'))+' '+quote(helper.replaceAll('\\','/'))+'\n',{mode:0o755});
 const preview=await service.execute({operation:'preview-commit',message:'completed with fault'},signal());
 const result=await service.apply(preview,signal());
 assert.equal(result.state,'partial');assert.equal(result.executed,true);assert.equal(result.headChanged,true);assert.match(result.warning,/index publication failed/);
 assert.notEqual(git('rev-parse','HEAD').trim(),beforeHead);assert.deepEqual(await readFile(join(root,'.git','index')),beforeIndex);
 await assert.rejects(access(join(root,'.git','index.lock')));await assert.rejects(service.apply(preview,signal()),/expired/);
}));
test('Git interrupted while a local hook runs reports uncertainty and never invites blind retry',{timeout:20000},()=>fixture(async(service,root,git)=>{
 await writeFile(join(root,'one.txt'),'cancelled commit\n');git('add','one.txt');const beforeHead=git('rev-parse','HEAD').trim();
 const helper=join(root,'.git','waiting-test-hook.cjs'),started=join(root,'.git','hook-started'),release=join(root,'.git','hook-release');
 await writeFile(helper,`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},'started');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);process.exit(0)}},20);setTimeout(()=>process.exit(1),10000);`);
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 await writeFile(join(root,'.git','hooks','pre-commit'),'#!/bin/sh\n'+quote(process.execPath.replaceAll('\\','/'))+' '+quote(helper.replaceAll('\\','/'))+'\n',{mode:0o755});
 const preview=await service.execute({operation:'preview-commit',message:'interrupted'},signal()),controller=new AbortController(),pending=service.apply(preview,controller.signal);
 try{
  let hookStarted=false;for(let attempt=0;attempt<200;attempt++){try{await access(started);hookStarted=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}assert.equal(hookStarted,true);
  controller.abort();const result=await pending;assert.equal(result.state,'outcome_unknown');assert.equal(result.executed,null);assert.equal(result.headChanged,false);assert.match(result.warning,/hooks or a commit may already have run/);assert.equal(git('rev-parse','HEAD').trim(),beforeHead);await assert.rejects(service.apply(preview,signal()),/expired/);await assert.rejects(access(join(root,'.git','index.lock')));
 }finally{controller.abort();await writeFile(release,'release owned hook');await pending.catch(()=>{});await new Promise(resolve=>setTimeout(resolve,100));}
}));
