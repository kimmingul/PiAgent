import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChatSession} from '@piagent/core';
import {TurnProgress} from '../packages/piagent-core/dist/turn-progress.js';
import {lifecycleLog} from '../packages/piagent-daemon/dist/lifecycle-log.js';
import {Controller} from '../ui/dist/controller.js';

test('a quiet turn survives eleven minutes, remains cancellable and accepts another turn',async t=>{
  const events=[];
  const chat=new ChatSession({executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:process.cwd()},e=>events.push(e));
  try {
    const {sessionId}=await chat.handle('chat.open',{});
    t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
    const {turnId}=await chat.handle('chat.prompt',{sessionId,message:'wait'});
    t.mock.timers.tick(660000);
    assert.ok(!events.some(e=>['closed','error','cancelled','completed'].includes(e.kind)));
    assert.ok(events.some(e=>e.kind==='activity'&&e.frame.phase==='awaiting_progress'));
    t.mock.timers.reset();
    assert.deepEqual(await chat.handle('chat.cancel',{sessionId,turnId}),{requested:true});
    for(let n=0;n<100&&!events.some(e=>e.kind==='cancelled');n++)await delay(10);
    assert.equal(events.filter(e=>e.kind==='cancelled').length,1);
    await chat.handle('chat.prompt',{sessionId,message:'local'});
    assert.equal(events.filter(e=>e.kind==='completed').length,1);
  }finally{t.mock.timers.reset();await chat.dispose();}
});

test('activity distinguishes quiet tools, subagents, input waits and cancellation without declaring failure',()=>{
  let now=0;const progress=new TurnProgress(()=>now);
  now=720000;assert.equal(progress.snapshot().phase,'awaiting_progress');
  progress.observe({type:'tool_execution_start',toolCallId:'tool'});
  now+=600000;assert.equal(progress.snapshot().phase,'tools');
  progress.observe({type:'subagent_progress',payload:{progress:{id:'agent',status:'running'}}});
  assert.equal(progress.snapshot().phase,'subagents');
  assert.equal(progress.snapshot(true).phase,'awaiting_input');
  assert.equal(progress.snapshot(true,0,true).phase,'cancelling');
  progress.observe({type:'subagent_lifecycle',payload:{id:'agent',status:'completed'}});
  assert.equal(progress.snapshot().phase,'tools');
  progress.observe({type:'tool_execution_end',toolCallId:'tool'});
  assert.equal(progress.snapshot().activeTools,0);
  now+=120000;assert.equal(progress.snapshot().phase,'awaiting_progress');
  progress.observe({type:'message_update'});assert.equal(progress.snapshot().phase,'running');
});

test('session closure preserves a visible failure reason and is distinct from pipe disconnection',()=>{
  const shown=[],sent=[];const c=new Controller(f=>sent.push(f),{emit:f=>shown.push(f),list(){},capabilities(){}});
  c.receive({type:'session',sessionId:'s'});
  c.receive({type:'event',data:{sessionId:'s',turnId:'t',sequence:1,kind:'started'}});
  c.receive({type:'event',data:{sessionId:'s',turnId:'t',sequence:2,kind:'activity',text:'하위 에이전트 작업 중',frame:{elapsedMs:661000}}});
  assert.ok(shown.some(e=>e.state==='하위 에이전트 작업 중 · 11분 1초'));
  const reason='OMP 프로세스가 예기치 않게 종료되었습니다.';
  c.receive({type:'event',data:{sessionId:'s',turnId:'t',sequence:3,kind:'error',text:reason}});
  c.receive({type:'event',data:{sessionId:'s',turnId:null,sequence:4,kind:'closed',text:reason}});
  assert.ok(shown.some(e=>e.t==='notice'&&e.text===reason));
  assert.equal(shown.filter(e=>e.t==='status').at(-1).state,reason);
  c.action({t:'connect'});assert.equal(sent.at(-1).action,'connect');
  c.receive({type:'session',sessionId:'fresh'});
  c.receive({type:'event',data:{sessionId:'fresh',turnId:null,sequence:1,kind:'closed'}});
  assert.match(shown.filter(e=>e.t==='status').at(-1).state,/작업 세션이 종료/);
});

test('lifecycle log omits prompts, credentials and tool arguments, rotates and tolerates I/O failure',async()=>{
  const root=await mkdtemp(join(tmpdir(),'piagent-lifecycle-'));
  try{
    const log=lifecycleLog(root);
    log({kind:'activity',phase:'tools',elapsedMs:660000,prompt:'secret-prompt',token:'secret-token',arguments:'secret-tool'});
    const content=await readFile(join(root,'lifecycle.jsonl'),'utf8');assert.doesNotMatch(content,/secret-/);assert.equal(JSON.parse(content).elapsedMs,660000);
    await writeFile(join(root,'lifecycle.jsonl'),' '.repeat(1048577));log({kind:'closed'});
    assert.equal(JSON.parse(await readFile(join(root,'lifecycle.jsonl'),'utf8')).kind,'closed');
    assert.equal((await readFile(join(root,'lifecycle.jsonl.previous'))).length,1048577);
    assert.doesNotThrow(()=>lifecycleLog(join(root,'missing'))({kind:'closed'}));
  }finally{assert.ok(root.startsWith(join(tmpdir(),'piagent-lifecycle-')));await rm(root,{recursive:true,force:true});}
});
