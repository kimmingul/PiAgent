import test from 'node:test';
import assert from 'node:assert/strict';
import {fork,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {SessionStore,ChatSession} from '@piagent/core';
import {startDaemon,PipeClient} from '@piagent/daemon';
const windows={skip:process.platform!=='win32',timeout:30000};
const fixture=fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url));
async function until(predicate){for(let i=0;i<500;i++){if(await predicate())return;await delay(10);}assert.fail('Interruption regression deadline exceeded');}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const exit=once(child,'exit');child.kill();await exit;}

test('abrupt ChatSession owner interruption preserves durable OMP context without replaying the in-flight turn',windows,async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-chat-interruption-'));
 const child=fork(fileURLToPath(new URL('./fixtures/interrupted-chat-owner.mjs',import.meta.url)),[root],{silent:true,execArgv:[]});
 child.stdout.resume();child.stderr.resume();const messages=[];child.on('message',value=>messages.push(value));
 let resumed;try{
  await until(()=>messages.some(value=>value.type==='opened'));const opened=messages.find(value=>value.type==='opened').opened;
  child.send({id:'first',message:'remember interrupted context'});await until(()=>messages.some(value=>value.type==='event'&&value.event.kind==='completed'));
  child.send({id:'pending',message:'wait'});await until(()=>messages.some(value=>value.type==='ack'&&value.id==='pending'));
  const store=new SessionStore(root),before=await store.load(opened.savedSessionId);
  assert.deepEqual(before.transcript.filter(line=>line.role==='user').map(line=>line.text),['remember interrupted context','wait']);
  assert.equal(messages.filter(value=>value.type==='event'&&value.event.kind==='completed').length,1);
  // Windows can terminate the child without executing JavaScript exit handlers;
  // the production lock checks both registered PIDs before allowing recovery.
  await stop(child);
  await until(async()=>!(await store.list())[0].active);
  const frames=[];resumed=new ChatSession({executable:process.execPath,executableArgs:[fixture],cwd:root},frame=>frames.push(frame),undefined,undefined,{sessions:store});
  const restored=await resumed.handle('chat.open',{savedSessionId:opened.savedSessionId},false,false,true);
  assert.equal(restored.savedSessionId,opened.savedSessionId);assert.notEqual(restored.sessionId,opened.sessionId);
  assert.deepEqual(restored.transcript.filter(line=>line.role==='user').map(line=>line.text),['remember interrupted context','wait']);
  await delay(100);assert.equal(frames.filter(frame=>frame.kind==='started').length,0,'resume must not replay the interrupted prompt');
  await resumed.handle('chat.prompt',{sessionId:restored.sessionId,message:'recall'},false,false,true);await until(()=>frames.some(frame=>frame.kind==='completed'));
  assert.equal(frames.filter(frame=>frame.kind==='delta').map(frame=>frame.text).join(''),'remember interrupted context|wait');
  assert.equal(frames.filter(frame=>frame.kind==='completed').length,1);
 }finally{await stop(child);await resumed?.dispose();await rm(root,{recursive:true,force:true});}
});

test('native chat exceeding the 256 KiB turn checkpoint budget warns without failing or losing subsequent use',windows,async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-checkpoint-budget-')),run=promisify(execFile),authFile=join(root,'private','token');
 let daemon,client;const git=async(...args)=>(await run('git',args,{cwd:root,windowsHide:true})).stdout;
 try{
  await git('init');for(let i=0;i<5;i++)await writeFile(join(root,`Large${i}.cs`),'a'.repeat(30000));
  await writeFile(join(root,'fixture-marker'),'owned checkpoint test');await git('add','.');await git('-c','user.name=Test','-c','user.email=test@localhost','commit','-m','Owned test fixture');
  const head=await git('rev-parse','HEAD'),index=await readFile(join(root,'.git','index'));
  daemon=await startDaemon({pipeName:'piagent-checkpoint-budget-'+randomUUID(),secure:{authFile},workspaceRoot:root,allowWrites:true,
   omp:{executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/observed-turn-omp.mjs',import.meta.url))],cwd:root,profile:'native'}});
  client=await PipeClient.connect(daemon.path,{authFile});const caps=['chat.v1','chat.sessions.v1','omp.controls.v1','workspace.read.v1','workspace.edit.v1'];
  assert.ok((await client.request('adapter.hello',{protocolVersions:[1],capabilities:caps,adapter:{kind:'test',version:'test',ideVersion:'test',instanceId:randomUUID()}})).result);
  const opened=(await client.request('chat.open')).result;assert.equal(opened.checkpointsEnabled,true);const events=[];client.on('chat.event',event=>events.push(event));
  const turn=(await client.request('chat.prompt',{sessionId:opened.sessionId,message:'large-turn'})).result.turnId;
  await until(()=>events.some(event=>event.turnId===turn&&event.kind==='completed'));
  assert.equal(events.filter(event=>event.turnId===turn&&['completed','cancelled','error'].includes(event.kind)).length,1);
  assert.ok(events.some(event=>event.turnId===turn&&event.kind==='warning'&&event.text.includes('256 KiB')));
  assert.ok(!events.some(event=>event.kind==='error'||event.kind==='closed'));
  for(let i=0;i<5;i++)assert.equal(await readFile(join(root,`Large${i}.cs`),'utf8'),'b'.repeat(30000));
  assert.deepEqual(await readFile(join(root,'.git','index')),index);assert.equal(await git('rev-parse','HEAD'),head);
  assert.deepEqual((await client.request('changes.list',{sessionId:opened.sessionId})).result.checkpoints,[]);
  const next=(await client.request('chat.prompt',{sessionId:opened.sessionId,message:'continue'})).result.turnId;
  await until(()=>events.some(event=>event.turnId===next&&event.kind==='completed'));
  assert.equal(events.filter(event=>event.turnId===next&&event.kind==='delta').map(event=>event.text).join(''),'next turn completed');
 }finally{client?.close();await daemon?.close();await rm(root,{recursive:true,force:true});}
});
