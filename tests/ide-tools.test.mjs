import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {IdeBridge} from '../packages/piagent-core/dist/ide-tools.js';
import {parseSuggestion,EditorCompletion,documentRevision} from '../packages/piagent-core/dist/editor-completion.js';
import {startDaemon,PipeClient} from '@piagent/daemon';
const fixture=fileURLToPath(new URL('./fixtures/editor-omp.mjs',import.meta.url));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('IDE reads are correlated and debugger/test/build actions require single-use consent',async()=>{
 const frames=[],bridge=new IdeBridge(frame=>frames.push(frame));bridge.enabled=true;bridge.controlsEnabled=true;
 try{
  const read=bridge.execute('ide_context',{},new AbortController().signal);const request=frames.pop();assert.equal(request.type,'ide_request');
  assert.throws(()=>bridge.reply('other',{}),/expired/);bridge.reply(request.id,{editor:{saved:false,text:'unsaved'}});assert.equal((await read).editor.saved,false);
  for(const [name,args] of [['ide_build',{}],['ide_tests',{project:'Tests.csproj',operation:'discover'}],['ide_debug',{operation:'evaluate',expression:'obj.Getter'}],['ide_profile',{processId:123,durationSeconds:2}]]){
   const pending=bridge.execute(name,args,new AbortController().signal);const approval=frames.pop();assert.equal(approval.type,'designer_approval');assert.equal(frames.length,0);
   bridge.decide(approval.proposalId,true);assert.throws(()=>bridge.decide(approval.proposalId,true),/expired/);await tick();const request=frames.find(f=>f.type==='ide_request');assert.ok(request);bridge.reply(request.id,{executed:true});assert.equal((await pending).executed,true);frames.length=0;
  }
 }finally{bridge.close();}
});
test('IDE rejection, plan mode, cancellation and stale replies cannot execute an action',async()=>{
 const frames=[],bridge=new IdeBridge(frame=>frames.push(frame));bridge.enabled=true;
 await assert.rejects(bridge.execute('ide_build',{},new AbortController().signal),/disabled/);assert.equal(frames.length,0);
 bridge.controlsEnabled=true;const denied=bridge.execute('ide_debug',{operation:'start'},new AbortController().signal);bridge.decide(frames.pop().proposalId,false);assert.equal((await denied).executed,false);assert.equal(frames.some(f=>f.type==='ide_request'),false);
 frames.length=0;const controller=new AbortController();const read=bridge.execute('ide_symbols',{operation:'search',query:'Add'},controller.signal);const request=frames[0];controller.abort();await assert.rejects(read,/cancelled/);assert.equal(frames.at(-1).type,'ide_cancel');assert.throws(()=>bridge.reply(request.id,{}),/expired/);
 for(const args of [{operation:'execute'},{operation:'search',query:22},{operation:'references',file:'x.cs',line:0,column:1},{operation:'search',query:'a',extra:true}])await assert.rejects(bridge.execute('ide_symbols',args,new AbortController().signal),/Invalid|position/);
 bridge.close();
});
test('editor suggestions validate UTF-16 ranges, revision and exact completion position',()=>{
 const text='// 🚀\nreturn ';
 const good=parseSuggestion(JSON.stringify({start:text.length,length:0,text:'a + b;'}),text,text.length,'completion');assert.equal(good.revision,documentRevision(text));
 for(const value of [{start:-1,length:0,text:'x'},{start:1,length:0,text:'x'},{start:4,length:1,text:'x'},{start:text.length,length:100,text:'x'},{start:text.length,length:0,text:'x',command:'run'}])assert.throws(()=>parseSuggestion(JSON.stringify(value),text,text.length,'completion'));
 assert.throws(()=>parseSuggestion(JSON.stringify({start:4,length:0,text:'x'}),text,text.length,'next-edit'),/Unicode/);
 assert.equal(parseSuggestion(JSON.stringify({start:0,length:2,text:'//'}),text,text.length,'next-edit').empty,true);
});
test('editor inference is tool-free, preserves disk, supports a separate model and cancellation',{timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-editor-'));const audit=join(root,'audit.jsonl');
 const service=new EditorCompletion({executable:process.execPath,cwd:root,executableArgs:[fixture,'--audit',audit]});
 try{
  const file=join(root,'File.cs');await writeFile(file,'on disk');const params={requestId:'one',file:'File.cs',text:'return ',position:7,mode:'completion',provider:'fixture',model:'fast'};
  assert.equal((await service.suggest(params,root)).text,'a + b;');assert.equal(await readFile(file,'utf8'),'on disk');
  const commands=(await readFile(audit,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(commands.some(c=>c.type==='set_model'));assert.equal(commands.some(c=>c.type==='set_host_tools'),false);
  const waiting=service.suggest({...params,requestId:'wait',text:'WAIT_FOREVER',position:0},root);await new Promise(resolve=>setTimeout(resolve,200));assert.equal(service.cancel('other').cancelled,false);service.cancel('wait');await assert.rejects(waiting,/cancelled/);
  assert.equal((await service.suggest({...params,requestId:'again'},root)).text,'a + b;');
  const first=service.suggest({...params,requestId:'old',text:'WAIT_FOREVER',position:0},root);
  const oldRejected=assert.rejects(first,/cancelled/);
  await new Promise(resolve=>setTimeout(resolve,50));
  const queued=service.suggest({...params,requestId:'queued'},root);
  const queuedRejected=assert.rejects(queued,/cancelled/);
  const latest=service.suggest({...params,requestId:'latest'},root);
  await Promise.all([oldRejected,queuedRejected]);assert.equal((await latest).requestId,'latest');
  await assert.rejects(service.suggest({...params,text:'INVALID_RESPONSE',position:0},root));
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
test('authenticated editor RPC enforces negotiation, path exclusions and returns an unsaved-buffer revision',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-editor-pipe-'));await writeFile(join(root,'File.cs'),'saved');await writeFile(join(root,'.env'),'private');
 const authFile=join(root,'private','token'),daemon=await startDaemon({pipeName:'piagent-editor-'+randomUUID(),secure:{authFile},workspaceRoot:root,omp:{executable:process.execPath,cwd:root,executableArgs:[fixture]}}),clients=[];
 try{
  const connect=async caps=>{const client=await PipeClient.connect(daemon.path,{authFile});clients.push(client);assert.ok((await client.request('adapter.hello',{protocolVersions:[1],capabilities:caps,requiredCapabilities:caps,adapter:{kind:'test-ide',version:'1',ideVersion:'test',instanceId:randomUUID()}})).result);return client;};
  const plain=await connect(['chat.v1']),editor=await connect(['chat.v1','editor.suggestions.v1']);
  const params={requestId:'one',workspaceUri:pathToFileURL(root).href,file:'File.cs',text:'return ',position:7,mode:'completion'};
  assert.equal((await plain.request('editor.suggest',params)).error.code,-32005);
  for(const file of ['../File.cs','.env','C:/Windows/test.cs'])assert.ok((await editor.request('editor.suggest',{...params,file})).error);
  const result=(await editor.request('editor.suggest',params)).result;assert.equal(result.text,'a + b;');assert.equal(result.revision,documentRevision(params.text));assert.equal(await readFile(join(root,'File.cs'),'utf8'),'saved');
 }finally{clients.forEach(c=>c.close());await daemon.close();await rm(root,{recursive:true,force:true});}
});
test('OMP host calls reach the negotiated VS adapter and capability survives session access changes',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-ide-host-')),authFile=join(root,'private','token');
 const chatFixture=fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url));
 const daemon=await startDaemon({pipeName:'piagent-ide-'+randomUUID(),secure:{authFile},workspaceRoot:root,omp:{executable:process.execPath,cwd:root,executableArgs:[chatFixture]}});
 const client=await PipeClient.connect(daemon.path,{authFile});
 try{
  const caps=['chat.v1','chat.sessions.v1','workspace.read.v1','chat.approval.v1','ide.tools.v1'];
  assert.ok((await client.request('adapter.hello',{protocolVersions:[1],capabilities:caps,requiredCapabilities:caps,adapter:{kind:'visual-studio',version:'1',ideVersion:'test',instanceId:randomUUID()}})).result);
  let opened=(await client.request('chat.open',{})).result;
  for(const mode of ['always-ask','plan','always-ask']){
   opened=(await client.request('chat.setApproval',{sessionId:opened.sessionId,mode})).result;
   const events=[];let completed;
   const done=new Promise(resolve=>completed=resolve);
   const listener=event=>{events.push(event);if(event.frame?.type==='ide_request')void client.request('ide.reply',{sessionId:opened.sessionId,requestId:event.frame.id,result:{editor:{text:'IDE unsaved buffer'}}});if(event.kind==='completed')completed();};client.on('chat.event',listener);
   assert.ok((await client.request('chat.prompt',{sessionId:opened.sessionId,message:'PIAGENT_IDE_CONTEXT'})).result);await done;client.off('chat.event',listener);
   assert.ok(events.some(event=>event.frame?.operation==='ide_context'));
   assert.ok(events.some(event=>event.kind==='delta'&&event.text.includes('IDE unsaved buffer')));
  }
 }finally{client.close();await daemon.close();await rm(root,{recursive:true,force:true});}
});
