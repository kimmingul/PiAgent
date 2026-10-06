import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {GitSetup,SessionStore,ChatSession,WorkspaceReader} from '@piagent/core';
import {fileURLToPath} from 'node:url';
import {startDaemon,PipeClient} from '@piagent/daemon';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile);
async function root(t){const dir=await mkdtemp(join(tmpdir(),'piagent-bootstrap-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const git=(cwd,...args)=>exec('git',args,{cwd,windowsHide:true});
test('Git preview is read-only, excludes generated/secret files and commits only reviewed files',async t=>{
  const dir=await root(t);await writeFile(join(dir,'App.cs'),'class App {}');await writeFile(join(dir,'.gitignore'),'# preserve\nmanual/\n');
  await writeFile(join(dir,'.env'),'SECRET=value');await writeFile(join(dir,'settings.json'),'"api_key": "actual-secret-value"');await mkdir(join(dir,'bin'));await writeFile(join(dir,'bin','cache'),'ignored');
  const setup=new GitSetup(dir);assert.equal((await setup.status()).state,'missing');const preview=await setup.preview();
  assert.deepEqual(preview.files,['App.cs']);assert.deepEqual(preview.excluded,['settings.json']);
  assert.equal((await setup.status()).state,'missing');assert.equal(await readFile(join(dir,'.gitignore'),'utf8'),'# preserve\nmanual/\n');
  await assert.rejects(setup.apply('wrong',preview.revision,'Test','test@localhost'),/expired/);
  const done=await setup.apply(preview.previewId,preview.revision,'Test','test@localhost');assert.equal(done.state,'ready');
  const tracked=(await git(dir,'ls-files')).stdout.trim().split('\n');assert.deepEqual(tracked,['.gitignore','App.cs']);
  assert.match(await readFile(join(dir,'.gitignore'),'utf8'),/# preserve/);assert.equal((await git(dir,'remote')).stdout,'');
  assert.equal((await git(dir,'config','--local','--get','user.name').catch(()=>({stdout:''}))).stdout,'');
  assert.equal((await git(dir,'status','--porcelain')).stdout,'');
});
test('first-commit preview rejects stale files and protects existing staged changes',async t=>{
  const dir=await root(t);await git(dir,'init');await writeFile(join(dir,'App.cs'),'before');const setup=new GitSetup(dir);
  assert.equal((await setup.status()).state,'unborn');const preview=await setup.preview();await writeFile(join(dir,'App.cs'),'after');
  await assert.rejects(setup.apply(preview.previewId,preview.revision,'Test','test@localhost'),/changed/);
  await git(dir,'add','App.cs');await assert.rejects(setup.preview(),/staged/);
});
test('parent repositories and linked files are not initialized or silently committed',async t=>{
  const dir=await root(t);await git(dir,'init');const child=join(dir,'child');await mkdir(child);
  const setup=new GitSetup(child);assert.equal((await setup.status()).state,'parent');await assert.rejects(setup.preview(),/does not require/);
  const other=await root(t);await writeFile(join(other,'real.txt'),'real');const linked=await root(t);await writeFile(join(linked,'linked.txt'),'outside');await symlink(linked,join(other,'linked'),process.platform==='win32'?'junction':'dir');
  const p=await new GitSetup(other).preview();assert.ok(!p.files.some(path=>path.startsWith('linked/')));
});
test('automatic resume returns last selected workspace conversation while explicit new stays new',async t=>{
  const dir=await root(t),sessions=new SessionStore(join(dir,'sessions'));await sessions.initialize();
  const options={executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:dir};
  const make=()=>new ChatSession(options,()=>{},new WorkspaceReader(dir),undefined,{sessions});
  let chat=make();const first=await chat.handle('chat.open',{},true,false,true);await chat.dispose();
  chat=make();const resumed=await chat.handle('chat.open',{resumeLast:true},true,false,true);assert.equal(resumed.savedSessionId,first.savedSessionId);await chat.dispose();
  chat=make();const fresh=await chat.handle('chat.open',{},true,false,true);assert.notEqual(fresh.savedSessionId,first.savedSessionId);await chat.dispose();
  chat=make();assert.equal((await chat.handle('chat.open',{resumeLast:true},true,false,true)).savedSessionId,fresh.savedSessionId);await chat.dispose();
  const other=new SessionStore(join(dir,'other'));await other.initialize();assert.equal(await other.last(),undefined);
});
test('Named Pipe Git bootstrap keeps non-Git chat available and enables checkpoints after approved commit',{skip:process.platform!=='win32'},async t=>{
  const dir=await root(t),workspace=join(dir,'workspace');await mkdir(workspace);await writeFile(join(workspace,'App.cs'),'class App {}');
  const authFile=join(dir,'private','token');let daemon,client;
  try{
    daemon=await startDaemon({pipeName:'piagent-bootstrap-'+randomUUID(),workspaceRoot:workspace,allowWrites:true,secure:{authFile},omp:{executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:workspace,profile:'native'}});
    client=await PipeClient.connect(daemon.path,{authFile});await client.request('adapter.hello',{protocolVersions:[1],capabilities:['chat.v1','chat.sessions.v1','workspace.read.v1','workspace.edit.v1','omp.controls.v1'],adapter:{kind:'fixture',version:'test',ideVersion:'test',instanceId:randomUUID()}});
    const opened=(await client.request('chat.open')).result;assert.equal(opened.gitStatus.state,'missing');assert.equal(opened.checkpointsEnabled,false);
    const params={sessionId:opened.sessionId};const preview=(await client.request('chat.git',{...params,op:'preview'})).result;assert.ok(preview.previewId);
    const result=await client.request('chat.git',{...params,op:'apply',previewId:preview.previewId,revision:preview.revision,name:'Test',email:'test@localhost'});assert.equal(result.result?.checkpointsEnabled,true,JSON.stringify(result));
    assert.equal((await client.request('chat.prompt',{...params,message:'local'})).result.accepted,true);
  }finally{client?.close();await daemon?.close();}
});
