import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {SessionStore} from '@piagent/core';
import {startDaemon,PipeClient} from '@piagent/daemon';
const windows={skip:process.platform!=='win32',timeout:20000};
test('private session leases reject duplicate owners, malformed IDs and linked OMP files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-sessions-'));
 try{const store=new SessionStore(root);await store.initialize();const lease=await store.acquire(),id=lease.record.savedSessionId;
  await assert.rejects(store.acquire(id),/already active/);await assert.rejects(store.load('../outside'),/Invalid saved session ID/);
  await mkdir(store.ompDirectory(id));const file=join(store.ompDirectory(id),'session.jsonl');await writeFile(file,'{}\n');
  await store.bind(lease.record,file);lease.append('user','안녕 🚀');await lease.release();
  const reopened=await store.acquire(id);assert.equal(reopened.record.transcript[0].text,'안녕 🚀');await reopened.release();
  await link(file,join(root,'linked.jsonl'));await assert.rejects(store.load(id),/Invalid OMP session file/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('secure daemon restart resumes OMP conversation, isolates owners and normalizes usage',windows,async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-sessions-'));let daemon;const clients=[];
 const authFile=join(root,'private','token'),pipeName='piagent-sessions-'+randomUUID();
 const opts={pipeName,secure:{authFile},omp:{executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:root}};
 const connect=async(caps=['core.ping','chat.v1','chat.sessions.v1','chat.usage.v1'])=>{const c=await PipeClient.connect(daemon.path,{authFile});clients.push(c);
  assert.ok((await c.request('adapter.hello',{protocolVersions:[1],capabilities:caps,adapter:{kind:'test-ide',version:'test',ideVersion:'test',instanceId:randomUUID()}})).result);return c;};
 const wait=async(events)=>{for(let i=0;i<300&&!events.some(e=>e.kind==='completed');i++)await delay(10);assert.ok(events.some(e=>e.kind==='completed'));};
 try{daemon=await startDaemon(opts);const c=await connect(),open=(await c.request('chat.open')).result;
  assert.equal(open.sessionsEnabled,true);assert.ok(open.savedSessionId);const events=[];c.on('chat.event',e=>events.push(e));
  await c.request('chat.prompt',{sessionId:open.sessionId,message:'remember PiAgent 42'});await wait(events);
  const other=await connect();assert.ok((await other.request('chat.open',{savedSessionId:open.savedSessionId})).error);
  const usage=(await c.request('chat.usage',{sessionId:open.sessionId})).result;assert.equal(usage.tokens.total,30);assert.equal(usage.tokens.reasoning,null);assert.equal(usage.cost,0.004);assert.equal(usage.providerLimits.limits[0].usedFraction,0.25);
  clients.forEach(v=>v.close());await daemon.close();daemon=await startDaemon(opts);
  const resumed=await connect();assert.equal((await resumed.request('sessions.list')).result.sessions[0].savedSessionId,open.savedSessionId);
  const restored=(await resumed.request('chat.open',{savedSessionId:open.savedSessionId})).result;
  assert.notEqual(restored.sessionId,open.sessionId);assert.equal(restored.transcript[0].text,'remember PiAgent 42');
  const more=[];resumed.on('chat.event',e=>more.push(e));await resumed.request('chat.prompt',{sessionId:restored.sessionId,message:'recall'});await wait(more);
  assert.equal(more.filter(e=>e.kind==='delta').map(e=>e.text).join(''),'remember PiAgent 42');
  const old=await connect(['core.ping','chat.v1']);assert.ok((await old.request('sessions.list')).error);
  assert.ok((await old.request('chat.open',{savedSessionId:open.savedSessionId})).error);
 }finally{clients.forEach(c=>c.close());await daemon?.close();await rm(root,{recursive:true,force:true});}
});
