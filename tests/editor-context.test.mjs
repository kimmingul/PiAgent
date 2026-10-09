import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {WorkspaceReader} from '@piagent/core';
import {OmpProcess} from '@piagent/omp';
import {EditorCompletion,parseEditorContext,documentRevision} from '../packages/piagent-core/dist/editor-completion.js';
import {startDaemon,PipeClient} from '@piagent/daemon';
const fixture=fileURLToPath(new URL('./fixtures/editor-omp.mjs',import.meta.url));

test('uncertain child shutdown closes the editor connection before another inference can spawn',{timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-editor-stop-fault-')),owned=new Set(),original=OmpProcess.prototype.stop;
 const service=new EditorCompletion({executable:process.execPath,cwd:root,executableArgs:[fixture]});
 OmpProcess.prototype.stop=function(){owned.add(this);return Promise.reject(new Error('Owned child shutdown outcome is uncertain'));};
 try{
  const request={requestId:'first',file:'New.cs',text:'return ',position:7,mode:'completion'};
  await assert.rejects(service.suggest(request,root),/shutdown outcome is uncertain/);assert.equal(owned.size,1);
  await assert.rejects(service.suggest({...request,requestId:'replacement'},root),/connection closed/);assert.equal(owned.size,1);
 }finally{OmpProcess.prototype.stop=original;for(const child of owned)await original.call(child);await service.close();await rm(root,{recursive:true,force:true});}
});

test('editor buffer identities permit new files without reading disk and preserve existing exclusions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-new-editor-'));try{
  const reader=await WorkspaceReader.create(root);await mkdir(join(root,'src'));assert.equal(await reader.validateEditorPath('src/New.cs'),'src/New.cs');
  await writeFile(join(root,'Existing.cs'),'old');await link(join(root,'Existing.cs'),join(root,'Linked.cs'));
  for(const path of ['../New.cs','.env','missing/New.cs','src','C:/New.cs','Linked.cs','src/con.cs','src/x.'])await assert.rejects(reader.validateEditorPath(path));
  await assert.rejects(readFile(join(root,'src','New.cs')),e=>e.code==='ENOENT');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('context windows translate offsets, preserve full revision and expose source-free phase measurements',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-window-')),observations=[];
 const service=new EditorCompletion({executable:process.execPath,cwd:root,executableArgs:[fixture]},event=>observations.push(event));
 try{
  const text='return ',revision=documentRevision('unobserved full buffer'),context={start:100,totalLength:200,revision};
  const result=await service.suggest({requestId:'window',file:'New.cs',text,position:7,mode:'completion',context},root);
  assert.equal(result.start,107);assert.equal(result.revision,revision);assert.equal(result.context.truncated,true);assert.equal(result.context.totalLength,200);
  for(const key of ['queueMs','readyMs','configureMs','inferenceMs','totalMs','contextBytes'])assert.ok(result.timing[key]>=0,key);
  assert.ok(result.timing.totalMs>=result.timing.inferenceMs);assert.ok(observations.some(e=>e.phase==='readyMs'));assert.doesNotMatch(JSON.stringify(observations),/return |full buffer|New.cs|requestId/);
  const wrong=[{...context,start:-1},{...context,totalLength:102},{...context,revision:'invalid'},{...context,extra:true}];for(const value of wrong)assert.throws(()=>parseEditorContext(value,text));
  await assert.rejects(service.suggest({requestId:'unicode',file:'New.cs',text:'🚀',position:1,mode:'completion'},root),/Unicode/);
  await assert.rejects(service.suggest({requestId:'recent',file:'New.cs',text,position:7,mode:'completion',recentEdits:[{start:0,command:'run'}]},root),/recent edits/);
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});

test('window inference is negotiated independently and a safe new buffer creates no disk file',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-editor-window-rpc-')),authFile=join(root,'private','token');
 const daemon=await startDaemon({pipeName:'piagent-window-'+randomUUID(),secure:{authFile},workspaceRoot:root,omp:{executable:process.execPath,cwd:root,executableArgs:[fixture]}}),clients=[];
 try{
  const connect=async capabilities=>{const c=await PipeClient.connect(daemon.path,{authFile});clients.push(c);return {c,reply:await c.request('adapter.hello',{protocolVersions:[1],capabilities,requiredCapabilities:capabilities,adapter:{kind:'test-ide',version:'1',ideVersion:'test',instanceId:randomUUID()}})};};
  const missing=await connect(['chat.v1','editor.context.v1']);assert.equal(missing.reply.error.code,-32004);
  const base=await connect(['chat.v1','editor.suggestions.v1']),rich=await connect(['chat.v1','editor.suggestions.v1','editor.context.v1']);
  const request={requestId:'one',workspaceUri:pathToFileURL(root).href,file:'New.cs',text:'return ',position:7,mode:'completion',context:{start:20,totalLength:100,revision:documentRevision('full document')}};
  assert.equal((await base.c.request('editor.suggest',request)).error.code,-32005);const result=(await rich.c.request('editor.suggest',request)).result;assert.equal(result.start,27);assert.equal(result.revision,request.context.revision);await assert.rejects(readFile(join(root,'New.cs')),e=>e.code==='ENOENT');
  assert.ok((await rich.c.request('editor.suggest',{...request,file:'../New.cs'})).error);assert.ok((await rich.c.request('editor.suggest',{...request,file:'.env'})).error);
 }finally{clients.forEach(c=>c.close());await daemon.close();await rm(root,{recursive:true,force:true});}
});
