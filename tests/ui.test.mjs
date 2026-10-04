import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Controller} from '../ui/dist/controller.js';
function fixture() {
 const sent=[],shown=[];let menu=[];
 const c=new Controller(f=>sent.push(f),{emit:f=>shown.push(f),list:(_t,items)=>{menu=items;},capabilities:()=>{}});
 const receive=f=>c.receive(f),action=f=>c.action(f);
 receive({type:'session',sessionId:'s',writeEnabled:true,sessionsEnabled:true,usageEnabled:true});let sequence=0;
 const event=(kind,extra={})=>receive({type:'event',data:{sessionId:'s',turnId:'t',sequence:++sequence,kind,...extra}});
 return {sent,shown,receive,action,event,menu:()=>menu};
}
test('disconnected controls report connection recovery instead of unsupported feature state',()=>{
 const f=fixture();f.receive({type:'disconnected',message:'authentication error'});
 f.action({t:'listFiles'});assert.match(f.shown.at(-1).text,/연결을 다시 시도/);
 f.action({t:'settings'});f.menu()[0].run();assert.equal(f.sent.at(-1).action,'connect');
 f.receive({type:'session',sessionId:'s'});f.action({t:'unsupported'});
 assert.equal(f.shown.at(-1).text,'현재 연결에서 지원하지 않는 기능입니다.');
});
test('draft accepted only after host starts; failure preserves draft',()=>{
 const f=fixture();f.action({t:'submit',id:'draft',text:'안녕'});
 assert.equal(f.sent.at(-1).action,'prompt');assert.ok(!f.shown.some(m=>m.t==='submitted'));
 f.receive({type:'operationError',message:'unavailable'});assert.equal(f.shown.find(m=>m.t==='submitted').ok,false);
 f.action({t:'submit',id:'retry',text:'안녕'});f.event('started');
 assert.ok(f.shown.some(m=>m.t==='submitted'&&m.id==='retry'&&m.ok));assert.equal(f.shown.filter(m=>m.t==='user').length,1);
 f.action({t:'submit',id:'duplicate',text:'busy'});assert.equal(f.sent.filter(m=>m.action==='prompt').length,2);
});
test('selection-free adapters submit without unsupported selection actions',()=>{
 const f=fixture();f.action({t:'submit',id:'rad',text:'문서 편집기'});
 assert.deepEqual(f.sent.filter(m=>['prompt','clearSelection'].includes(m.action)),[{action:'prompt',message:'문서 편집기'}]);
 f.event('started');assert.ok(f.shown.some(m=>m.t==='submitted'&&m.id==='rad'&&m.ok));
 const vs=fixture();vs.receive({type:'session',sessionId:'s',selectionEnabled:true});vs.action({t:'submit',id:'vs',text:'hello'});
 assert.deepEqual(vs.sent.slice(-2).map(m=>m.action),['clearSelection','prompt']);
});

test('access modes use host state, auto approvals preserve restore confirmation and reset each turn',()=>{
 const f=fixture();f.receive({type:'session',sessionId:'s',approvalMode:'write',approvalModes:['always-ask','write','yolo','plan']});
 f.event('started');f.event('approval_requested',{approval:{proposalId:'a',path:'A.cs'}});
 assert.equal(f.sent.filter(value=>value.action==='decideChange').length,0);
 f.action({t:'approval',id:'a',ok:true});f.event('approval_resolved',{approval:{approved:true}});
 f.event('approval_requested',{approval:{proposalId:'b',path:'B.cs'}});assert.equal(f.sent.at(-1).proposalId,'b');
 f.event('approval_resolved',{approval:{approved:true}});f.event('completed');f.event('started');
 f.event('approval_requested',{approval:{proposalId:'c',path:'C.cs'}});assert.equal(f.sent.filter(value=>value.proposalId==='c').length,0);
 const y=fixture();y.receive({type:'session',sessionId:'s',approvalMode:'yolo'});y.event('started');y.event('approval_requested',{approval:{proposalId:'y',path:'A.cs'}});assert.equal(y.sent.at(-1).decision,'approve');
 y.event('approval_resolved',{approval:{approved:true}});y.event('completed');y.receive({type:'restorePreview',data:{checkpointId:'restore',path:'A.cs'}});assert.equal(y.sent.filter(value=>value.action==='restoreChange').length,0);
});

test('plus actions and attachment references reach the host through the original composer contract',()=>{
 const f=fixture();for(const t of ['attachFiles','addFolder','listExtensions','manageExtensions','compile'])f.action({t});
 assert.deepEqual(f.sent.slice(-5).map(value=>value.action),['attachFiles','addFolder','listExtensions','manageExtensions','compile']);
 f.receive({type:'attachments',items:[{path:'D:/app/Main.xaml',name:'Main.xaml'}]});assert.equal(f.shown.at(-1).t,'attachments');
 f.action({t:'submit',id:'attached',text:'검토',attachments:['D:/app/Main.xaml']});assert.deepEqual(f.sent.at(-1).attachments,['D:/app/Main.xaml']);
});
test('explicit approval, duplicate prevention, stale events and preview-before-restore',()=>{
 const f=fixture();f.event('started');f.event('approval_requested',{approval:{proposalId:'p',path:'A.cs',diff:'-old\n+new',reason:'test'}});
 assert.equal(f.sent.filter(m=>m.action==='decideChange').length,0);
 f.action({t:'approval',id:'forged',ok:true});assert.equal(f.sent.filter(m=>m.action==='decideChange').length,0);
 f.action({t:'approval',id:'p',ok:true});f.action({t:'approval',id:'p',ok:true});assert.equal(f.sent.filter(m=>m.action==='decideChange').length,1);
 f.event('approval_resolved',{approval:{approved:true}});f.event('completed');
 f.receive({type:'event',data:{sessionId:'s',sequence:1,kind:'delta',turnId:'t',text:'stale'}});assert.ok(!f.shown.some(m=>m.text==='stale'));
 f.receive({type:'checkpoints',items:[{checkpointId:'c',path:'A.cs',state:'applied',createdAt:0}]});f.menu()[0].run();assert.equal(f.sent.at(-1).action,'previewRestore');
 f.receive({type:'restorePreview',data:{checkpointId:'c',path:'A.cs',diff:'-new\n+old'}});f.action({t:'approval',id:'c',ok:false});assert.equal(f.sent.at(-1).action,'previewRestore');
 f.receive({type:'restorePreview',data:{checkpointId:'c',path:'A.cs',diff:'-new\n+old'}});f.action({t:'approval',id:'c',ok:true});assert.equal(f.sent.at(-1).action,'restoreChange');
 f.receive({type:'operationError',message:'file changed'});f.action({t:'approval',id:'c',ok:true});assert.equal(f.sent.filter(m=>m.action==='restoreChange').length,2);
 f.receive({type:'disconnected'});f.action({t:'approval',id:'c',ok:true});assert.equal(f.sent.filter(m=>m.action==='restoreChange').length,2);
});
test('sessions serialize; usage retains unknown values and actual model',()=>{
 const f=fixture();f.receive({type:'sessions',sessions:[{savedSessionId:'saved',title:'title',resumable:true,updatedAt:0}]});f.menu()[0].run();f.menu()[0].run();assert.equal(f.sent.filter(m=>m.action==='resumeSession').length,1);
 f.receive({type:'usage',data:{provider:'anthropic',model:'model',tokens:{total:123},cost:null,context:{},providerLimits:{limits:[{usedFraction:null}]}}});
 const usage=f.shown.find(m=>m.t==='usage');assert.equal(usage.stats.cost,null);assert.equal(usage.limits.limits.length,0);assert.equal(f.shown.at(-1).model,'anthropic/model');
});

test('original model/effort controls discover actual state and designer approval uses its own endpoint',()=>{
 const f=fixture();f.receive({type:'session',sessionId:'s',ompControlsEnabled:true,ompProfile:'native',writeEnabled:true});
 assert.deepEqual(f.sent.filter(m=>m.action==='ompControl').map(m=>m.command),['get_available_models','get_available_thinking_levels','get_state']);
 f.action({t:'setModel',value:'provider/model/variant'});
 assert.deepEqual(f.sent.at(-1),{action:'ompControl',command:'set_model',fields:{provider:'provider',modelId:'model/variant'}});
 f.receive({type:'ompControl',command:'get_state',data:{model:{provider:'provider',id:'model'},thinkingLevel:'high'}});
 assert.equal(f.shown.at(-1).thinking,'high');
 f.event('started');f.event('omp_event',{frame:{type:'designer_approval',proposalId:'d',path:'Form.xaml',reason:'Width',diff:'-100\n+200'}});
 f.action({t:'approval',id:'d',ok:true});assert.deepEqual(f.sent.at(-1),{action:'designerDecide',proposalId:'d',approved:true});
 f.event('omp_event',{frame:{type:'designer_resolved',proposalId:'d',approved:false}});f.event('completed');
 f.action({t:'submit',id:'slash',text:'/extension-command'});assert.equal(f.sent.at(-1).action,'prompt');
});
test('original layout assets exist; dashboard controls removed',async()=>{
 const html=await readFile(new URL('../ui/src/chat.html',import.meta.url),'utf8');
 for(const id of ['topbar','log','composer','plus-menu','model-menu','usage-pop'])assert.ok(html.includes(`id="${id}"`));
 for(const id of ['sessionTools','checkpointTools','refreshUsage','approvalCard'])assert.ok(!html.includes(`id="${id}"`));
 for(const m of html.matchAll(/(?:src|href)="([^"#]+)"/g))await readFile(new URL(`../ui/${m[1]==='bridge.js'?'dist':'src'}/${m[1]}`,import.meta.url));
});

test('reference CSS, icons and renderer modules retain the recorded source bytes',async()=>{
 const {createHash}=await import('node:crypto');
 const hashes=JSON.parse(await readFile(new URL('../ui/reference-files.json',import.meta.url),'utf8'));
 for(const [name,hash] of Object.entries(hashes)) {
  if(['chat.html','chat.js','composer.js'].includes(name))continue;
  const bytes=await readFile(new URL('../ui/src/'+name,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,name);
 }
});
