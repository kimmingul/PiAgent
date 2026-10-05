import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CORE_VERSION} from '@piagent/protocol';
import {changeDiff} from '../packages/piagent-core/dist/change-diff.js';
import {timelineNotice} from '../packages/piagent-core/dist/timeline.js';
import {Controller} from '../ui/dist/controller.js';

test('built Core version uses the root release version',async()=>{
  const root=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));assert.equal(CORE_VERSION,root.version);
});
test('review diff limits context while disclosing CRLF conversion, BOM and missing final newline',()=>{
  const before=Array.from({length:80},(_,i)=>`line ${i}`).join('\r\n')+'\r\n';
  const after=before.replace('line 40','changed 40').replaceAll('\r\n','\n');
  const diff=changeDiff('Form.cs',Buffer.from(before),Buffer.from(after));
  assert.match(diff,/줄바꿈 변경: 80 CRLF \/ 0 LF → 0 CRLF \/ 80 LF/);assert.match(diff,/-line 40␍/);assert.match(diff,/\+changed 40/);assert.ok(!diff.includes('line 0\n'));assert.ok(diff.split('\n').length<18);
  assert.match(changeDiff('x',Buffer.from('\ufeffx\r\n'),Buffer.from('x')),/⟨BOM⟩/);assert.match(changeDiff('x',Buffer.from('x\n'),Buffer.from('x')),/No newline/);
  const formatOnly=changeDiff('x',Buffer.from('same\r\n'),Buffer.from('same\n'));assert.match(formatOnly,/본문은 동일/);assert.doesNotMatch(formatOnly,/@@/);
  assert.match(changeDiff('x',Buffer.alloc(0),Buffer.from('new\n')), /@@ -0,0 \+1,1 @@/);
  assert.match(changeDiff('x',Buffer.from('old\n'),Buffer.alloc(0)), /@@ -1,1 \+0,0 @@/);
  assert.match(changeDiff('x',Buffer.from('bare\r'),Buffer.from('bare')), /-bare␍/);
});
test('timeline distinguishes branch/restore and tells users about preserved original and draft',()=>{
  assert.match(timelineNotice(2,true,false,true),/별도 대화를 분기합니다/);assert.match(timelineNotice(2,false,true,false),/대화를 복원했습니다/);assert.match(timelineNotice(2,true,true,true),/자동 전송되지/);
});
test('project transition disables stale actions, ignores old events and preserves draft',()=>{
  const sent=[],events=[],caps=[];const c=new Controller(f=>sent.push(f),{emit:f=>events.push(f),list(){},capabilities:f=>caps.push(f)});
  c.receive({type:'session',sessionId:'old',workspaceUri:'file:///old',ompControlsEnabled:true,ompProfile:'native',filesEnabled:true,btwEnabled:true});
  c.receive({type:'workspaceChanging',workspaceUri:'file:///new'});const count=sent.length;
  for(const t of ['newSession','sessions','captureSelection'])c.action({t});
  c.receive({type:'event',data:{sessionId:'old',sequence:1,kind:'started',turnId:'old-turn'}});
  assert.equal(sent.length,count);assert.equal(caps.at(-1).connected,false);assert.ok(!events.some(f=>f.t==='setInput'));
  c.receive({type:'session',sessionId:'new',workspaceUri:'file:///new'});assert.equal(caps.at(-1).connected,true);
});

test('native compact slash command uses controlled RPC, preserves rejected drafts and reports completion',()=>{
  const sent=[],events=[];const c=new Controller(f=>sent.push(f),{emit:f=>events.push(f),list(){},capabilities(){}});
  c.receive({type:'session',sessionId:'s',workspaceUri:'file:///scratch',ompControlsEnabled:true,ompProfile:'native'});sent.length=0;events.length=0;
  c.action({t:'submit',id:'attached',text:'/compact',attachments:[{path:'file:///scratch/a'}]});
  assert.deepEqual(events.find(f=>f.t==='submitted'),{t:'submitted',id:'attached',ok:false});assert.equal(sent.length,0);
  c.action({t:'submit',id:'compact',text:'/COMPACT preserve menu decisions'});
  assert.deepEqual(sent,[{action:'ompControl',command:'compact',fields:{customInstructions:'preserve menu decisions'}}]);assert.ok(events.some(f=>f.t==='submitted'&&f.id==='compact'&&f.ok));assert.ok(!events.some(f=>f.t==='user'));
  c.action({t:'submit',id:'busy',text:'/compact'});assert.equal(sent.length,1);assert.ok(events.some(f=>f.t==='submitted'&&f.id==='busy'&&!f.ok));
  c.receive({type:'event',data:{sessionId:'s',sequence:1,kind:'omp_event',frame:{type:'control_operation',operationId:'op',state:'failed',message:'대화가 짧아 압축할 내용이 없습니다.'}}});
  assert.ok(events.some(f=>f.t==='notice'&&f.text==='대화가 짧아 압축할 내용이 없습니다.'));
  c.receive({type:'ompControl',command:'compact',data:{accepted:true,operationId:'op'}});
  sent.length=0;c.action({t:'submit',id:'again',text:'/compact'});assert.equal(sent[0].command,'compact');assert.deepEqual(sent[0].fields,{});
});
