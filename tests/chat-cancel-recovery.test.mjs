import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {startDaemon,PipeClient} from '@piagent/daemon';

test('unresponsive native Stop settles checkpoint and timeline before closed, then resumes saved session without replay', {skip:process.platform!=='win32',timeout:20000}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'piagent-cancel-recovery-'));
  const run=promisify(execFile),fixture=fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url));
  const git=async(...args)=>run('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:root,windowsHide:true});
  let daemon,client;
  try {
    await git('init');await writeFile(join(root,'Example.cs'),'class Example {}\r\n');await git('add','Example.cs');await git('commit','-m','Fixture');
    const authFile=join(root,'private','token');
    daemon=await startDaemon({pipeName:'piagent-cancel-recovery-'+randomUUID(),secure:{authFile},workspaceRoot:root,allowWrites:true,omp:{executable:process.execPath,executableArgs:[fixture,'--ignore-abort'],cwd:root,profile:'native',requestTimeoutMs:30000,shutdownTimeoutMs:100}});
    client=await PipeClient.connect(daemon.path,{authFile});
    await client.request('adapter.hello',{protocolVersions:[1],capabilities:['core.ping','chat.v1','chat.sessions.v1','chat.timeline.v1','workspace.read.v1','workspace.edit.v1','omp.controls.v1'],adapter:{kind:'test-ide',version:'test',ideVersion:'test',instanceId:randomUUID()}});
    const events=[];client.on('chat.event',e=>events.push(e));
    const opened=(await client.request('chat.open')).result;assert.equal(opened.messageRestoreEnabled,true);
    const admitted=(await client.request('chat.prompt',{sessionId:opened.sessionId,message:'wait'})).result;
    assert.equal((await client.request('chat.cancel',{sessionId:opened.sessionId,turnId:admitted.turnId})).result.requested,true);
    for(let i=0;i<800&&!events.some(e=>e.kind==='closed');i++)await delay(10);
    const terminal=events.filter(e=>['cancelled','completed','error','closed'].includes(e.kind));
    assert.deepEqual(terminal.map(e=>e.kind),['cancelled','closed'],'turn settlement must precede session retirement even with two async persistence stages');
    assert.equal(terminal[0].turnId,admitted.turnId);assert.equal(terminal[1].turnId,null);
    assert.equal((await client.request('core.ping',{nonce:'after-stop'})).result.pong,true);
    const sessions=(await client.request('sessions.list')).result.sessions;assert.ok(sessions.some(s=>s.savedSessionId===opened.savedSessionId));
    const resumed=(await client.request('chat.open',{savedSessionId:opened.savedSessionId})).result;assert.ok(resumed, 'same connection can reacquire saved session after child retirement');
    assert.ok(resumed.transcript.some(e=>e.role==='status'&&e.text==='cancelled'));
    assert.equal(resumed.transcript.filter(e=>e.role==='user'&&e.text==='wait').length,1,'resume must not replay interrupted prompt');
    events.length=0;assert.equal((await client.request('chat.prompt',{sessionId:resumed.sessionId,message:'local-background'})).result.accepted,true);
    for(let i=0;i<200&&!events.some(e=>e.kind==='completed');i++)await delay(10);
    assert.equal(events.filter(e=>e.kind==='completed').length,1);
    assert.equal(await readFile(join(root,'Example.cs'),'utf8'),'class Example {}\r\n');
  } finally {client?.close();await daemon?.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
