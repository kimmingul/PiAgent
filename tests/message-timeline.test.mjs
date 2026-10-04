import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {startDaemon,PipeClient} from '@piagent/daemon';
import {createConnection} from 'node:net';
const execute=promisify(execFile),fixture=fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url));
const wait=async(fn)=>{for(let i=0;i<500;i++){const value=fn();if(value)return value;await delay(10);}assert.fail('event timeout');};
test('cold-start probes that disconnect before authentication leave the broker available',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-probe-')),authFile=join(root,'private','token'),daemon=await startDaemon({pipeName:'piagent-probe-'+randomUUID(),secure:{authFile}});let client;
 try {
  for(let i=0;i<50;i++){await new Promise((resolve,reject)=>{const probe=createConnection(daemon.path);probe.on('error',reject);probe.on('connect',()=>{probe.destroy();resolve();});});await delay(5);}
  client=await PipeClient.connect(daemon.path,{authFile});const hello=await client.request('adapter.hello',{protocolVersions:[1],capabilities:['core.ping'],adapter:{kind:'test',version:'test',ideVersion:'test',instanceId:randomUUID()}});assert.ok(hello.result);assert.ok((await client.request('core.ping',{nonce:'alive'})).result);
 }finally{client?.close();await daemon.close();await rm(root,{recursive:true,force:true});}
});
test('message restore previews exact dirty bytes, restores conversation before prompt, preserves original and rejects stale changes',{skip:process.platform!=='win32',timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-message-'));let daemon,client;
 const git=async(...args)=>(await execute('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:root,windowsHide:true})).stdout;
 try{await git('init');await writeFile(join(root,'Example.cs'),'original\r\n');await git('add','.');await git('commit','-m','Fixture');await writeFile(join(root,'Example.cs'),'user dirty\r\n');const head=await git('rev-parse','HEAD'),index=await git('ls-files','--stage');
 const authFile=join(root,'private','token');daemon=await startDaemon({pipeName:'piagent-message-'+randomUUID(),secure:{authFile},workspaceRoot:root,allowWrites:true,omp:{executable:process.execPath,executableArgs:[fixture],cwd:root}});client=await PipeClient.connect(daemon.path,{authFile});
 await client.request('adapter.hello',{protocolVersions:[1],capabilities:['chat.v1','chat.sessions.v1','chat.timeline.v1','workspace.read.v1','workspace.edit.v1','workspace.edit.batch.v1','omp.controls.v1'],adapter:{kind:'test-ide',version:'test',ideVersion:'test',instanceId:randomUUID()}});
 const opened=(await client.request('chat.open')).result;assert.equal(opened.messageRestoreEnabled,true);const sid=opened.sessionId,frames=[];client.on('chat.event',frame=>frames.push(frame));
 await client.request('chat.prompt',{sessionId:sid,message:'propose-edit'});const approval=(await wait(()=>frames.find(frame=>frame.kind==='approval_requested'))).approval;
 await client.request('changes.decide',{sessionId:sid,proposalId:approval.proposalId,revision:approval.revision,decision:'approve'});await wait(()=>frames.some(frame=>frame.kind==='completed'));
 const checkpoint=frames.find(frame=>frame.frame?.event?.t==='checkpoint').frame.event;assert.equal(checkpoint.seq,1);
 const changedBytes=await readFile(join(root,'Example.cs'));
 const preview=(await client.request('chat.previewMessageRestore',{sessionId:sid,seq:1,branch:true})).result;assert.ok(preview.diff.includes('user dirty'));assert.equal(preview.branch,true);
 assert.ok(preview.checkedPaths.includes('Example.cs'));
 assert.ok((await client.request('chat.restoreMessage',{sessionId:sid,messageRestoreId:preview.messageRestoreId,revision:'wrong'})).error);
 await writeFile(join(root,'Example.cs'),'manual later\n');assert.ok((await client.request('chat.restoreMessage',{sessionId:sid,messageRestoreId:preview.messageRestoreId,revision:preview.revision})).error);assert.equal(await readFile(join(root,'Example.cs'),'utf8'),'manual later\n');
 await writeFile(join(root,'Example.cs'),changedBytes);
 const ready=(await client.request('chat.previewMessageRestore',{sessionId:sid,seq:1,branch:true})).result;
 const result=(await client.request('chat.restoreMessage',{sessionId:sid,messageRestoreId:ready.messageRestoreId,revision:ready.revision})).result;
 assert.ok(result.savedSessionId!==opened.savedSessionId);assert.deepEqual(result.transcript,[]);assert.equal(result.restoredDraft,'propose-edit');assert.equal(await readFile(join(root,'Example.cs'),'utf8'),'user dirty\r\n');assert.equal(await git('rev-parse','HEAD'),head);assert.equal(await git('ls-files','--stage'),index);
 frames.length=0;await client.request('chat.prompt',{sessionId:result.sessionId,message:'hello'});await wait(()=>frames.some(frame=>frame.kind==='completed'));
 const second=(await client.request('chat.previewMessageRestore',{sessionId:result.sessionId,seq:1,branch:false})).result;
 const restored=(await client.request('chat.restoreMessage',{sessionId:result.sessionId,messageRestoreId:second.messageRestoreId,revision:second.revision})).result;
 assert.deepEqual(restored.transcript,[]);assert.equal(restored.restoredDraft,'hello');assert.ok(!restored.restoreError);
 await client.request('chat.close',{sessionId:restored.sessionId});const original=(await client.request('chat.open',{savedSessionId:opened.savedSessionId})).result;assert.ok(original.transcript.some(line=>line.role==='user'&&line.text==='propose-edit'));assert.equal(original.transcript.find(line=>line.role==='user').seq,1);
 }finally{client?.close();await daemon?.close();await rm(root,{recursive:true,force:true});}
});
