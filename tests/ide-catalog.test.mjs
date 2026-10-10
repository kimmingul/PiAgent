import test from 'node:test';
import assert from 'node:assert/strict';
import {IdeBridge} from '../packages/piagent-core/dist/ide-tools.js';
import {parseIdeCatalog} from '../packages/piagent-core/dist/ide-catalog.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {startDaemon,PipeClient} from '@piagent/daemon';
const uri='file:///D:/fixture/';
const catalog=(revision='one',entries=[{tool:'ide_context',operation:'snapshot',availability:'supported'},{tool:'ide_build',operation:'build',availability:'supported'},{tool:'ide_debug',operation:'snapshot',availability:'supported'},{tool:'ide_debug',operation:'continue',availability:'blocked',reasonCode:'not_paused',reason:'Pause the debugger first.'}])=>({schemaVersion:1,workspaceUri:uri,revision,capturedAt:new Date().toISOString(),entries});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('catalog is bounded, workspace-bound, typed and rejects duplicate or unexplained availability',()=>{
  assert.equal(parseIdeCatalog(catalog(),uri).schemaVersion,1);
  const versioned={...catalog(),implementationVersion:'candidate-0.10.0',entries:[{...catalog().entries[0],implementationVersion:'ToolsAPI-13.2'}]};
  assert.equal(parseIdeCatalog(versioned).entries[0].implementationVersion,'ToolsAPI-13.2');
  assert.throws(()=>parseIdeCatalog({...versioned,implementationVersion:'x'.repeat(129)}),/implementationVersion/);
  assert.throws(()=>parseIdeCatalog({...versioned,entries:[{...versioned.entries[0],implementationVersion:42}]}),/implementationVersion/);
  for(const value of [{...catalog(),workspaceUri:'https://other/'},{...catalog(),schemaVersion:2},{...catalog(),extra:true},{...catalog(),entries:[{tool:'ide_build',availability:'blocked'}]},{...catalog(),entries:[catalog().entries[0],catalog().entries[0]]},{...catalog(),revision:'a'.repeat(257)}])assert.throws(()=>parseIdeCatalog(value,uri));
  assert.throws(()=>parseIdeCatalog(catalog(),'file:///D:/other/'));
  assert.throws(()=>parseIdeCatalog(catalog('secret-revision',[{tool:'ide_build',availability:'blocked',reason:'secret provider credential'}])),error=>error.message.includes('reasonCode and reason')&&!error.message.includes('secret'));
  const parsed=parseIdeCatalog(catalog());parsed.entries.length=0;assert.equal(catalog().entries.length,4);
});

test('catalog filters model operations and plan tools while legacy adapters retain reads',()=>{
  const bridge=new IdeBridge(()=>{});bridge.enabled=true;bridge.catalogEnabled=true;bridge.publish(catalog());
  const tools=bridge.registeredTools();assert.ok(tools.some(t=>t.name==='ide_catalog'));assert.ok(!tools.some(t=>t.name==='ide_build'));assert.deepEqual(tools.find(t=>t.name==='ide_debug').parameters.properties.operation.enum,['snapshot']);
  assert.deepEqual(tools.find(t=>t.name==='ide_context').parameters.properties.operation.enum,['snapshot']);
  bridge.controlsEnabled=true;assert.deepEqual(bridge.registeredTools().find(t=>t.name==='ide_build').parameters.properties.operation.enum,['build']);
  assert.ok(!bridge.registeredTools().some(t=>t.name==='ide_tests'));
  bridge.catalogEnabled=false;assert.ok(bridge.registeredTools().some(t=>t.name==='ide_tests'));assert.ok(!bridge.registeredTools().some(t=>t.name==='ide_refactor'));bridge.close();
});

test('closing an IDE session discards its catalog before the next adapter binds',()=>{
  const bridge=new IdeBridge(()=>{});bridge.enabled=true;bridge.catalogEnabled=true;bridge.publish(catalog());
  assert.ok(bridge.registeredTools().some(t=>t.name==='ide_build')===false);
  bridge.controlsEnabled=true;assert.ok(bridge.registeredTools().some(t=>t.name==='ide_build'));
  bridge.close();bridge.bindCatalog(undefined,uri);
  assert.equal(bridge.snapshot,undefined);
  assert.deepEqual(bridge.registeredTools().map(t=>t.name),['ide_catalog']);
});

test('fresh action consent binds adapter revision and forwards expected state outside arguments',async()=>{
  const frames=[];let bridge;
  bridge=new IdeBridge(frame=>{frames.push(frame);if(frame.type==='ide_request'&&frame.operation==='ide_catalog')bridge.reply(frame.id,catalog());});
  bridge.enabled=true;bridge.controlsEnabled=true;bridge.catalogEnabled=true;bridge.publish(catalog());
  const pending=bridge.execute('ide_build',{},new AbortController().signal);await tick();
  const approval=frames.find(f=>f.type==='designer_approval');assert.ok(approval.expiresAt>Date.now());bridge.decide(approval.proposalId,true);await tick();
  const request=frames.find(f=>f.operation==='ide_build');assert.deepEqual(request.expectedState,{workspaceUri:uri,revision:'one'});assert.deepEqual(request.args,{});bridge.reply(request.id,{executed:true,status:'completed'});assert.equal((await pending).status,'completed');bridge.close();
});

test('state changes during consent refuse execution and expiry retires single-use approval',async()=>{
  let revision='one';const frames=[];let bridge;
  bridge=new IdeBridge(frame=>{frames.push(frame);if(frame.operation==='ide_catalog')bridge.reply(frame.id,catalog(revision));},15);
  bridge.enabled=true;bridge.controlsEnabled=true;bridge.catalogEnabled=true;bridge.publish(catalog());
  const pending=bridge.execute('ide_build',{},new AbortController().signal);await tick();const approval=frames.find(f=>f.type==='designer_approval');revision='two';bridge.decide(approval.proposalId,true);await assert.rejects(pending,/state changed/);assert.equal(frames.some(f=>f.operation==='ide_build'),false);
  frames.length=0;const expired=bridge.execute('ide_build',{},new AbortController().signal);await tick();const id=frames.find(f=>f.type==='designer_approval').proposalId;assert.equal((await expired).cancellation,'before_execution');assert.throws(()=>bridge.decide(id,true),/expired/);bridge.close();
});

test('unavailable requests and cancelled live discovery cannot submit actions or accept stale replies',async()=>{
  const frames=[],bridge=new IdeBridge(frame=>frames.push(frame));bridge.enabled=true;bridge.catalogEnabled=true;bridge.publish(catalog());
  await assert.rejects(bridge.execute('ide_tests',{operation:'run',project:'Tests.csproj'},new AbortController().signal),/not advertised/);
  const controller=new AbortController(),pending=bridge.execute('ide_catalog',{},controller.signal);const request=frames.at(-1);controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(frames.at(-1).type,'ide_cancel');assert.throws(()=>bridge.reply(request.id,catalog()),/expired/);bridge.close();
});

test('pure IDE snapshots remain fresh reads without a startup revision precondition',async()=>{
 const frames=[],bridge=new IdeBridge(frame=>frames.push(frame));bridge.enabled=true;bridge.catalogEnabled=true;bridge.publish(catalog());
 const pending=bridge.execute('ide_context',{},new AbortController().signal);const request=frames.at(-1);assert.equal(request.expectedState,undefined);bridge.reply(request.id,{editor:{revision:'new',text:'edited after startup'}});assert.equal((await pending).editor.revision,'new');bridge.close();
});

test('refactor apply displays the cached adapter diff and consumes its immutable single-use preview',async()=>{
 const entries=[{tool:'ide_refactor',availability:'supported'}],snapshot=catalog('one',entries),frames=[];
 const before='class Before {}',after='class After {}',preview={available:true,proposalId:'preview',revision:'proposal-revision',files:[{path:'File.cs',before,after,beforeRevision:createHash('sha256').update(before).digest('hex')}]};
 let bridge;bridge=new IdeBridge(frame=>{frames.push(frame);if(frame.operation==='ide_catalog')bridge.reply(frame.id,snapshot);if(frame.operation==='ide_refactor'&&frame.args.operation==='rename')bridge.reply(frame.id,preview);});
 bridge.enabled=true;bridge.controlsEnabled=true;bridge.catalogEnabled=true;bridge.publish(snapshot);
 const applyArgs={operation:'apply',proposalId:'preview',revision:'proposal-revision'};await assert.rejects(bridge.execute('ide_refactor',applyArgs,new AbortController().signal),/preview expired/);
 await bridge.execute('ide_refactor',{operation:'rename',file:'File.cs',line:1,column:7,newName:'After'},new AbortController().signal);preview.files[0].after='malicious later mutation';
 const pending=bridge.execute('ide_refactor',applyArgs,new AbortController().signal);await tick();const approval=frames.find(f=>f.type==='designer_approval');assert.match(approval.diff,/-class Before/);assert.match(approval.diff,/\+class After/);assert.doesNotMatch(approval.diff,/malicious/);bridge.decide(approval.proposalId,true);await tick();const request=frames.find(f=>f.operation==='ide_refactor'&&f.args.operation==='apply');bridge.reply(request.id,{applied:true});assert.equal((await pending).applied,true);await assert.rejects(bridge.execute('ide_refactor',applyArgs,new AbortController().signal),/preview expired/);bridge.close();
});

test('invalid refactor previews cannot be approved, and legacy extensions cannot silently become old actions',async()=>{
 const bridge=new IdeBridge(frame=>{if(frame.operation==='ide_refactor')bridge.reply(frame.id,{available:true,proposalId:'bad',revision:'one',files:[{path:'../File.cs',before:'a',after:'b',beforeRevision:'wrong'}]});});bridge.enabled=true;bridge.catalogEnabled=true;bridge.publish(catalog('one',[{tool:'ide_refactor',availability:'supported'}]));
 await assert.rejects(bridge.execute('ide_refactor',{operation:'format',file:'File.cs'},new AbortController().signal),/Invalid refactoring preview/);
 bridge.catalogEnabled=false;bridge.controlsEnabled=true;await assert.rejects(bridge.execute('ide_build',{operation:'clean'},new AbortController().signal),/not negotiated/);assert.deepEqual(bridge.registeredTools().find(t=>t.name==='ide_build').parameters.properties,{rebuild:{type:'boolean'}});bridge.close();
});

test('local publishing requires a cached concrete immutable plan and revalidates before consented execution',async()=>{
 const frames=[],state=catalog('one',[{tool:'ide_run',availability:'supported'}]),proposal={project:'App.csproj',backend:'dotnet publish',arguments:['publish','App.csproj','--output','D:/fixture/output'],outputDirectory:'D:/fixture/output',scope:'Isolated local artifact; project build targets execute; no cloud or remote publishing'};let bridge;
 bridge=new IdeBridge(frame=>{frames.push(frame);if(frame.operation==='ide_catalog')bridge.reply(frame.id,state);if(frame.operation==='ide_run'&&frame.args.operation==='publish-preview')bridge.reply(frame.id,{available:true,proposalId:'publish',revision:'one',proposal});});bridge.enabled=true;bridge.controlsEnabled=true;bridge.catalogEnabled=true;bridge.publish(state);
 try{
  const args={operation:'publish',proposalId:'publish',revision:'one'};await assert.rejects(bridge.execute('ide_run',args,new AbortController().signal),/preview expired/);await bridge.execute('ide_run',{operation:'publish-preview',project:'App.csproj'},new AbortController().signal);proposal.arguments=['changed-after-preview'];
  const pending=bridge.execute('ide_run',args,new AbortController().signal);await tick();const approval=frames.find(f=>f.type==='designer_approval');assert.match(approval.diff,/dotnet publish/);assert.match(approval.diff,/D:\/fixture\/output/);assert.doesNotMatch(approval.diff,/changed-after-preview/);bridge.decide(approval.proposalId,true);await tick();const request=frames.find(f=>f.operation==='ide_run'&&f.args.operation==='publish');bridge.reply(request.id,{executed:true,success:true});assert.equal((await pending).success,true);await assert.rejects(bridge.execute('ide_run',args,new AbortController().signal),/preview expired/);
 }finally{bridge.close();}
});

test('authenticated catalogs preserve negotiation, mode changes, ownership, idle publication and old adapters',{skip:process.platform!=='win32',timeout:20000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-catalog-')),workspace=pathToFileURL(root).href;await writeFile(join(root,'File.cs'),'saved');
 const authFile=join(root,'private','token'),fixture=fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url));
 const daemon=await startDaemon({pipeName:'piagent-catalog-'+randomUUID(),secure:{authFile},workspaceRoot:root,omp:{executable:process.execPath,cwd:root,executableArgs:[fixture]}}),clients=[];
 try{
  const connect=async caps=>{const c=await PipeClient.connect(daemon.path,{authFile});clients.push(c);const hello=await c.request('adapter.hello',{protocolVersions:[1],capabilities:caps,requiredCapabilities:caps,adapter:{kind:'test-ide',version:'1',ideVersion:'test',instanceId:randomUUID()}});return {c,hello};};
  const missing=await connect(['chat.v1','ide.catalog.v1']);assert.equal(missing.hello.error.code,-32004);
  const old=await connect(['chat.v1','workspace.read.v1','ide.tools.v1']);assert.equal((await old.c.request('ide.catalog',{})).error.code,-32005);assert.equal((await old.c.request('chat.open',{ideCatalog:catalog()})).error.code,-32005);
  const {c}=await connect(['chat.v1','workspace.read.v1','ide.tools.v1','ide.catalog.v1','chat.sessions.v1','chat.approval.v1']);
  const snapshot={...catalog(),workspaceUri:workspace};let opened=(await c.request('chat.open',{ideCatalog:snapshot})).result;assert.equal(opened.ideCatalogEnabled,true);assert.equal(opened.ideCatalog.revision,'one');
  assert.ok((await c.request('ide.catalog',{sessionId:'foreign',catalog:snapshot})).error);
  const events=[];c.on('chat.event',e=>events.push(e));const changed={...snapshot,revision:'two'};assert.equal((await c.request('ide.catalog',{sessionId:opened.sessionId,catalog:changed})).result.ideCatalog.revision,'two');assert.ok(events.some(e=>e.frame?.type==='ide_catalog'));
  opened=(await c.request('chat.setApproval',{sessionId:opened.sessionId,mode:'plan'})).result;assert.equal(opened.ideCatalogEnabled,true);assert.equal(opened.ideCatalog.revision,'two');
  const accepted=await c.request('chat.prompt',{sessionId:opened.sessionId,message:'wait'});assert.ok(accepted.result);assert.equal((await c.request('ide.catalog',{sessionId:opened.sessionId,catalog:snapshot})).error.code,-32013);
  assert.equal((await c.request('ide.catalog',{sessionId:opened.sessionId})).result.ideCatalog.revision,'two');await c.request('chat.cancel',{sessionId:opened.sessionId,turnId:accepted.result.turnId});
 }finally{clients.forEach(c=>c.close());await daemon.close();await rm(root,{recursive:true,force:true});}
});
