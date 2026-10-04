import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {startDaemon,PipeClient} from '@piagent/daemon';
const fixture=fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url));
test('authenticated workspace binding isolates IDE sessions and approval changes retain conversation',{skip:process.platform!=='win32',timeout:20000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-binding-')),a=join(root,'A'),b=join(root,'B');await mkdir(a);await mkdir(b);
 const authFile=join(root,'private','token');const daemon=await startDaemon({pipeName:'piagent-binding-'+randomUUID(),secure:{authFile},workspaceRoot:root,omp:{executable:process.execPath,executableArgs:[fixture],cwd:root}});
 const clients=[];
 try {
  const connect=async(caps)=>{const client=await PipeClient.connect(daemon.path,{authFile});clients.push(client);const reply=await client.request('adapter.hello',{protocolVersions:[1],capabilities:caps,requiredCapabilities:caps,adapter:{kind:'test-ide',version:'1',ideVersion:'test',instanceId:randomUUID()}});assert.ok(reply.result,JSON.stringify(reply));return client;};
  const caps=['chat.v1','workspace.read.v1','chat.sessions.v1','workspace.bind.v1','chat.approval.v1'];
  const one=await connect(caps),two=await connect(caps),old=await connect(['chat.v1']);
  assert.equal((await old.request('chat.open',{workspaceUri:pathToFileURL(a).href})).error.code,-32005);
  assert.ok((await one.request('chat.open',{workspaceUri:'https://example.com/'})).error);
  const opened=(await one.request('chat.open',{workspaceUri:pathToFileURL(a).href})).result;assert.equal(opened.workspaceUri,pathToFileURL(a).href);
  const other=(await two.request('chat.open',{workspaceUri:pathToFileURL(b).href})).result;assert.equal(other.workspaceUri,pathToFileURL(b).href);
  const listing=(await two.request('sessions.list')).result.sessions;assert.equal(listing.some(value=>value.savedSessionId===opened.savedSessionId),false);
  let current=opened;
  for(const mode of ['write','yolo','plan','always-ask']) {
   const reply=await one.request('chat.setApproval',{sessionId:current.sessionId,mode});assert.ok(reply.result,JSON.stringify(reply));current=reply.result;
   assert.equal(current.approvalMode,mode);assert.equal(current.savedSessionId,opened.savedSessionId);assert.equal(current.workspaceUri,pathToFileURL(a).href);
   if(mode==='plan')assert.equal(current.writeEnabled,false);
  }
  assert.equal((await one.request('chat.setApproval',{sessionId:current.sessionId,mode:'invalid'})).error.code,-32602);
  assert.equal((await one.request('chat.open',{workspaceUri:pathToFileURL(b).href})).error.code,-32011);
  await one.request('chat.close',{sessionId:current.sessionId});
  const resumed=(await one.request('chat.open',{savedSessionId:opened.savedSessionId})).result;assert.equal(resumed.approvalMode,'always-ask');
 } finally {clients.forEach(value=>value.close());await daemon.close();await rm(root,{recursive:true,force:true});}
});
