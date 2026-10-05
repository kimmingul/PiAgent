import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {control,validateControl} from '../packages/piagent-core/dist/omp-controls.js';
import {modelRoles} from '../packages/piagent-core/dist/model-roles.js';
import {projectConfig,writeProjectRoles} from '../packages/piagent-core/dist/project-config.js';
import {Controller} from '../ui/dist/controller.js';
import {ompSettings} from '../packages/piagent-core/dist/omp-settings.js';
import {startDaemon,PipeClient} from '@piagent/daemon';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

test('execution controls validate OMP enum values and never forward malformed or busy compaction',async()=>{
 const sent=[];const omp={request:async(command,fields)=>{sent.push({command,fields});return {data:{}};}};
 for(const command of ['set_steering_mode','set_follow_up_mode']){await control(omp,command,{mode:'all'},false);await assert.rejects(control(omp,command,{mode:'one'},false));}
 await control(omp,'set_interrupt_mode',{mode:'wait'},false);await control(omp,'compact',{},false);
 await assert.rejects(control(omp,'compact',{},true));await assert.rejects(control(omp,'compact',{sessionPath:'outside'},false));await assert.rejects(control(omp,'compact',{customInstructions:'x'.repeat(65537)},false));
 assert.equal(sent.length,4);assert.throws(()=>validateControl('set_fast_mode',{enabled:'true'},false));
});
test('subagent snapshots and state omit private paths and raw prompts',async()=>{
 const omp={request:async(command)=>({data:command==='get_state'?{sessionFile:'private',systemPrompt:'secret',steeringMode:'all',fastModeActive:true}:{subagents:[{id:'a',agent:'scout',status:'running',sessionFile:'secret',progress:{systemPrompt:'private'}}]}})};
 assert.deepEqual(await control(omp,'get_state',{},false),{steeringMode:'all',fastModeActive:true});assert.deepEqual(await control(omp,'get_subagents',{},false),{subagents:[{id:'a',agent:'scout',status:'running'}]});
});
test('project model roles preserve YAML comments, reject stale files and refuse junctions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-project-settings-')),other=await mkdtemp(join(tmpdir(),'piagent-settings-outside-'));
 try{await mkdir(join(root,'.omp'));await writeFile(join(root,'.omp','config.yml'),'# keep this\nadvisor:\n  enabled: true\nmodelRoles:\n  slow: fixture/reasoning:low\n');const snapshot=await projectConfig(root);await writeProjectRoles(root,snapshot.text,{slow:'fixture/reasoning:high'});const text=await readFile(join(root,'.omp','config.yml'),'utf8');assert.match(text,/# keep this/);assert.match(text,/enabled: true/);assert.match(text,/reasoning:high/);await assert.rejects(writeProjectRoles(root,snapshot.text,{}),/changed/);
  await rm(join(root,'.omp'),{recursive:true});await symlink(other,join(root,'.omp'),process.platform==='win32'?'junction':'dir');await assert.rejects(projectConfig(root),/Unsafe/);await assert.rejects(writeProjectRoles(root,'',{}),/Unsafe/);
 }finally{await rm(root,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
});
test('presets are global-owned, apply roles to selected project and retain unrelated config',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-presets-'));const options={executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/role-config.mjs',import.meta.url))],cwd:root};
 try{await writeFile(join(root,'config.yml'),JSON.stringify({modelRoles:{slow:'fixture/reasoning:high'},unrelated:true}));let snapshot=await modelRoles(options);snapshot=await modelRoles(options,{revision:snapshot.revision,op:'preset_save',name:'coding'});assert.equal(snapshot.presets.coding.global,true);
  snapshot=await modelRoles(options,{revision:snapshot.revision,op:'preset_apply',name:'coding',scope:'project'});assert.equal((await projectConfig(root)).roles.slow,'fixture/reasoning:high');assert.equal(snapshot.storageScope,'project');
  snapshot=await modelRoles(options,{revision:snapshot.revision,scope:'project',changes:{slow:'fixture/reasoning:low'}});assert.equal((await projectConfig(root)).roles.slow,'fixture/reasoning:low');assert.equal(JSON.parse(await readFile(join(root,'config.yml'),'utf8')).modelRoles.slow,'fixture/reasoning:high');
  snapshot=await modelRoles(options,{revision:snapshot.revision,op:'preset_delete',name:'coding'});assert.equal(snapshot.presets.coding,undefined);assert.equal(JSON.parse(await readFile(join(root,'config.yml'),'utf8')).unrelated,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('maintenance events survive acknowledgement races and subagent controls stay inside settings',()=>{
 const sent=[],results=[],events=[],caps=[];const controller=new Controller(f=>sent.push(f),{emit(){},list(){},capabilities:f=>caps.push(f),executionResult:(...args)=>results.push(args),executionEvent:f=>events.push(f)});
 controller.receive({type:'session',sessionId:'s',ompControlsEnabled:true,ompProfile:'native'});controller.action({t:'executionControl',command:'compact'});assert.equal(sent.at(-1).command,'compact');assert.equal(caps.at(-1).busy,true);
 for(const [sequence,state]of [[1,'running'],[2,'completed']])controller.receive({type:'event',data:{sessionId:'s',sequence,kind:'omp_event',frame:{type:'control_operation',operationId:'op',command:'compact',state}}});
 controller.receive({type:'ompControl',command:'compact',data:{accepted:true,operationId:'op'}});assert.equal(caps.at(-1).busy,false);assert.equal(results.length,0);assert.equal(events.at(-1).state,'completed');
 controller.action({t:'executionControl',command:'get_subagent_messages',fields:{subagentId:'a'}});controller.receive({type:'ompControl',command:'get_subagent_messages',data:{messages:[]}});assert.equal(results.at(-1)[0],'get_subagent_messages');
 controller.action({t:'executionControl',command:'switch_session',fields:{sessionPath:'outside'}});assert.notEqual(sent.at(-1).command,'switch_session');
});
test('OMP feature settings expose only discovered non-secret booleans and detect stale edits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-feature-settings-'));const options={executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/role-config.mjs',import.meta.url))],cwd:root};
 try{await writeFile(join(root,'config.yml'),JSON.stringify({'advisor.enabled':false,'prewalk.enabled':false,'auth.token':'secret',unrelated:true}));const snapshot=await ompSettings(options,{});assert.deepEqual(snapshot.settings.map(item=>item.key),['advisor.enabled','prewalk.enabled']);assert.ok(!JSON.stringify(snapshot).includes('secret'));await assert.rejects(ompSettings(options,{key:'auth.token',value:true,revision:snapshot.revision}),/Unsupported/);const saved=await ompSettings(options,{key:'advisor.enabled',value:true,revision:snapshot.revision});assert.equal(saved.settings[0].value,true);await assert.rejects(ompSettings(options,{key:'prewalk.enabled',value:true,revision:snapshot.revision}),/changed/);assert.equal(JSON.parse(await readFile(join(root,'config.yml'),'utf8')).unrelated,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Named Pipe compaction acknowledges before completion, excludes prompts and releases idle state',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-compact-pipe-')),authFile=join(root,'private','token'),frames=[];let daemon,client;
 try{const run=promisify(execFile);await run('git',['init'],{cwd:root,windowsHide:true});await writeFile(join(root,'Fixture.txt'),'fixture');await run('git',['add','Fixture.txt'],{cwd:root,windowsHide:true});await run('git',['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','Fixture'],{cwd:root,windowsHide:true});daemon=await startDaemon({pipeName:'piagent-compact-'+randomUUID(),secure:{authFile},workspaceRoot:root,allowWrites:true,omp:{executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:root,profile:'native'}});client=await PipeClient.connect(daemon.path,{authFile});await client.request('adapter.hello',{protocolVersions:[1],capabilities:['chat.v1','chat.sessions.v1','omp.controls.v1','workspace.read.v1','workspace.edit.v1','chat.approval.v1'],adapter:{kind:'test-ide',version:'test',ideVersion:'test',instanceId:randomUUID()}});const opened=await client.request('chat.open');assert.ok(opened.result,JSON.stringify(opened));const params={sessionId:opened.result.sessionId};client.on('chat.event',frame=>frames.push(frame));const accepted=await client.request('omp.control',{...params,command:'compact'});assert.equal(accepted.result.accepted,true);assert.ok(frames.some(frame=>frame.frame?.state==='running'));assert.ok(!frames.some(frame=>frame.frame?.state==='completed'));assert.ok((await client.request('chat.prompt',{...params,message:'blocked'})).error);
  for(let i=0;i<200&&!frames.some(frame=>frame.frame?.state==='completed');i++)await delay(10);assert.ok(frames.some(frame=>frame.frame?.state==='completed'));assert.equal((await client.request('chat.prompt',{...params,message:'local'})).result.accepted,true);
 }finally{client?.close();await daemon?.close();await rm(root,{recursive:true,force:true});}
});
