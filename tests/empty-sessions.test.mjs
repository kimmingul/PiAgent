import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionStore} from '../packages/piagent-core/dist/sessions.js';
import {Controller} from '../ui/dist/controller.js';
import {startDaemon,PipeClient} from '@piagent/daemon';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'piagent-empty-'));try{const store=new SessionStore(root);await store.initialize();await fn(store);}finally{await rm(root,{recursive:true,force:true});}}
test('empty sessions are deleted, active sessions protected, and automatic resume skips deleted pointer',()=>fixture(async store=>{
 const first=await store.acquire();const id=first.record.savedSessionId;
 assert.equal((await store.list())[0].deletable,false);
 await assert.rejects(store.deleteEmpty(id),/사용 중/);await first.release();
 const second=await store.acquire();const omp=await store.prepareOmpDirectory(second.record.savedSessionId);
 await writeFile(join(omp,'empty.jsonl'),JSON.stringify({type:'session',version:3})+'\n');await store.bind(second.record,join(omp,'empty.jsonl'));await second.release();
 await store.remember(id);assert.equal((await store.list()).find(s=>s.savedSessionId===id).deletable,true);
 await store.deleteEmpty(id);assert.equal(await store.last(),second.record.savedSessionId);await assert.rejects(store.load(id));
 await store.deleteEmpty(second.record.savedSessionId);assert.equal(await store.last(),undefined);
}));
test('displayed, truncated, and OMP-only history prevent deletion',()=>fixture(async store=>{
 const lease=await store.acquire();const id=lease.record.savedSessionId;lease.append('user','keep me');await lease.save();
 lease.record.transcript=[];await lease.release();await assert.rejects(store.deleteEmpty(id),/기록/);
 const next=await store.acquire();const dir=await store.prepareOmpDirectory(next.record.savedSessionId);
 await writeFile(join(dir,'history.jsonl'),JSON.stringify({type:'message',message:{role:'user',content:'important'}}));await store.bind(next.record,join(dir,'history.jsonl'));await next.release();
 await assert.rejects(store.deleteEmpty(next.record.savedSessionId),/OMP/);assert.equal((await store.list()).find(s=>s.savedSessionId===next.record.savedSessionId).deletable,false);
}));
test('unknown data, malformed IDs, BTW conversations and links are never deleted',()=>fixture(async store=>{
 await assert.rejects(store.deleteEmpty('../outside'),/Invalid/);
 const lease=await store.acquire();const id=lease.record.savedSessionId;await lease.release();
 const extra=join(store.root,id,'important.txt');await writeFile(extra,'keep');await assert.rejects(store.deleteEmpty(id),/추가 데이터/);assert.equal(await readFile(extra,'utf8'),'keep');await rm(extra);
 await mkdir(join(store.root,'btw'));await writeFile(join(store.root,'btw','topic.json'),JSON.stringify({mainSession:id,turns:[{q:'keep'}]}));
 await assert.rejects(store.deleteEmpty(id),/BTW/);await rm(join(store.root,'btw'),{recursive:true});
 const outside=join(store.root,'outside');await mkdir(outside);await writeFile(join(outside,'precious.jsonl'),'keep');
 await symlink(outside,join(store.root,id,'omp'),process.platform==='win32'?'junction':'dir');await assert.rejects(store.deleteEmpty(id),/links/);assert.equal(await readFile(join(outside,'precious.jsonl'),'utf8'),'keep');
}));
test('session list exposes deletion only for eligible inactive rows and refreshes after result or failure',()=>{
 const sent=[];let items=[];const c=new Controller(frame=>sent.push(frame),{emit:()=>{},capabilities:()=>{},list:(_,rows)=>{items=rows;}});
 c.receive({type:'session',sessionId:'s',savedSessionId:'current',sessionsEnabled:true});
 c.receive({type:'sessions',sessions:[{savedSessionId:'empty',title:'Empty',updatedAt:0,deletable:true,empty:true},{savedSessionId:'used',title:'Used',updatedAt:0,deletable:false},{savedSessionId:'current',title:'Active',updatedAt:0,deletable:true,active:true}]});
 assert.equal(typeof items[0].remove,'function');assert.equal(items[1].remove,undefined);assert.equal(items[2].remove,undefined);
 items[0].remove();assert.deepEqual(sent.at(-1),{action:'deleteEmptySession',savedSessionId:'empty',confirmed:true});
 c.receive({type:'operationError',action:'deleteEmptySession',message:'Active'});assert.equal(sent.at(-1).action,'listSessions');
 items[0].remove();c.receive({type:'sessionDeleted',savedSessionId:'empty'});assert.equal(sent.at(-1).action,'listSessions');
});
test('Named Pipe deletion requires negotiated capability, explicit confirmation and an inactive empty session',{skip:process.platform!=='win32',timeout:20000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-empty-rpc-'));let daemon;const clients=[];
 const authFile=join(root,'private','token');
 try{
  daemon=await startDaemon({pipeName:'piagent-empty-'+randomUUID(),secure:{authFile},omp:{executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:root}});
  const connect=async(capabilities)=>{const client=await PipeClient.connect(daemon.path,{authFile});clients.push(client);await client.request('adapter.hello',{protocolVersions:[1],capabilities,adapter:{kind:'test-ide',version:'test',ideVersion:'test',instanceId:randomUUID()}});return client;};
  const c=await connect(['core.ping','chat.v1','chat.sessions.v1']);const opened=(await c.request('chat.open')).result;
  const params={savedSessionId:opened.savedSessionId,confirmed:true};
  assert.ok((await c.request('sessions.deleteEmpty',params)).error);
  await c.request('chat.close',{sessionId:opened.sessionId});
  const limited=await connect(['core.ping','chat.v1']);assert.ok((await limited.request('sessions.deleteEmpty',params)).error);
  assert.ok((await c.request('sessions.deleteEmpty',{savedSessionId:opened.savedSessionId})).error);
  assert.equal((await c.request('sessions.list')).result.sessions[0].deletable,true);
  assert.equal((await c.request('sessions.deleteEmpty',params)).result.deleted,true);
  assert.deepEqual((await c.request('sessions.list')).result.sessions,[]);
 }finally{clients.forEach(client=>client.close());await daemon?.close();await rm(root,{recursive:true,force:true});}
});
test('VSIX and RAD packages include every static TypeScript module imported by the shared UI',async()=>{
 const vs=await readFile(new URL('../adapters/visualstudio/PiAgent.Vsix/PiAgent.Vsix.csproj',import.meta.url),'utf8');
 const rad=await readFile(new URL('../scripts/build-adapters.ps1',import.meta.url),'utf8');
 const visited=new Set();async function visit(name){if(visited.has(name))return;visited.add(name);
  const source=await readFile(new URL('../ui/dist/'+name,import.meta.url),'utf8');
  for(const match of source.matchAll(/from\s+['"]\.\/([^'"]+\.js)['"]/g))await visit(match[1]);}
 await visit('bridge.js');for(const name of visited){assert.ok(vs.includes('ui\\dist\\'+name),`VSIX missing ${name}`);assert.ok(rad.includes('ui/dist/'+name),`RAD missing ${name}`);}
});
