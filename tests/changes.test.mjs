import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,mkdir,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {WorkspaceReader,WorkspaceChanges} from '@piagent/core';
import {startDaemon,PipeClient} from '@piagent/daemon';
const execute=promisify(execFile), windows={skip:process.platform!=='win32',timeout:30000};
const before='int Double(int value) { return value * 2; }\r\n';
const after='int Double(int value) { return value * 3; }\r\n';
const git=async(root,...args)=>(await execute('git',['-c','user.name=PiAgent Test','-c','user.email=test@localhost',...args],{cwd:root,windowsHide:true})).stdout.trim();
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'piagent-changes-'));
 await git(root,'init');await writeFile(join(root,'Example.cs'),before);await git(root,'add','Example.cs');await git(root,'commit','-m','Initial fixture');
 const reader=await WorkspaceReader.create(root),changes=await WorkspaceChanges.create(reader);
 return {root,reader,changes,async close(){assert.ok(root.startsWith(join(tmpdir(),'piagent-changes-')));await rm(root,{recursive:true,force:true});}};
}
const proposal=(changes,content=after,path='Example.cs')=>changes.propose({path,content,reason:'Change test'},new AbortController().signal);

test('oversized observed turns preserve files and Git state with an explicit nonfatal checkpoint result',windows,async()=>{
 const env=await setup();try{
   for(let i=0;i<9;i++)await writeFile(join(env.root,`Extra${i}.cs`),'before\n');
   await git(env.root,'add','.');await git(env.root,'commit','-m','Large turn fixture');
   const snapshot=await env.changes.beginTurn(),index=await readFile(join(env.root,'.git','index')),head=await git(env.root,'rev-parse','HEAD');
   for(let i=0;i<9;i++)await writeFile(join(env.root,`Extra${i}.cs`),'after\n');
   const result=await env.changes.observeTurn(snapshot);
   assert.equal(result.recorded,false);assert.equal(result.reason,'limit');assert.equal(result.changedFiles,9);
   assert.match(result.warning,/작업 중단을 뜻하지 않습니다/);assert.equal((await env.changes.list()).length,0);
   for(let i=0;i<9;i++)assert.equal(await readFile(join(env.root,`Extra${i}.cs`),'utf8'),'after\n');
   assert.deepEqual(await readFile(join(env.root,'.git','index')),index);assert.equal(await git(env.root,'rev-parse','HEAD'),head);
   // The byte limit also applies with at most eight changed files.
   for(let i=0;i<5;i++)await writeFile(join(env.root,`Extra${i}.cs`),'a'.repeat(30000));
   const large=await env.changes.beginTurn();
   for(let i=0;i<5;i++)await writeFile(join(env.root,`Extra${i}.cs`),'b'.repeat(30000));
   const sizeResult=await env.changes.observeTurn(large);assert.equal(sizeResult.reason,'limit');assert.equal(sizeResult.changedFiles,5);assert.equal(sizeResult.bytes,300000);
 }finally{await env.close();}
});

test('turn observation reuses the exact approved checkpoint but records subsequent native changes',windows,async()=>{
 const env=await setup();try{
  await writeFile(join(env.root,'Second.cs'),'second\r\n');await git(env.root,'add','Second.cs');await git(env.root,'commit','-m','Second');
  const snapshot=await env.changes.beginTurn();
  const edit=await env.changes.proposeMany({files:[{path:'Example.cs',content:after},{path:'Second.cs',content:'changed second\n'}],reason:'approved batch'},new AbortController().signal);
  const applied=await env.changes.apply(edit,new AbortController().signal);
  const observed=await env.changes.observeTurn(snapshot);assert.equal(observed.recorded,false);assert.equal(observed.alreadyRecorded,true);assert.equal(observed.checkpointId,applied.checkpointId);assert.equal((await env.changes.list()).length,1);
  await writeFile(join(env.root,'Second.cs'),'native additional edit\r\n');const extra=await env.changes.observeTurn(snapshot);assert.equal(extra.recorded,true);assert.equal((await env.changes.list()).length,2);
  const preview=await env.changes.previewRestore(extra.checkpointId);await env.changes.restore(extra.checkpointId,preview.revision);
  assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),before);assert.equal(await readFile(join(env.root,'Second.cs'),'utf8'),'second\r\n');
  // An identical later turn must not be mistaken for an earlier historical checkpoint.
  const later=await env.changes.beginTurn();await writeFile(join(env.root,'Example.cs'),after);await writeFile(join(env.root,'Second.cs'),'changed second\n');assert.equal((await env.changes.observeTurn(later)).recorded,true);
 }finally{await env.close();}
});

test('multi-file approvals validate the whole batch, restore raw bytes and roll back a failed second write',windows,async()=>{
 const env=await setup();try{
  await writeFile(join(env.root,'Second.cs'),'\ufeffsecond\r\n');await git(env.root,'add','Second.cs');await git(env.root,'commit','-m','Second fixture');
  const args={files:[{path:'Example.cs',content:after},{path:'Second.cs',content:'updated second\n'}],reason:'Two-file change'}, signal=new AbortController().signal;
  let edit=await env.changes.proposeMany(args,signal);
  await writeFile(join(env.root,'Second.cs'),'later user edit');await assert.rejects(env.changes.apply(edit,signal),/changed after preview/);
  assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),before);
  await writeFile(join(env.root,'Second.cs'),'\ufeffsecond\r\n');edit=await env.changes.proposeMany(args,signal);
  const original=env.changes.replace.bind(env.changes);let calls=0;
  env.changes.replace=async(...values)=>{if(++calls===2)throw new Error('Injected second-file I/O failure');return original(...values);};
  await assert.rejects(env.changes.apply(edit,signal),/rolled back/);assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),before);assert.equal(await readFile(join(env.root,'Second.cs'),'utf8'),'\ufeffsecond\r\n');
  env.changes.replace=original;const applied=await env.changes.apply(await env.changes.proposeMany(args,signal),signal);
  const restarted=await WorkspaceChanges.create(env.reader);const preview=await restarted.previewRestore(applied.checkpointId);assert.equal(preview.files.length,2);assert.match(preview.diff,/Second.cs/);
  await restarted.restore(applied.checkpointId,preview.revision);assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),before);assert.equal(await readFile(join(env.root,'Second.cs'),'utf8'),'\ufeffsecond\r\n');
  await assert.rejects(env.changes.proposeMany({...args,files:[args.files[0],args.files[0]]},signal),/Duplicate/);
 }finally{await env.close();}
});
test('approved edits preserve dirty content, user index/HEAD, raw CRLF/BOM and survive restart for restore',windows,async()=>{
 const env=await setup();try{
  await writeFile(join(env.root,'Example.cs'),'staged\n');await git(env.root,'add','Example.cs');
  const dirty='\ufeff// 사용자 🚀\r\n'+before;await writeFile(join(env.root,'Example.cs'),dirty);
  const index=await readFile(join(env.root,'.git','index')),head=await git(env.root,'rev-parse','HEAD');
  const edit=await proposal(env.changes);assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),dirty);
  const result=await env.changes.apply(edit,new AbortController().signal);assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),after);
  assert.equal((await git(env.root,'for-each-ref','--format=%(refname)','refs/piagent/checkpoints')).split('\n').length,2);
  const restarted=await WorkspaceChanges.create(env.reader);assert.equal((await restarted.list())[0].checkpointId,result.checkpointId);
  const preview=await restarted.previewRestore(result.checkpointId);assert.ok(preview.diff.includes('⟨BOM⟩'));assert.ok(preview.diff.includes('␍'));
  await restarted.restore(result.checkpointId,preview.revision);assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),dirty);
  assert.deepEqual(await readFile(join(env.root,'.git','index')),index);assert.equal(await git(env.root,'rev-parse','HEAD'),head);
  await assert.rejects(restarted.restore(result.checkpointId,preview.revision),/not restorable/);
 }finally{await env.close();}
});
test('stale apply/restore, unknown files, excluded paths, malformed text and expired proposals cannot overwrite files',windows,async()=>{
 const env=await setup();try{
  const edit=await proposal(env.changes);await writeFile(join(env.root,'Example.cs'),'new user edit');
  await assert.rejects(env.changes.apply(edit,new AbortController().signal),/changed after preview/);assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),'new user edit');
  await writeFile(join(env.root,'untracked.cs'),'hello');await assert.rejects(proposal(env.changes,'change','untracked.cs'),/Git-tracked/);
  for(const path of ['../outside','.git/config','Example.cs:stream'])await assert.rejects(proposal(env.changes,'change',path));
  for(const content of ['x'.repeat(32769),'\0','\ud800'])await assert.rejects(proposal(env.changes,content),/Invalid edit proposal/);
  await writeFile(join(env.root,'Example.cs'),before);const expired=await proposal(env.changes);expired.expiresAt=0;
  await assert.rejects(env.changes.apply(expired,new AbortController().signal),/expired/);
  const result=await env.changes.apply(await proposal(env.changes),new AbortController().signal);const preview=await env.changes.previewRestore(result.checkpointId);
  await assert.rejects(env.changes.restore(result.checkpointId,'wrong'),/stale/);
  await writeFile(join(env.root,'Example.cs'),'later user edit');await assert.rejects(env.changes.restore(result.checkpointId,preview.revision),/later edits/);
  assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),'later user edit');
 }finally{await env.close();}
});
test('checkpoint operations bypass repository hooks and respect cross-process lock and file links',windows,async()=>{
 const env=await setup();try{
  await mkdir(join(env.root,'hooks'));await writeFile(join(env.root,'hooks','reference-transaction'),'#!/bin/sh\necho ran > hook-ran\n');await git(env.root,'config','core.hooksPath',join(env.root,'hooks'));
  const edit=await proposal(env.changes);const lock=join(env.root,'.git','piagent','checkpoints','write.lock');await writeFile(lock,'fixture');
  await assert.rejects(env.changes.apply(edit,new AbortController().signal),/lock is busy/);await rm(lock);
  await env.changes.apply(edit,new AbortController().signal);await assert.rejects(readFile(join(env.root,'hook-ran')),{code:'ENOENT'});
  await link(join(env.root,'Example.cs'),join(env.root,'linked.cs'));await assert.rejects(proposal(env.changes,before),/unlinked/);
 }finally{await env.close();}
});
test('interrupted checkpoint metadata is classified from disk without overwriting uncertain content',windows,async()=>{
 const env=await setup();try{
  const result=await env.changes.apply(await proposal(env.changes),new AbortController().signal);
  const metadata=join(env.root,'.git','piagent','checkpoints',result.checkpointId+'.json');const record=JSON.parse(await readFile(metadata,'utf8'));
  record.state='prepared';await writeFile(metadata,JSON.stringify(record));
  const restarted=await WorkspaceChanges.create(env.reader);assert.equal((await restarted.list())[0].state,'applied');
  const preview=await restarted.previewRestore(result.checkpointId);await restarted.restore(result.checkpointId,preview.revision);
  record.state='restoring';await writeFile(metadata,JSON.stringify(record));assert.equal((await restarted.list())[0].state,'restored');
  await writeFile(join(env.root,'Example.cs'),'uncertain partial content');assert.equal((await restarted.list())[0].state,'recoveryRequired');
  await assert.rejects(restarted.previewRestore(result.checkpointId),/later edits/);assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),'uncertain partial content');
 }finally{await env.close();}
});
test('writes require secure opt-in and approval capability; reject/cancel/foreign approval leave content unchanged',windows,async()=>{
 const env=await setup();let daemon;const clients=[];
 try{
  const omp={executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:env.root};
  await assert.rejects(startDaemon({workspaceRoot:env.root,omp,allowWrites:true}),/secure transport/);
  const authFile=join(env.root,'private','token');daemon=await startDaemon({pipeName:`piagent-edit-${randomUUID()}`,workspaceRoot:env.root,omp,allowWrites:true,secure:{authFile}});
  const connect=async(write=true,batch=false)=>{const client=await PipeClient.connect(daemon.path,{authFile});clients.push(client);
   const caps=['chat.v1','core.ping','workspace.read.v1',...(write?['workspace.edit.v1']:[]),...(batch?['workspace.edit.batch.v1']:[])];
   const response=await client.request('adapter.hello',{protocolVersions:[1],capabilities:caps,adapter:{kind:'test-ide',version:'test',ideVersion:'test',instanceId:randomUUID()}});assert.deepEqual(response.result.capabilities,caps);
   const open=(await client.request('chat.open')).result;return{client,id:open.sessionId,open};};
  const old=await connect(false);assert.equal(old.open.writeEnabled,false);assert.equal((await old.client.request('changes.list',{sessionId:old.id})).error.code,-32005);
  const owner=await connect(),other=await connect();assert.equal(owner.open.readOnly,false);
  const events=[];owner.client.on('chat.event',event=>events.push(event));
  const wait=async(kind)=>{for(let i=0;i<500;i++){const found=events.find(e=>e.kind===kind);if(found)return found;await delay(10);}assert.fail('Missing event '+kind);};
  const start=async()=>{events.length=0;await owner.client.request('chat.prompt',{sessionId:owner.id,message:'propose-edit'});return(await wait('approval_requested')).approval;};
  let approval=await start();assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),before);assert.ok(approval.diff.includes('-int Double'));assert.ok(approval.diff.includes('+int Double'));
  assert.ok((await other.client.request('changes.decide',{sessionId:other.id,proposalId:approval.proposalId,revision:approval.revision,decision:'approve'})).error);
  assert.ok((await owner.client.request('changes.decide',{sessionId:owner.id,proposalId:approval.proposalId,revision:'wrong',decision:'approve'})).error);
  await owner.client.request('changes.decide',{sessionId:owner.id,proposalId:approval.proposalId,revision:approval.revision,decision:'reject'});await wait('completed');assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),before);
  approval=await start();await owner.client.request('chat.cancel',{sessionId:owner.id,turnId:events.find(e=>e.kind==='started').turnId});await wait('cancelled');
  assert.ok((await owner.client.request('changes.decide',{sessionId:owner.id,proposalId:approval.proposalId,revision:approval.revision,decision:'approve'})).error);assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),before);
  approval=await start();const applied=await owner.client.request('changes.decide',{sessionId:owner.id,proposalId:approval.proposalId,revision:approval.revision,decision:'approve'});assert.equal(applied.result.applied,true);await wait('completed');
  assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),after);
  const restore=(await owner.client.request('changes.previewRestore',{sessionId:owner.id,checkpointId:applied.result.checkpointId})).result;
  assert.equal((await owner.client.request('changes.restore',{sessionId:owner.id,checkpointId:applied.result.checkpointId,revision:restore.revision})).result.restored,true);
  assert.equal(await readFile(join(env.root,'Example.cs'),'utf8'),before);
  await writeFile(join(env.root,'Second.cs'),'second\n');await git(env.root,'add','Second.cs');await git(env.root,'commit','-m','Second');
  const batch=await connect(true,true),batchEvents=[];batch.client.on('chat.event',e=>batchEvents.push(e));
  await batch.client.request('chat.prompt',{sessionId:batch.id,message:'propose-batch'});
  for(let i=0;i<300&&!batchEvents.some(e=>e.kind==='approval_requested');i++)await delay(10);
  const batchApproval=batchEvents.find(e=>e.kind==='approval_requested').approval;assert.equal(batchApproval.files.length,2);
  const batchResult=(await batch.client.request('changes.decide',{sessionId:batch.id,proposalId:batchApproval.proposalId,revision:batchApproval.revision,decision:'approve'})).result;
  for(let i=0;i<300&&!batchEvents.some(e=>e.kind==='completed');i++)await delay(10);
  assert.ok(!(await owner.client.request('changes.list',{sessionId:owner.id})).result.checkpoints.some(c=>c.checkpointId===batchResult.checkpointId));
  assert.equal((await owner.client.request('changes.previewRestore',{sessionId:owner.id,checkpointId:batchResult.checkpointId})).error.code,-32005);
  const batchPreview=(await batch.client.request('changes.previewRestore',{sessionId:batch.id,checkpointId:batchResult.checkpointId})).result;
  assert.equal((await batch.client.request('changes.restore',{sessionId:batch.id,checkpointId:batchResult.checkpointId,revision:batchPreview.revision})).result.restored,true);
  assert.equal(await readFile(join(env.root,'Second.cs'),'utf8'),'second\n');
 }finally{for(const client of clients)client.close();await daemon?.close();await env.close();}
});
