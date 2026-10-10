import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Controller} from '../ui/dist/controller.js';
test('IDE capability sheet is scoped to the connected session and only uses reported status',()=>{
 const sent=[],shown=[];
 const controller=new Controller(f=>sent.push(f),{emit:f=>shown.push(f),list:()=>{},capabilities:()=>{}});
 const catalog={schemaVersion:1,capturedAt:'2026-10-09T00:00:00Z',entries:[{tool:'ide_build',availability:'blocked',reason:'Save unsaved files first'},{tool:'ide_symbols',availability:'partial',languages:['C#','VB']}]};
 controller.receive({type:'session',sessionId:'a',ideCatalogEnabled:true,ideCatalog:catalog});
 controller.action({t:'runCommand',text:'/ide'});
 assert.match(shown.at(-1).text,/Save unsaved files first/);assert.match(shown.at(-1).text,/C#, VB/);
 assert.equal(sent.some(f=>f.action==='prompt'),false);
 controller.receive({type:'event',data:{sessionId:'other',sequence:1,kind:'omp_event',frame:{type:'ide_catalog',catalog:{entries:[{tool:'injected',availability:'supported'}]}}}});
 controller.action({t:'ideCapabilities'});assert.doesNotMatch(shown.at(-1).text,/injected/);
 controller.receive({type:'session',sessionId:'b'});controller.action({t:'ideCapabilities'});assert.doesNotMatch(shown.at(-1).text,/Save unsaved/);
 controller.receive({type:'disconnected'});controller.action({t:'ideCapabilities'});assert.doesNotMatch(shown.at(-1).text,/C#, VB/);
});
function fixture() {
 const sent=[],shown=[];let menu=[];
 const c=new Controller(f=>sent.push(f),{emit:f=>shown.push(f),list:(_t,items)=>{menu=items;},capabilities:()=>{}});
 const receive=f=>c.receive(f),action=f=>c.action(f);
 receive({type:'session',sessionId:'s',writeEnabled:true,sessionsEnabled:true,usageEnabled:true});let sequence=0;
 let activeTurn=null;
 const event=(kind,extra={})=>{if(kind==='started')activeTurn='t';receive({type:'event',data:{sessionId:'s',turnId:activeTurn,sequence:++sequence,kind,...extra}});if(['completed','cancelled','error','closed'].includes(kind))activeTurn=null;};
 return {sent,shown,receive,action,event,menu:()=>menu};
}

test('closed sessions ignore late extension actions and cannot resurrect approval or editor text',()=>{
 const f=fixture();f.event('started');f.event('closed');
 const shown=f.shown.length,sent=f.sent.length;
 for(const frame of [{type:'designer_approval',proposalId:'late'},{type:'extension_ui_request',method:'set_editor_text',text:'stale draft'},{type:'extension_ui_request',method:'open_url',url:'https://example.com'}])
  f.event('omp_event',{frame});
 f.event('started',{turnId:'late-turn'});
 assert.equal(f.shown.length,shown);assert.equal(f.sent.length,sent);
});

test('completed turns cannot change the draft, launch a URL or approve through late OMP events',()=>{
 const f=fixture();f.event('started');f.event('completed');
 const shown=f.shown.length,sent=f.sent.length;
 for(const frame of [{type:'designer_approval',proposalId:'late'},{type:'extension_ui_request',method:'set_editor_text',text:'stale draft'},{type:'extension_ui_request',method:'open_url',url:'https://example.com'}])
  f.event('omp_event',{turnId:'t',frame});
 for(const frame of [{type:'designer_approval',proposalId:'late-null'},{type:'extension_ui_request',method:'set_editor_text',text:'stale null draft'},{type:'extension_ui_request',method:'open_url',url:'https://example.com'}])
  f.event('omp_event',{turnId:null,frame});
 assert.equal(f.shown.length,shown);assert.equal(f.sent.length,sent);
 f.event('omp_event',{turnId:null,frame:{type:'extension_ui_request',method:'notify',message:'session notice'}});
 assert.equal(f.shown.at(-1).text,'session notice');
});

test('project switch retires pending queued drafts and busy controls before a new session opens',()=>{
 const f=fixture();f.receive({type:'session',sessionId:'s',ompProfile:'native',ompControlsEnabled:true,btwEnabled:true});
 f.event('started');
 f.action({t:'submit',id:'queue-draft',text:'follow up'});
 f.action({t:'btw',id:'btw-draft',composer:true,text:'question'});
 f.receive({type:'workspaceChanging',workspaceUri:'file:///D:/next'});
 for(const id of ['queue-draft','btw-draft'])assert.deepEqual(f.shown.filter(m=>m.t==='submitted'&&m.id===id).map(m=>m.ok),[false]);
 assert.equal(f.shown.filter(m=>m.t==='turnEnd').length,1);
 f.receive({type:'workspaceDisconnected'});
 assert.equal(f.shown.at(-1).busy,false);
 assert.equal(f.sent.filter(m=>m.action==='prompt').length,0);
});

test('direct workspace loss retires the live turn and ignores late session replies',()=>{
 const f=fixture();f.receive({type:'session',sessionId:'s',ompProfile:'native',ompControlsEnabled:true,btwEnabled:true});
 f.event('started');f.action({t:'submit',id:'queued',text:'follow up'});f.action({t:'btw',id:'side',composer:true,text:'question'});
 f.event('approval_requested',{approval:{proposalId:'pending',reason:'edit',diff:'-a\n+b'}});
 f.receive({type:'workspaceDisconnected'});
 assert.equal(f.shown.filter(m=>m.t==='turnEnd').length,1);
 assert.deepEqual(['queued','side'].map(id=>f.shown.filter(m=>m.t==='submitted'&&m.id===id).map(m=>m.ok)),[[false],[false]]);
 assert.ok(f.shown.some(m=>m.t==='approvalResult'&&m.id==='pending'&&m.ok===false));
 assert.equal(f.shown.at(-1).busy,false);
 const sent=f.sent.length,approvalCount=f.shown.filter(m=>m.t==='approval').length;
 for(const frame of [
  {type:'messageRestorePreview',data:{messageRestoreId:'late'}},
  {type:'restorePreview',data:{checkpointId:'late'}},
  {type:'queueAccepted',id:'queued'},
  {type:'btwAccepted',id:'side'},
  {type:'ompControl',command:'get_state',data:{model:{provider:'stale',id:'old'}}},
  {type:'preferences',values:{notifications:true}}
 ])f.receive(frame);
 f.event('omp_event',{frame:{type:'extension_ui_request',method:'set_editor_text',text:'stale'}});
 f.action({t:'approval',id:'pending',ok:true});
 assert.equal(f.sent.length,sent);
 assert.equal(f.shown.filter(m=>m.t==='approval').length,approvalCount);
 f.receive({type:'operationError',action:'connect',message:'temporary connection failure'});
 assert.equal(f.shown.at(-1).reconnectAvailable,true);
 f.receive({type:'session',sessionId:'new'});assert.equal(f.shown.filter(m=>m.t==='status').at(-1).connected,true);
});

test('global language preference still updates after workspace loss without reviving settings callbacks',()=>{
 const sent=[],shown=[],results=[],settings=[];
 const c=new Controller(frame=>sent.push(frame),{emit:frame=>shown.push(frame),list:()=>{},capabilities:()=>{},settings:(_frame,save)=>settings.push(save),settingsResult:(ok)=>results.push(ok)});
 c.receive({type:'session',sessionId:'s',preferencesEnabled:true});c.action({t:'settings'});
 c.receive({type:'preferences',ownerSessionId:'s',values:{language:'en'}});
 assert.equal(settings.length,1);settings[0]({language:'en'});
 c.receive({type:'workspaceDisconnected'});
 assert.deepEqual(results,[false]);const sentBefore=sent.length;
 c.receive({type:'preferences',ownerSessionId:'other',values:{language:'stale'}});
 c.receive({type:'preferences',ownerSessionId:'s',values:{language:'ko'}});
 assert.equal(shown.filter(frame=>frame.t==='preferences').at(-1).values.language,'ko');
 assert.equal(settings.length,1);assert.deepEqual(results,[false]);assert.equal(sent.length,sentBefore);
 c.receive({type:'session',sessionId:'new'});
 c.receive({type:'preferences',ownerSessionId:'s',values:{language:'old'}});
 assert.equal(shown.filter(frame=>frame.t==='preferences').at(-1).values.language,'ko');
});

test('retired interaction callbacks cannot answer a new turn or a reconnected session',()=>{
 const sent=[],callbacks=[];
 const c=new Controller(f=>sent.push(f),{emit:()=>{},list:()=>{},capabilities:()=>{},interaction:(_f,answer)=>callbacks.push(answer),accountEvent:(_f,answer)=>callbacks.push(answer)});
 c.receive({type:'session',sessionId:'s'});let sequence=0;
 const event=(kind,extra={})=>c.receive({type:'event',data:{sessionId:'s',turnId:'t',sequence:++sequence,kind,...extra}});
 event('started');event('omp_event',{frame:{type:'extension_ui_request',id:'question',method:'input'}});
 callbacks[0]({value:'current'});assert.equal(sent.filter(m=>m.action==='ompRespond').length,1);
 event('cancelled');callbacks[0]({value:'late'});
 event('omp_event',{turnId:null,frame:{type:'extension_ui_request',id:'login',login:true}});
 c.receive({type:'disconnected'});c.receive({type:'session',sessionId:'s'});
 callbacks[1]({value:'old login'});
 assert.deepEqual(sent.filter(m=>m.action==='ompRespond'),[{action:'ompRespond',requestId:'question',answer:{value:'current'}}]);
});
test('plan execution failure reports the real error to the pending original card',()=>{
 const f=fixture();f.receive({type:'session',sessionId:'s',approvalMode:'plan'});
 f.action({t:'proceedPlan',path:'docs/plans/example.md'});
 assert.equal(f.sent.at(-1).action,'proceedPlan');
 f.receive({type:'operationError',action:'proceedPlan',message:'Plan changed after preview'});
 assert.deepEqual(f.shown.find(m=>m.t==='planResult'),{t:'planResult',ok:false,text:'Plan changed after preview'});
 f.action({t:'proceedPlan',path:'docs/plans/example.md'});assert.equal(f.sent.at(-1).action,'proceedPlan');
});
test('disconnected controls report connection recovery instead of unsupported feature state',()=>{
 const f=fixture();f.receive({type:'disconnected',message:'authentication error'});
 f.action({t:'listFiles'});assert.match(f.shown.at(-1).text,/연결을 다시 시도/);
 f.action({t:'settings'});f.menu()[0].run();assert.equal(f.sent.at(-1).action,'connect');
 f.receive({type:'session',sessionId:'s'});f.action({t:'unsupported'});
 assert.equal(f.shown.at(-1).text,'현재 연결에서 지원하지 않는 기능입니다.');
});
test('direct transport loss closes an active card exactly once and preserves an unstarted draft',()=>{
 const active=fixture();active.event('started');active.receive({type:'disconnected'});
 assert.equal(active.shown.filter(frame=>frame.t==='assistantEnd').length,1);
 assert.deepEqual(active.shown.filter(frame=>frame.t==='turnEnd').map(frame=>frame.stopped),[true]);
 active.event('completed');active.receive({type:'disconnected'});
 assert.equal(active.shown.filter(frame=>frame.t==='turnEnd').length,1);
 const waiting=fixture();waiting.action({t:'submit',id:'unsent',text:'keep this draft'});
 waiting.receive({type:'disconnected'});
 assert.deepEqual(waiting.shown.filter(frame=>frame.t==='submitted'&&frame.id==='unsent').map(frame=>frame.ok),[false]);
 assert.equal(waiting.shown.filter(frame=>frame.t==='user'&&frame.text==='keep this draft').length,0);
 assert.equal(waiting.shown.filter(frame=>frame.t==='turnEnd').length,0);
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
 assert.deepEqual(f.sent.filter(m=>m.action==='ompControl').map(m=>m.command),['get_available_models','get_available_thinking_levels','get_state','get_available_commands']);
 f.action({t:'setModel',value:'provider/model/variant'});
 assert.deepEqual(f.sent.at(-1),{action:'ompControl',command:'set_model',fields:{provider:'provider',modelId:'model/variant'}});
 f.receive({type:'ompControl',command:'set_model',data:{}});
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
  // Integration changes are documented in ui/README.md; retain original provenance hashes.
  if(['chat.html','chat.js','composer.js','clicks.js','plusmenu.js','btw.js','checkpoints.js','approval.js','markdown.js','activity.js','activity.css','topbar.js'].includes(name)||name.startsWith('lang/'))continue;
  const bytes=await readFile(new URL('../ui/src/'+name,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,name);
 }
});
test('closed OMP session exposes explicit reconnect, retires pending UI and never replays a prompt',()=>{
 const f=fixture();
 f.action({t:'submit',id:'request',text:'inspect only'});f.event('started');
 f.event('omp_event',{frame:{type:'login_status',state:'pending'}});
 f.event('approval_requested',{approval:{proposalId:'pending',diff:'review'}});
 const before=f.sent.length;
 f.event('closed',{text:'working session ended'});
 const status=f.shown.filter(m=>m.t==='status').at(-1);
 assert.equal(status.connected,false);assert.equal(status.busy,false);assert.equal(status.reconnectAvailable,true);
 assert.equal(f.shown.filter(m=>m.t==='turnEnd').length,1);
 f.action({t:'approval',id:'pending',ok:true});f.action({t:'submit',id:'retry',text:'must not replay'});
 f.action({t:'newSession'});f.action({t:'sessions'});
 assert.equal(f.sent.length,before);
 f.action({t:'connect'});f.action({t:'connect'});
 assert.deepEqual(f.sent.slice(before),[{action:'connect'}]);
 f.receive({type:'operationError',action:'connect',message:'temporary connection failure'});
 assert.equal(f.shown.filter(m=>m.t==='status').at(-1).reconnectAvailable,true);
 f.action({t:'connect'});f.receive({type:'session',sessionId:'resumed',sessionsEnabled:true});
 assert.equal(f.shown.filter(m=>m.t==='status').at(-1).reconnectAvailable,false);
 f.action({t:'sessions'});assert.equal(f.sent.at(-1).action,'listSessions');
 assert.equal(f.sent.filter(m=>m.action==='prompt').length,1);
});
test('normal session switching does not offer a competing reconnect or duplicate completed turn',()=>{
 const f=fixture();f.action({t:'submit',id:'request',text:'inspect'});f.event('started');f.event('cancelled');
 f.action({t:'newSession'});f.event('closed');
 const status=f.shown.filter(m=>m.t==='status').at(-1);
 assert.equal(status.reconnectAvailable,false);assert.equal(status.busy,true);
 f.action({t:'connect'});assert.equal(f.sent.filter(m=>m.action==='connect').length,0);
 assert.equal(f.shown.filter(m=>m.t==='turnEnd').length,1);
 f.receive({type:'session',sessionId:'new'});assert.equal(f.shown.filter(m=>m.t==='status').at(-1).connected,true);
});

test('file references cover both IDE families without matching extension prefixes',async()=>{
 const {runInNewContext}=await import('node:vm');
 const scope={};runInNewContext(await readFile(new URL('../ui/src/markdown.js',import.meta.url),'utf8'),scope);
 for(const [path,line]of [['Program.cs',3],['View.xaml',2],['Main.fmx',1],['MAIN.PAS',4],['D:/fixture/Editor.csproj',5],['D:/fixture/Header.hpp',6]]){
  const html=scope.Markdown.linkFileRefs(`${path}:${line}`);
  assert.ok(html.includes(`data-path="${path}"`),html);assert.ok(html.includes(`data-line="${line}"`),html);
 }
 for(const path of ['D:/fixture/Unknown.csharp:1','Unknown.exe:1'])assert.ok(!scope.Markdown.linkFileRefs(path).includes('file-ref'));
});
