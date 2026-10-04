// Opt-in compatibility probe. No model prompt, API call or IDE document edit.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ChatSession} from '../packages/piagent-core/dist/chat.js';
import {SessionStore} from '../packages/piagent-core/dist/sessions.js';
import {WorkspaceChanges} from '../packages/piagent-core/dist/changes.js';
import {WorkspaceReader} from '../packages/piagent-core/dist/workspace.js';
const root=await mkdtemp(join(tmpdir(),'piagent-native-smoke-'));
const store=new SessionStore(join(root,'sessions'));await store.initialize();
const exec=promisify(execFile);
const git=(...args)=>exec('git',['-c','user.name=PiAgent Smoke','-c','user.email=smoke@localhost','-c','core.hooksPath=NUL',...args],{cwd:root,windowsHide:true});
await git('init');await writeFile(join(root,'fixture.txt'),'smoke\n');await git('add','fixture.txt');await git('commit','-m','Smoke fixture');
const workspace=await WorkspaceReader.create(root),changes=await WorkspaceChanges.create(workspace);
const session=new ChatSession({executable:resolve(process.argv[2]??'.tools/omp-18.6.0/omp.exe'),cwd:root,profile:'native',readyTimeoutMs:30000,requestTimeoutMs:30000},()=>{},workspace,changes,{sessions:store});
try {
  await assert.rejects(session.handle('chat.open',{},true,false,true,false,false,true,true),/negotiated workspace writes/);
  const opened=await session.handle('chat.open',{},true,true,true,false,false,true,true);
  assert.equal(opened.ompProfile,'native');assert.equal(opened.ompControlsEnabled,true);
  const models=await session.handle('omp.control',{sessionId:opened.sessionId,command:'get_available_models'},true,false,true,false,false,true,true);
  assert.ok(models.models.length>0);
  await session.handle('chat.close',{sessionId:opened.sessionId});
  const saved=await store.list();assert.equal(saved.some(item=>item.resumable),true);
  console.log(JSON.stringify({nativeStartup:true,privateSession:true,hostTools:true,models:models.models.length,modelPromptSent:false},null,2));
}finally{await session.dispose();}
