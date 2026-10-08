import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ChatSession,SessionStore,WorkspaceReader} from '@piagent/core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TurnProgress} from '../packages/piagent-core/dist/turn-progress.js';

const options={executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:process.cwd(),profile:'native'};
const terminal=e=>['completed','cancelled','error'].includes(e.kind);
async function until(predicate){for(let n=0;n<300&&!predicate();n++)await delay(10);assert.ok(predicate(),'Expected event did not arrive');}
async function nativeChat(t,events){
  const root=await mkdtemp(join(tmpdir(),'piagent-retry-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const sessions=new SessionStore(join(root,'sessions'));await sessions.initialize();
  const chat=new ChatSession({...options,cwd:root},e=>events.push(e),new WorkspaceReader(root),undefined,{sessions});
  const opened=await chat.handle('chat.open',{},true,true,true,false,false,true);
  return {chat,...opened,sessions};
}

test('native provider retry retains ownership, tool events and final answer; completes once',async t=>{
  const events=[];const {chat,sessionId,savedSessionId,sessions}=await nativeChat(t,events);
  try {
    await chat.handle('chat.prompt',{sessionId,message:'retry-success'});
    await until(()=>events.some(e=>e.frame?.event?.level==='retry'));
    assert.equal(events.filter(terminal).length,0);
    await assert.rejects(chat.handle('chat.prompt',{sessionId,message:'duplicate'}),/running/);
    await assert.rejects(chat.handle('chat.open',{}),/already open/i);
    await until(()=>events.some(e=>e.kind==='completed'));
    assert.deepEqual(events.filter(terminal).map(e=>e.kind),['completed']);
    assert.equal(events.filter(e=>e.kind==='delta').map(e=>e.text).join(''),'Recovered final answer');
    assert.ok(events.some(e=>e.frame?.event?.t==='toolEnd'));
    await until(()=>events.some(e=>e.kind==='completed'));
    await chat.handle('chat.prompt',{sessionId,message:'local'});
    await until(()=>events.filter(e=>e.kind==='completed').length===2);
    assert.equal(events.filter(e=>e.kind==='completed').length,2);
  }finally{await chat.dispose();}
  const saved=await sessions.load(savedSessionId);
  assert.ok(saved.transcript.some(e=>e.role==='assistant'&&e.text==='Recovered final answer'));
  assert.ok(!saved.transcript.some(e=>e.role==='status'&&e.text.startsWith('error')));
});

test('native local command acknowledgement does not release continuing background work',async t=>{
 const events=[];const {chat,sessionId}=await nativeChat(t,events);
 try {
   await chat.handle('chat.prompt',{sessionId,message:'local-background'});
   assert.equal(events.filter(terminal).length,0);
   await assert.rejects(chat.handle('chat.prompt',{sessionId,message:'duplicate'}),/running/);
   await until(()=>events.some(e=>e.kind==='completed'));
   assert.deepEqual(events.filter(terminal).map(e=>e.kind),['completed']);
   assert.equal(events.filter(e=>e.kind==='delta').map(e=>e.text).join(''),'Background work completed');
 }finally{await chat.dispose();}
});

test('native retry exhaustion waits for settlement and retains the final provider error',async t=>{
  const events=[];const {chat,sessionId}=await nativeChat(t,events);
  try{await chat.handle('chat.prompt',{sessionId,message:'retry-failure'});
    await until(()=>events.some(e=>e.kind==='error'));
    assert.deepEqual(events.filter(terminal).map(e=>[e.kind,e.text]),[['error','Provider retry exhausted']]);
    assert.ok(!events.some(e=>e.kind==='closed'));
  }finally{await chat.dispose();}
});

test('native assistant abort retains ownership through continuation or final cancellation',async t=>{
  for(const message of ['abort-resume','abort-settle']) {
    const events=[];const {chat,sessionId,savedSessionId,sessions}=await nativeChat(t,events);
    try {
      await chat.handle('chat.prompt',{sessionId,message});
      assert.equal(events.filter(terminal).length,0);
      await assert.rejects(chat.handle('chat.prompt',{sessionId,message:'duplicate'}),/running/);
      await until(()=>events.some(terminal));
      assert.deepEqual(events.filter(terminal).map(e=>e.kind),[message==='abort-resume'?'completed':'cancelled']);
      assert.equal(events.filter(e=>e.kind==='delta').map(e=>e.text).join(''),message==='abort-resume'?'Continued after assistant abort':'');
      assert.ok(!events.some(e=>e.kind==='closed'));
    }finally{await chat.dispose();}
    const saved=await sessions.load(savedSessionId);
    assert.equal(saved.transcript.filter(e=>e.role==='status').length,1);
    if(message==='abort-resume')assert.ok(saved.transcript.some(e=>e.role==='assistant'&&e.text==='Continued after assistant abort'));
  }
});

test('busy native prompt queues once without closing running OMP; queue failure stays cancellable',async t=>{
  for(const message of ['busy-prompt','busy-queue-failure']) {
    const events=[];const {chat,sessionId}=await nativeChat(t,events);
    try {
      if(message==='busy-prompt') {
        const result=await chat.handle('chat.prompt',{sessionId,message});assert.equal(result.queued,true);
        await until(()=>events.some(e=>e.kind==='completed'));
        assert.deepEqual(events.filter(terminal).map(e=>e.kind),['completed']);
        assert.equal(events.filter(e=>e.kind==='delta').map(e=>e.text).join(''),'Queued request completed once');
      } else {
        await assert.rejects(chat.handle('chat.prompt',{sessionId,message}),error=>error.code===-32013);
        assert.equal(events.filter(terminal).length,0);
        const turnId=events.find(e=>e.kind==='started').turnId;
        await chat.handle('chat.cancel',{sessionId,turnId});
        await until(()=>events.some(e=>e.kind==='cancelled'));
      }
      assert.ok(!events.some(e=>e.kind==='closed'));
    }finally{await chat.dispose();}
  }
});

test('retry remains cancellable and an OMP crash remains a real failure',async t=>{
  for(const message of ['retry-wait','retry-crash']){
    const events=[];const {chat,sessionId}=await nativeChat(t,events);
    try{const {turnId}=await chat.handle('chat.prompt',{sessionId,message});
      await until(()=>events.some(e=>e.frame?.event?.level==='retry'));
      if(message==='retry-wait')await chat.handle('chat.cancel',{sessionId,turnId});
      await until(()=>events.some(terminal));
      assert.deepEqual(events.filter(terminal).map(e=>e.kind),[message==='retry-wait'?'cancelled':'error']);
    }finally{await chat.dispose();}
  }
});

test('restricted provider errors still terminate immediately',async()=>{
  const events=[],chat=new ChatSession({...options,profile:'restricted'},e=>events.push(e));
  try{const {sessionId}=await chat.handle('chat.open',{});await chat.handle('chat.prompt',{sessionId,message:'provider-error'});
    await until(()=>events.some(e=>e.kind==='error'));
    assert.deepEqual(events.filter(terminal).map(e=>[e.kind,e.text]),[['error','Provider unavailable']]);
  }finally{await chat.dispose();}
});

test('retry progress persists through quiet waits and clears on retry end',()=>{
  let now=0;const progress=new TurnProgress(()=>now);
  progress.observe({type:'auto_retry_start'});now=600000;
  assert.equal(progress.snapshot().phase,'retrying');
  assert.equal(progress.snapshot(false,0,true).phase,'cancelling');
  progress.observe({type:'auto_retry_end',success:true});assert.equal(progress.snapshot().phase,'running');
});
