import test from 'node:test';
import assert from 'node:assert/strict';
import {fork,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,readFile,writeFile,unlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {SessionStore,ChatSession} from '@piagent/core';
const windows={skip:process.platform!=='win32',timeout:20000};
const worker=fileURLToPath(new URL('./fixtures/session-owner.mjs',import.meta.url));
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill();await done;}
async function owner(root,id='',pid=''){
  const child=fork(worker,[root,id,String(pid)],{silent:true,execArgv:[]});
  const [result]=await once(child,'message');return {child,result};
}
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'piagent-recovery-'));try{const store=new SessionStore(root);await store.initialize();await fn(store,root);}finally{await rm(root,{recursive:true,force:true});}}

test('abrupt owner death is recoverable and competing processes have only one winner',windows,()=>fixture(async(store,root)=>{
  const first=await owner(root);const id=first.result.id;
  const before=JSON.parse(await readFile(join(root,id,'session.json'),'utf8'));
  await assert.rejects(store.acquire(id),/already active/);
  await stop(first.child);
  assert.equal((await store.list())[0].active,false);
  const attempts=await Promise.all(Array.from({length:6},()=>owner(root,id)));
  try{
    assert.equal(attempts.filter(value=>value.result.id===id).length,1);
    assert.ok(attempts.filter(value=>value.result.error).every(value=>/already active/.test(value.result.error)),JSON.stringify(attempts.map(value=>value.result)));
    assert.equal((await store.load(id)).transcript[0].text,before.transcript[0].text);
  }finally{await Promise.all(attempts.map(value=>stop(value.child)));}
  const lease=await store.acquire(id);await lease.release();
}));

test('an orphaned OMP child protects the conversation until it also exits',windows,()=>fixture(async(store,root)=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  const first=await owner(root,'',child.pid);const id=first.result.id;
  try{await stop(first.child);await assert.rejects(store.acquire(id),/already active/);assert.equal((await store.list())[0].active,true);}
  finally{await stop(child);await stop(first.child);}
  const lease=await store.acquire(id);await lease.release();
}));

test('legacy, malformed, linked and interrupted-spawn markers are never silently discarded',windows,()=>fixture(async(store,root)=>{
  const lease=await store.acquire(),id=lease.record.savedSessionId;await lease.release();
  const path=join(root,id,'active.lock');
  for(const content of ['', '{broken']){
    await writeFile(path,content);await assert.rejects(store.acquire(id),/inspection/);assert.equal(await readFile(path,'utf8'),content);await unlink(path);
  }
  const first=await owner(root,id);await stop(first.child);
  const value=JSON.parse((await readFile(path,'utf8')).trim().split('\n').at(-1));value.starting=true;await writeFile(path,JSON.stringify(value)+'\n{"partial":');
  await assert.rejects(store.acquire(id),/inspection/);
  value.starting=false;await writeFile(path,JSON.stringify(value)+'\n');await link(path,join(root,'outside.lock'));
  await assert.rejects(store.acquire(id),/inspection/);
  await unlink(join(root,'outside.lock'));const resumed=await store.acquire(id);await resumed.release();
}));

test('preference validation failure releases ownership and permits retry on the same connection',()=>fixture(async(store,root)=>{
  const lease=await store.acquire(),id=lease.record.savedSessionId;await lease.release();await store.remember(id);
  const prefs=join(root,'preferences.json');await writeFile(prefs,'{bad');
  const chat=new ChatSession({executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:root},()=>{},undefined,undefined,{sessions:store});
  try{
    await assert.rejects(chat.handle('chat.open',{resumeLast:true},false,false,true));
    assert.equal((await store.list())[0].active,false);await unlink(prefs);
    const opened=await chat.handle('chat.open',{resumeLast:true},false,false,true);assert.equal(opened.savedSessionId,id);
  }finally{await chat.dispose();}
}));

test('disconnect during asynchronous lease acquisition waits for startup cleanup', {timeout:10000},()=>fixture(async(store,root)=>{
  let entered,proceed;
  const acquiring=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{proceed=resolve;});
  const acquire=store.acquire.bind(store);store.acquire=async(...args)=>{entered();await gate;return acquire(...args);};
  const chat=new ChatSession({executable:process.execPath,cwd:root},()=>{},undefined,undefined,{sessions:store});
  const opening=chat.handle('chat.open',{},false,false,true);const rejected=assert.rejects(opening,/closed during startup/);
  await acquiring;const disposal=chat.dispose();proceed();await Promise.all([rejected,disposal]);
  assert.equal((await store.list())[0].active,false);
}));

test('a new prompt after cancellation carries current recovery context without replaying the old request',{timeout:10000},()=>fixture(async(store,root)=>{
  const events=[];
  const chat=new ChatSession({executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:root},event=>events.push(event),undefined,undefined,{sessions:store});
  try{
    const opened=await chat.handle('chat.open',{},false,false,true);
    const first=await chat.handle('chat.prompt',{sessionId:opened.sessionId,message:'wait'},false,false,true);
    await chat.handle('chat.cancel',{sessionId:opened.sessionId,turnId:first.turnId},false,false,true);
    for(let i=0;i<200&&!events.some(e=>e.kind==='cancelled');i++)await delay(10);
    assert.ok(events.some(e=>e.kind==='cancelled'));
    const second=await chat.handle('chat.prompt',{sessionId:opened.sessionId,message:'PIAGENT_ECHO_PROMPT current task'},false,false,true);
    for(let i=0;i<200&&!events.some(e=>e.kind==='completed'&&e.turnId===second.turnId);i++)await delay(10);
    const prompt=events.filter(e=>e.kind==='delta'&&e.turnId===second.turnId).map(e=>e.text).join('');
    assert.match(prompt,/previous user turn was cancelled/);
    assert.match(prompt,/PIAGENT_ECHO_PROMPT current task/);
    assert.match(prompt,/Do not replay any previous mutation/);
    const failed=await chat.handle('chat.prompt',{sessionId:opened.sessionId,message:'provider-error'},false,false,true);
    for(let i=0;i<200&&!events.some(e=>e.kind==='error'&&e.turnId===failed.turnId);i++)await delay(10);
    assert.ok(events.some(e=>e.kind==='error'&&e.turnId===failed.turnId));
    const fresh=await chat.handle('chat.prompt',{sessionId:opened.sessionId,message:'PIAGENT_ECHO_PROMPT fresh task'},false,false,true);
    for(let i=0;i<200&&!events.some(e=>e.kind==='completed'&&e.turnId===fresh.turnId);i++)await delay(10);
    const afterError=events.filter(e=>e.kind==='delta'&&e.turnId===fresh.turnId).map(e=>e.text).join('');
    assert.match(afterError,/previous user turn ended with an error/);
    assert.match(afterError,/PIAGENT_ECHO_PROMPT fresh task/);
  }finally{await chat.dispose();}
}));

test('late idle extension frames cannot change the draft or launch a URL', {timeout:5000},async()=>{
  const events=[];
  const chat=new ChatSession({executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:process.cwd()},event=>events.push(event));
  try{
    const opened=await chat.handle('chat.open',{},false,false,false,false,false,true);
    const turn=await chat.handle('chat.prompt',{sessionId:opened.sessionId,message:'late-idle-ui'},false,false,false,false,false,true);
    for(let i=0;i<200&&!events.some(event=>event.kind==='completed'&&event.turnId===turn.turnId);i++)await delay(10);
    assert.ok(events.some(event=>event.kind==='completed'&&event.turnId===turn.turnId));
    await delay(80);
    const requests=events.filter(event=>event.kind==='omp_event'&&event.frame?.type==='extension_ui_request').map(event=>event.frame.method);
    assert.deepEqual(requests,['notify']);
  }finally{await chat.dispose();}
});
