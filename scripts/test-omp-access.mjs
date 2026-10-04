// Local OMP startup/configuration probe: no model prompt or project edit.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {startDaemon,PipeClient} from '@piagent/daemon';
const root=await mkdtemp(join(tmpdir(),'piagent-native-access-')),workspace=join(root,'NoGitSolution');await mkdir(workspace);
await promisify(execFile)('git',['init',root],{windowsHide:true});
await promisify(execFile)('git',['-C',root,'-c','user.name=PiAgent Test','-c','user.email=test@localhost','commit','--allow-empty','-m','Fixture'],{windowsHide:true});
const authFile=join(root,'private','token');
const daemon=await startDaemon({pipeName:'piagent-native-access-'+randomUUID(),secure:{authFile},workspaceRoot:root,allowWrites:true,omp:{executable:resolve(process.argv[2]),cwd:root,profile:'native'}});
let client;
try {
 client=await PipeClient.connect(daemon.path,{authFile});
 const caps=['chat.v1','workspace.bind.v1','chat.approval.v1','chat.sessions.v1','omp.controls.v1','workspace.read.v1','workspace.edit.v1'];
 const hello=await client.request('adapter.hello',{protocolVersions:[1],capabilities:caps,requiredCapabilities:caps,adapter:{kind:'test-ide',version:'0.9.4',ideVersion:'native-no-git',instanceId:randomUUID()}});assert.ok(hello.result,JSON.stringify(hello));
 let reply=await client.request('chat.open',{workspaceUri:pathToFileURL(workspace).href},60000);assert.ok(reply.result,JSON.stringify(reply));let current=reply.result;const savedId=current.savedSessionId;
 for(const mode of ['write','yolo','plan','always-ask']) {
  reply=await client.request('chat.setApproval',{sessionId:current.sessionId,mode},60000);assert.ok(reply.result,JSON.stringify(reply));current=reply.result;
  assert.equal(current.approvalMode,mode);assert.equal(current.savedSessionId,savedId);assert.equal(current.workspaceUri,pathToFileURL(workspace).href);
  assert.equal(current.ompProfile,mode==='plan'?'restricted':'native');assert.equal(current.writeEnabled,mode!=='plan');
  const state=await client.request('omp.control',{sessionId:current.sessionId,command:'get_state'},60000);assert.ok(state.result,JSON.stringify(state));
  if(mode==='plan')assert.ok((await client.request('chat.prompt',{sessionId:current.sessionId,message:'/bash whoami'})).error);
  console.log('PASS native no-Git solution / preserved session / access mode '+mode);
 }
 const namespaces=await readdir(join(root,'private','sessions'));let count=0;
 for(const namespace of namespaces){const folder=join(root,'private','sessions',namespace,savedId,'omp');try{for(const name of await readdir(folder))if(name.endsWith('.yml')){const config=JSON.parse(await readFile(join(folder,name),'utf8'));assert.ok(['write','yolo','always-ask'].includes(config.tools.approvalMode));count++;}}catch(error){if(error.code!=='ENOENT')throw error;}}
 assert.equal(count,4);console.log('PASS four explicit per-process approval configs; no model prompt sent');
}finally{client?.close();await daemon.close();await rm(root,{recursive:true,force:true});}
