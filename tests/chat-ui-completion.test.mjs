import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {WorkspaceReader,WorkspaceChanges,SessionStore} from '@piagent/core';
import {Controller} from '../ui/dist/controller.js';
import {BtwService} from '../packages/piagent-core/dist/btw.js';
import {PreferencesStore} from '../packages/piagent-core/dist/preferences.js';
import {Plans} from '../packages/piagent-core/dist/plans.js';
import {images} from '../packages/piagent-core/dist/attachments.js';
import {startDaemon,PipeClient} from '@piagent/daemon';
const fixture=fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url));
const wait=async(test)=>{for(let i=0;i<500;i++){if(test())return;await delay(10);}assert.fail('Timed out waiting for event');};
function ui(){const sent=[],shown=[],caps=[];const controller=new Controller(frame=>sent.push(frame),{emit:frame=>shown.push(frame),list(){},capabilities:frame=>caps.push(frame)});controller.receive({type:'session',sessionId:'s',ompControlsEnabled:true,ompProfile:'native',btwEnabled:true,preferencesEnabled:true});let seq=0;return {controller,sent,shown,caps,event:(kind,extra={})=>controller.receive({type:'event',data:{sessionId:'s',turnId:'t',sequence:++seq,kind,...extra}})};}
test('approval failure never automatically resubmits, including yolo and approved-write turns',()=>{
 for(const mode of ['yolo','write']){const f=ui();f.controller.receive({type:'session',sessionId:'s',approvalMode:mode});f.event('started');f.event('approval_requested',{approval:{proposalId:'p',path:'A.cs'}});if(mode==='write')f.controller.action({t:'approval',id:'p',ok:true});const count=f.sent.filter(v=>v.action==='decideChange').length;f.controller.receive({type:'operationError',action:'decideChange',message:'stale revision'});assert.equal(f.sent.filter(v=>v.action==='decideChange').length,count);assert.equal(f.shown.at(-1).error,true);assert.ok(f.shown.some(v=>v.t==='approval'));}
});
test('BTW composer acknowledgement is independent of main draft and failure preserves side draft',()=>{
 const f=ui();f.controller.action({t:'btw',text:'side question',id:'side',composer:true});assert.equal(f.sent.at(-1).action,'btw');assert.equal(f.shown.filter(v=>v.t==='submitted').length,0);
 f.controller.receive({type:'operationError',action:'btw',id:'side',message:'side startup failed'});assert.equal(f.shown.find(v=>v.id==='side').ok,false);
 f.controller.action({t:'btw',text:'retry',id:'retry',composer:true});f.controller.receive({type:'btwAccepted',id:'retry'});assert.equal(f.shown.find(v=>v.id==='retry').ok,true);
 f.event('started');f.controller.action({t:'btw',text:'busy',id:'busy',composer:true});assert.equal(f.sent.at(-1).action,'btw');f.controller.receive({type:'btwAccepted',id:'busy'});assert.equal(f.shown.find(v=>v.id==='busy').ok,true);
});
test('model changes serialize, command discovery and busy queue use actual OMP controls',()=>{
 const f=ui();f.controller.action({t:'setThinking',value:'high'});f.controller.action({t:'setThinking',value:'low'});assert.equal(f.sent.filter(v=>v.command==='set_thinking_level').length,1);assert.equal(f.caps.at(-1).busy,true);
 f.controller.receive({type:'operationError',action:'ompControl',message:'model refused'});assert.equal(f.caps.at(-1).busy,false);
 f.controller.receive({type:'ompControl',command:'get_available_commands',data:{commands:[{name:'model',description:'choose'}]}});assert.ok(f.shown.find(v=>v.t==='commands').items.some(v=>v.name==='model'));
 f.event('started');f.controller.action({t:'submit',id:'queued',text:'next',followUp:true});assert.equal(f.sent.at(-1).command,'follow_up');f.controller.receive({type:'queueAccepted',id:'queued'});assert.equal(f.shown.find(v=>v.id==='queued').ok,true);
 f.controller.action({t:'cancelQueued',sent:'next',queue:'followUp'});assert.equal(f.sent.at(-1).command,'remove_queued_message');f.controller.action({t:'abortRetry'});assert.equal(f.sent.at(-1).command,'abort_retry');
 f.controller.receive({type:'disconnected'});assert.equal(f.caps.at(-1).ompControlsEnabled,undefined);
});
test('preferences persist, enforce schema and reject unsafe/oversized values',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-prefs-'));try{const store=new PreferencesStore(root);assert.equal((await store.read()).fontSize,13);const values={...await store.read(),language:'ko',fontSize:17,showThinking:false};await store.save(values);assert.deepEqual(await new PreferencesStore(root).read(),values);await assert.rejects(store.save({...values,fontSize:99}));await assert.rejects(store.save({...values,password:'secret'}));await assert.rejects(store.save({...values,constructor:'unexpected'}));}finally{await rm(root,{recursive:true,force:true});}
});
test('plan documents are bounded, immutable previews and edited plans cannot execute',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-plans-'));try{const service=new Plans(root),plan=await service.create('# Plan\n\nUse native controls.');assert.equal(await service.read(plan),'# Plan\n\nUse native controls.');await writeFile(join(root,plan.path),'changed');await assert.rejects(service.read(plan),/changed after preview/);await assert.rejects(service.read({path:'../outside',hash:plan.hash}));await assert.rejects(service.create('a'.repeat(300000)));}finally{await rm(root,{recursive:true,force:true});}
});
test('images use real ImageContent payload, reject mismatched data and enforce byte limits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-images-'));try{const png=join(root,'image.png');await writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=','base64'));const image=(await images([png]))[0];assert.equal(image.type,'image');assert.equal(image.mimeType,'image/png');assert.deepEqual(Buffer.from(image.data,'base64'),await readFile(png));await writeFile(png,'not an image');await assert.rejects(images([png]),/type does not match/);await writeFile(png,Buffer.alloc(600000));await assert.rejects(images([png]),/512 KiB/);}finally{await rm(root,{recursive:true,force:true});}
});
test('native/designer turn checkpoints observe edits, restore exact dirty bytes and preserve Git HEAD/index',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-native-cp-'));const run=promisify(execFile),git=async(...args)=>(await run('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:root,windowsHide:true})).stdout;
 try{await git('init');await writeFile(join(root,'Form.cs'),'initial\r\n');await writeFile(join(root,'Form.resx'),'resource\n');await git('add','.');await git('commit','-m','Fixture');await writeFile(join(root,'Form.cs'),'user dirty\r\n');const head=await git('rev-parse','HEAD'),index=await git('ls-files','--stage');const changes=await WorkspaceChanges.create(await WorkspaceReader.create(root)),before=await changes.beginTurn();
 await writeFile(join(root,'Form.cs'),'designer edit\r\n');await writeFile(join(root,'Form.resx'),'native edit\n');const checkpoint=await changes.observeTurn(before);assert.equal(checkpoint.recorded,true);const preview=await changes.previewRestore(checkpoint.checkpointId);assert.equal(preview.files.length,2);await changes.restore(checkpoint.checkpointId,preview.revision);assert.equal(await readFile(join(root,'Form.cs'),'utf8'),'user dirty\r\n');assert.equal(await readFile(join(root,'Form.resx'),'utf8'),'resource\n');assert.equal(await git('rev-parse','HEAD'),head);assert.equal(await git('ls-files','--stage'),index);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('version-one sessions migrate and replay safe rich events without approval requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-rich-'));try{const store=new SessionStore(root);await store.initialize();const lease=await store.acquire();lease.append('user','review');lease.appendEvent({t:'thinkingDelta',text:'a'});lease.appendEvent({t:'thinkingDelta',text:'b'});lease.appendEvent({t:'approval',id:'unsafe'});lease.appendEvent({t:'toolStart',id:'tool',name:'read',input:'{}'});lease.append('status','completed',{started:100,ended:200,stopped:false});const id=lease.record.savedSessionId;await lease.release();const saved=await store.load(id);assert.equal(saved.version,2);assert.equal(saved.transcript.find(item=>item.event?.t==='thinkingDelta').event.text,'ab');assert.ok(!saved.transcript.some(item=>item.event?.t==='approval'));assert.equal(saved.transcript.at(-1).ended,200);saved.version=1;await writeFile(join(root,id,'session.json'),JSON.stringify(saved));const resumed=await store.acquire(id);await resumed.release();assert.equal((await store.load(id)).version,2);}finally{await rm(root,{recursive:true,force:true});}
});
test('BTW forks context, keeps isolated history, resumes, cancels, deletes and reloads by stable main session',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-btw-')),frames=[];const service=new BtwService(join(root,'btw'),{executable:process.execPath,executableArgs:[fixture],cwd:root},frame=>frames.push(frame));
 try{const main=join(root,'main.jsonl');await writeFile(main,JSON.stringify('main context')+'\n');const accepted=await service.ask('side',undefined,'stable-main','Main title',main);await wait(()=>frames.some(v=>v.topic?.turns.at(-1).state==='done'));assert.equal(await readFile(main,'utf8'),JSON.stringify('main context')+'\n');const list=await service.list('stable-main');assert.equal(list.session,'stable-main');assert.equal(list.items.length,1);assert.equal(list.items[0].sessionFile,undefined);assert.equal(list.items[0].turns[0].q,'side');
 await wait(()=>!service.active?.size);await service.ask('follow up',accepted.topicId,'stable-main','Main title');await wait(()=>frames.some(v=>v.topic?.turns.length===2&&v.topic.turns[1].state==='done'));await service.close();const resumed=new BtwService(join(root,'btw'),{executable:process.execPath,executableArgs:[fixture],cwd:root},()=>{});assert.equal((await resumed.list('stable-main')).items[0].turns.length,2);assert.deepEqual(await resumed.usage('stable-main'),{scope:'retained-side-topics',topics:1,cost:0,tokens:0,running:0});await resumed.delete(accepted.topicId);assert.equal((await resumed.list('stable-main')).items.length,0);await assert.rejects(resumed.cancel('../outside'));await resumed.close();
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
test('Named Pipe UI methods reach Core, workspace listing excludes secrets and export stays private', {skip:process.platform!=='win32',timeout:20000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-ui-rpc-')),authFile=join(root,'private','token');let daemon,client;
 try{await writeFile(join(root,'Main.cs'),'class Main {}');await writeFile(join(root,'.env'),'SECRET');await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules','Hidden.js'),'hidden');daemon=await startDaemon({pipeName:'piagent-ui-'+randomUUID(),secure:{authFile},workspaceRoot:root,omp:{executable:process.execPath,executableArgs:[fixture],cwd:root}});client=await PipeClient.connect(daemon.path,{authFile});const hello=await client.request('adapter.hello',{protocolVersions:[1],capabilities:['chat.v1','chat.sessions.v1','omp.controls.v1','chat.preferences.v1','chat.btw.v1','workspace.read.v1','chat.approval.v1'],adapter:{kind:'test-ide',version:'test',ideVersion:'test',instanceId:randomUUID()}});assert.ok(hello.result);
 const session=(await client.request('chat.open')).result;assert.equal(session.btwEnabled,true);assert.equal(session.checkpointsEnabled,false);const params={sessionId:session.sessionId};const files=(await client.request('workspace.files',params)).result.items;assert.ok(files.includes('Main.cs'));assert.ok(!files.some(v=>v.includes('.env')||v.includes('node_modules')));
 const prefs=(await client.request('chat.preferences',params)).result;assert.equal(prefs.values.language,'auto');assert.equal((await client.request('chat.preferences',{...params,values:{...prefs.values,language:'ko'}})).result.values.language,'ko');
 const exported=(await client.request('chat.export',params)).result.path;assert.match(await readFile(exported,'utf8'),/Fixture export/);assert.ok(exported.startsWith(join(root,'private')));
 const command=(await client.request('omp.control',{...params,command:'get_available_commands'})).result;assert.ok(command.commands.some(v=>v.name==='fixture-command'));
 const frames=[];client.on('chat.event',frame=>frames.push(frame));const side=await client.request('btw.ask',{...params,text:'side'});assert.ok(side.result.accepted);await wait(()=>frames.some(v=>v.frame?.event?.topic?.turns.at(-1).state==='done'));assert.equal((await client.request('btw.list',params)).result.items.length,1);assert.ok((await client.request('btw.ask',{...params,text:'side',path:'arbitrary'})).error);
 const waiting=(await client.request('chat.prompt',{...params,message:'wait'})).result;const concurrent=await client.request('btw.ask',{...params,text:'side while main waits'});assert.ok(concurrent.result.accepted);await wait(()=>frames.some(v=>v.frame?.event?.topic?.id===concurrent.result.topicId&&v.frame.event.topic.turns.at(-1).state==='done'));await client.request('chat.cancel',{...params,turnId:waiting.turnId});
 assert.equal((await client.request('chat.prompt',{...params,message:'/switch another'})).error.code,-32602);const planning=(await client.request('chat.setApproval',{...params,mode:'plan'})).result;assert.equal(planning.approvalMode,'plan');assert.equal(planning.savedSessionId,session.savedSessionId);await client.request('chat.prompt',{sessionId:planning.sessionId,message:'Write a plan'});await wait(()=>frames.some(v=>v.sessionId===planning.sessionId&&v.kind==='completed'));const plan=frames.find(v=>v.sessionId===planning.sessionId&&v.frame?.event?.t==='plan').frame.event;assert.ok(await readFile(join(root,plan.path),'utf8'));const proceeded=(await client.request('chat.proceedPlan',{sessionId:planning.sessionId,path:plan.path})).result;assert.equal(proceeded.approvalMode,'always-ask');assert.equal(proceeded.savedSessionId,session.savedSessionId);assert.ok(proceeded.planPrompt.includes(plan.path));
 }finally{client?.close();await daemon?.close();await rm(root,{recursive:true,force:true});}
});

test('MCP toggles wait for admitted slash handler completion and return the persisted switch state',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-mcp-toggle-')),authFile=join(root,'private','token');let daemon,client;
 try{
  await promisify(execFile)('git',['init'],{cwd:root,windowsHide:true});
  await writeFile(join(root,'Fixture.txt'),'acceptance');
  await promisify(execFile)('git',['add','Fixture.txt'],{cwd:root,windowsHide:true});
  await promisify(execFile)('git',['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','Fixture'],{cwd:root,windowsHide:true});
  await mkdir(join(root,'.omp'));await writeFile(join(root,'.omp','mcp.json'),JSON.stringify({mcpServers:{fixture:{command:'fixture',enabled:true}}}));
  daemon=await startDaemon({pipeName:'piagent-mcp-'+randomUUID(),secure:{authFile},workspaceRoot:root,allowWrites:true,omp:{executable:process.execPath,executableArgs:[fixture],cwd:root,profile:'native'}});
  client=await PipeClient.connect(daemon.path,{authFile});await client.request('adapter.hello',{protocolVersions:[1],capabilities:['chat.v1','chat.sessions.v1','omp.controls.v1','workspace.read.v1','workspace.edit.v1'],adapter:{kind:'test',version:'test',ideVersion:'test',instanceId:randomUUID()}});
  const {sessionId}=(await client.request('chat.open')).result;
  for(const enabled of [false,true]){const reply=await client.request('chat.extensions',{sessionId,action:'toggleMcpServer',id:'fixture',enabled});assert.ok(!reply.error,JSON.stringify(reply.error));assert.equal(reply.result.mcpServers.find(server=>server.id==='fixture').enabled,enabled);assert.equal(JSON.parse(await readFile(join(root,'.omp','mcp.json'),'utf8')).mcpServers.fixture.enabled,enabled);}
 }finally{client?.close();await daemon?.close();await rm(root,{recursive:true,force:true});}
});

test('all 33 original renderer actions have Controller routes and unknown actions cannot cross the bridge',async()=>{
 const {rendererActions}=await import('../ui/dist/contracts.js');const source=await readFile(new URL('../ui/src/controller.ts',import.meta.url),'utf8');assert.equal(rendererActions.length,33);assert.equal(new Set(rendererActions).size,33);
 const extracted=new Set();for(const file of await readdir(new URL('../ui/src',import.meta.url))){if(!file.endsWith('.js')&&!file.endsWith('.html'))continue;const text=await readFile(new URL('../ui/src/'+file,import.meta.url),'utf8');for(const match of text.matchAll(/\bt\s*:\s*[\x27\x22]([A-Za-z]+)[\x27\x22]/g))extracted.add(match[1]);for(const match of text.matchAll(/data-action="([A-Za-z]+)"/g))extracted.add(match[1]);}assert.deepEqual([...extracted].sort(),[...rendererActions].sort());
 for(const name of rendererActions)assert.ok(source.includes("case '"+name+"':"),name+' has no handler');
 const f=ui(),count=f.sent.length;f.controller.action({t:'arbitrary-rpc',method:'switch_session'});assert.equal(f.sent.length,count);
});
test('stale replies and unrelated errors cannot unlock pending model change or discard main draft',()=>{
 const f=ui();f.controller.action({t:'setThinking',value:'high'});f.controller.receive({type:'operationError',action:'copy',message:'clipboard failed'});assert.equal(f.caps.at(-1).busy,true);
 f.controller.receive({type:'ompControl',command:'set_thinking_level',ownerSessionId:'old',data:{}});assert.equal(f.caps.at(-1).busy,true);
 f.controller.receive({type:'ompControl',command:'set_thinking_level',ownerSessionId:'s',data:{}});assert.equal(f.caps.at(-1).busy,false);
 f.controller.action({t:'submit',id:'main',text:'main question'});f.controller.action({t:'abort'});f.controller.receive({type:'operationError',action:'prompt',message:'preparation failed'});f.controller.action({t:'submit',id:'retry',text:'retry'});const before=f.sent.filter(v=>v.action==='cancel').length;f.event('started');assert.equal(f.sent.filter(v=>v.action==='cancel').length,before);
});
test('settings wait for save acknowledgement and failure is surfaced without success',()=>{
 const sent=[],results=[];let save;const controller=new Controller(frame=>sent.push(frame),{emit(){},list(){},capabilities(){},settings(frame,callback){save=callback;},settingsResult(ok,message){results.push({ok,message});}});
 controller.receive({type:'session',sessionId:'s',preferencesEnabled:true});controller.action({t:'settings'});controller.receive({type:'preferences',values:{fontSize:13}});save({fontSize:17});assert.equal(results.length,0);
 controller.receive({type:'operationError',action:'preferences',message:'disk full'});assert.deepEqual(results.at(-1),{ok:false,message:'disk full'});save({fontSize:17});controller.receive({type:'preferences',values:{fontSize:17}});assert.equal(results.at(-1).ok,true);
 controller.receive({type:'session',sessionId:'new',preferencesEnabled:true});save({fontSize:19});assert.equal(results.at(-1).ok,false);
});
test('separate PreferencesStore instances serialize saves for the same private directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-prefs-race-'));try{const a=new PreferencesStore(root),b=new PreferencesStore(root),values=await a.read();await Promise.all([a.save({...values,fontSize:16}),b.save({...values,fontSize:19})]);assert.equal((await a.read()).fontSize,19);}finally{await rm(root,{recursive:true,force:true});}
});

test('tool argument deltas retain tool ownership and do not execute transcript content',async()=>{
 const {uiEvent}=await import('../packages/piagent-core/dist/omp-events.js');assert.deepEqual(uiEvent({type:'message_update',assistantMessageEvent:{type:'toolcall_delta',contentIndex:0,partial:{content:[{type:'toolCall',id:'tool-a',name:'read'}]},delta:'{"path":"Main.cs"}'}}),{t:'toolInputDelta',id:'tool-a',name:'read',text:'{"path":"Main.cs"}'});assert.equal(uiEvent({type:'message_update',assistantMessageEvent:{type:'toolcall_delta',delta:'unowned'}}),undefined);
});
