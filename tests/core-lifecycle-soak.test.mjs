import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {startDaemon,PipeClient} from '@piagent/daemon';
import {documentRevision} from '../packages/piagent-core/dist/editor-completion.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real pipe soak isolates 10 project switches/resumes, 10 modes, 30 cancel/resume cycles and 100 editors',{skip:process.platform!=='win32',timeout:90000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-core-soak-')),authFile=join(root,'private','token'),audit=join(root,'children.jsonl'),fixture=fileURLToPath(new URL('./fixtures/lifecycle-omp.mjs',import.meta.url));
 const daemon=await startDaemon({pipeName:'piagent-soak-'+randomUUID(),secure:{authFile},workspaceRoot:root,omp:{executable:process.execPath,cwd:root,executableArgs:[fixture,'--lifecycle-audit',audit]}});
 let client,closed=false;const events=[];
 const request=async(method,args)=>{const reply=await client.request(method,args);assert.equal(reply.error,undefined,JSON.stringify(reply.error));return reply.result;};
 const finished=async(turnId)=>{for(let attempt=0;attempt<500;attempt++){const matches=events.filter(e=>e.turnId===turnId&&['completed','cancelled','error'].includes(e.kind));if(matches.length){assert.equal(matches.length,1,'one terminal per turn');return matches[0];}await pause(10);}throw Error('Turn did not settle');};
 try{
  client=await PipeClient.connect(daemon.path,{authFile});client.on('chat.event',event=>events.push(event));
  const capabilities=['chat.v1','workspace.read.v1','workspace.bind.v1','chat.sessions.v1','chat.approval.v1','ide.tools.v1','ide.catalog.v1','editor.suggestions.v1','editor.context.v1'];
  await request('adapter.hello',{protocolVersions:[1],capabilities,requiredCapabilities:capabilities,adapter:{kind:'lifecycle-fixture',version:'1',ideVersion:'fixture',instanceId:randomUUID()}});
  let workspaceUri=pathToFileURL(root).href;const catalog={schemaVersion:1,workspaceUri,revision:'steady',capturedAt:new Date().toISOString(),entries:[{tool:'ide_context',availability:'supported'}]};
  let opened=await request('chat.open',{ideCatalog:catalog});const switchStart=performance.now();
  let cancelMs=0;const turns=[];
  for(let index=0;index<10;index++){
   const previous=opened.sessionId;opened=await request('chat.setApproval',{sessionId:previous,mode:['always-ask','write','yolo','plan'][index%4]});assert.notEqual(opened.sessionId,previous);assert.equal(opened.ideCatalog.revision,'steady');assert.equal(opened.ideCatalogEnabled,true);assert.ok((await client.request('ide.catalog',{sessionId:previous})).error,'retired session refuses calls');
   for(let cycle=0;cycle<3;cycle++){const cancelStart=performance.now(),accepted=await request('chat.prompt',{sessionId:opened.sessionId,message:'wait'});turns.push(accepted.turnId);await request('chat.cancel',{sessionId:opened.sessionId,turnId:accepted.turnId});assert.equal((await finished(accepted.turnId)).kind,'cancelled');cancelMs+=performance.now()-cancelStart;const resumed=await request('chat.prompt',{sessionId:opened.sessionId,message:'local'});assert.equal((await finished(resumed.turnId)).kind,'completed');}
  }
  const switchMs=performance.now()-switchStart,projectStart=performance.now();let previousSaved=opened.savedSessionId;
  for(let index=0;index<10;index++){
   const project=join(root,'Project'+index),sentinel='project-sentinel-'+index;await mkdir(project);await writeFile(join(project,'Sentinel.txt'),sentinel+'\n');await request('chat.close',{sessionId:opened.sessionId});workspaceUri=pathToFileURL(project).href;
   assert.ok((await client.request('chat.open',{workspaceUri,savedSessionId:previousSaved})).error,'foreign workspace session cannot resume');
   const snapshot={...catalog,workspaceUri,revision:'project-'+index};opened=await request('chat.open',{workspaceUri,ideCatalog:snapshot});assert.equal(opened.workspaceUri,workspaceUri);assert.equal(opened.ideCatalog.revision,snapshot.revision);assert.ok((await client.request('ide.catalog',{sessionId:opened.sessionId,catalog})).error,'foreign catalog cannot replace current state');
   const read=await request('chat.prompt',{sessionId:opened.sessionId,message:'PIAGENT_HOST_READ:'+JSON.stringify({path:'Sentinel.txt',startLine:1,maxLines:1})});assert.equal((await finished(read.turnId)).kind,'completed');assert.match(events.filter(e=>e.turnId===read.turnId&&e.kind==='delta').map(e=>e.text).join(''),new RegExp(sentinel));
   const escaped=await request('chat.prompt',{sessionId:opened.sessionId,message:'PIAGENT_HOST_READ:'+JSON.stringify({path:'../Project0/Sentinel.txt',startLine:1,maxLines:1})});assert.equal((await finished(escaped.turnId)).kind,'completed');assert.equal(events.filter(e=>e.turnId===escaped.turnId&&e.kind==='delta').map(e=>e.text).join(''),'tool-error','host reader cannot escape active project');
   previousSaved=opened.savedSessionId;await request('chat.close',{sessionId:opened.sessionId});opened=await request('chat.open',{workspaceUri,savedSessionId:previousSaved});assert.equal(opened.savedSessionId,previousSaved);assert.equal(opened.ideCatalog,undefined,'an explicit reopen needs a fresh adapter catalog');
   const recall=await request('chat.prompt',{sessionId:opened.sessionId,message:'PIAGENT_RECALL'});assert.equal((await finished(recall.turnId)).kind,'completed');const remembered=events.filter(e=>e.turnId===recall.turnId&&e.kind==='delta').map(e=>e.text).join('');assert.match(remembered,/PIAGENT_HOST_READ/);
   const reread=await request('chat.prompt',{sessionId:opened.sessionId,message:'PIAGENT_HOST_READ:'+JSON.stringify({path:'Sentinel.txt',startLine:1,maxLines:1})});assert.equal((await finished(reread.turnId)).kind,'completed');assert.match(events.filter(e=>e.turnId===reread.turnId&&e.kind==='delta').map(e=>e.text).join(''),new RegExp(sentinel));
   const listed=await request('sessions.list',{});assert.equal(listed.sessions.length,1,'project sees only its own saved session');
  }
  const projectMs=performance.now()-projectStart,editorStart=performance.now(),text='return ',context={start:50,totalLength:150,revision:documentRevision('full document')};
  for(let index=0;index<100;index++){const result=await request('editor.suggest',{requestId:'soak-'+index,workspaceUri,file:'New.cs',text,position:7,mode:'completion',context});assert.equal(result.requestId,'soak-'+index);assert.equal(result.start,57);assert.equal(result.revision,context.revision);assert.ok(result.timing.totalMs>=result.timing.inferenceMs);}
  const editorMs=performance.now()-editorStart;await assert.rejects(readFile(join(root,'New.cs')),e=>e.code==='ENOENT');
  await request('chat.close',{sessionId:opened.sessionId});client.close();client=undefined;await daemon.close();closed=true;
  const records=(await readFile(audit,'utf8')).trim().split('\n').map(JSON.parse),spawned=records.filter(r=>r.type==='spawn');assert.equal(spawned.filter(r=>r.editor).length,100);assert.equal(spawned.filter(r=>!r.editor).length,31);assert.equal(new Set(spawned.map(r=>r.instance)).size,spawned.length,'isolated process instances');
  // Windows reused several PIDs in the initial run. Match process instances and
  // observed exits, never treat a historical PID as a still-owned process.
  const live=new Map();for(const record of records){if(record.type==='spawn'){assert.ok(!live.has(record.pid),'no overlapping PID instances');live.set(record.pid,record.instance);}else{assert.equal(live.get(record.pid),record.instance);assert.equal(record.code,0);live.delete(record.pid);}}
  assert.equal(live.size,0,'every audited process exited');
  for(const turnId of turns)assert.equal(events.filter(e=>e.turnId===turnId&&['completed','cancelled','error'].includes(e.kind)).length,1);
  t.diagnostic(JSON.stringify({fixture:true,projectSwitches:10,savedSessionResumes:10,modeSwitches:10,cancelResumeCycles:30,editorRequests:100,spawnedChildren:spawned.length,reusedPids:spawned.length-new Set(spawned.map(r=>r.pid)).size,switchMs:Math.round(switchMs),projectMs:Math.round(projectMs),cancelMs:Math.round(cancelMs),editorMs:Math.round(editorMs)}));
 }finally{client?.close();if(!closed)await daemon.close();await rm(root,{recursive:true,force:true});}
});
