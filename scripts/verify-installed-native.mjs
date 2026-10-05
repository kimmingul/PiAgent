// Opt-in acceptance against the running installed Core. Only the supplied scratch workspace is used.
import {PipeClient} from '@piagent/daemon';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [workspaceArg,outputArg]=process.argv.slice(2);
if(!workspaceArg||!outputArg)throw new Error('Usage: node scripts/verify-installed-native.mjs <scratch-workspace> <evidence.json>');
const workspace=resolve(workspaceArg),output=resolve(outputArg),events=[],checks=[];
await mkdir(workspace,{recursive:true});
const compactFixture=process.argv.includes('--compact-fixture');
if(compactFixture){await mkdir(join(workspace,'.omp'),{recursive:true});await writeFile(join(workspace,'.omp/config.yml'),'compaction:\n  keepRecentTokens: 100\n');}
const client=await PipeClient.connect('\\\\.\\pipe\\piagent-dev',{authFile:join(process.env.USERPROFILE,'.piagent/security/piagent-dev/token')});
let sessionId,heartbeat;
const rpc=async(method,params={})=>{const reply=await client.request(method,params);if(reply.error)throw new Error(`${method}: ${reply.error.message}`);return reply.result;};
const check=async(name,run)=>{try{const data=await run();checks.push({name,status:'PASS',data});console.log('PASS '+name);}catch(error){checks.push({name,status:'FAIL',error:error.message});console.log('FAIL '+name+': '+error.message);}await writeFile(output,JSON.stringify({at:new Date().toISOString(),workspace,level:'installed-core/native-OMP (separate test adapter, not installed IDE UI)',checks},null,2));};
const waitFor=async(test,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=test();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw new Error('Native event deadline exceeded');};
client.on('chat.event',event=>events.push(event));
try{
 await rpc('adapter.hello',{protocolVersions:[1],capabilities:['core.ping','chat.v1','chat.sessions.v1','chat.usage.v1','workspace.bind.v1','workspace.read.v1','workspace.edit.v1','workspace.edit.batch.v1','chat.approval.v1','omp.controls.v1'],adapter:{kind:'test-ide',version:'0.9.14',ideVersion:'installed-acceptance',instanceId:randomUUID()}});
 const opened=await rpc('chat.open',{workspaceUri:pathToFileURL(workspace).href});sessionId=opened.sessionId;
 const control=(command,fields={})=>rpc('omp.control',{sessionId,command,fields});
 heartbeat=setInterval(()=>void rpc('core.ping',{nonce:'installed-acceptance'}).catch(()=>{}),10000);
 await check('workspace/native binding',async()=>{assert.equal(opened.ompProfile,'native');assert.equal(opened.ompControlsEnabled,true);assert.equal(opened.workspaceUri,pathToFileURL(workspace).href);return opened;});
 await check('ping',()=>rpc('core.ping',{nonce:'installed-acceptance'}));
 await check('version/features',()=>control('feature_catalog'));
 await check('OMP settings schema (read only)',()=>control('feature_settings'));
 await check('state privacy',async()=>{const state=await control('get_state');assert.equal(state.sessionFile,undefined);assert.equal(state.systemPrompt,undefined);return state;});
 await check('model catalogue',async()=>{const data=await control('get_available_models');assert.ok(data.models.length>0);return {count:data.models.length};});
 await check('thinking catalogue',()=>control('get_available_thinking_levels'));
 await check('command catalogue',async()=>{const data=await control('get_available_commands');return {count:data.commands.length};});
 await check('role catalogue + project save + stale rejection',async()=>{let data=await control('model_roles',{scope:'project'});const original=data.roles.find(r=>r.id==='slow').projectValue;const before=data.revision;const model=data.models.find(m=>m.selector==='anthropic/claude-opus-5-5');assert.ok(model);try{data=await control('model_roles',{scope:'project',revision:before,changes:{slow:model.selector}});await assert.rejects(control('model_roles',{scope:'project',revision:before,changes:{slow:''}}));assert.equal(data.roles.find(r=>r.id==='slow').projectValue,model.selector);return {roles:data.roles.length,models:data.models.length,model:model.selector};}finally{const latest=await control('model_roles',{scope:'project'});await control('model_roles',{scope:'project',revision:latest.revision,changes:{slow:original}});}});
 for(const [command,fields] of [['set_fast_mode',{enabled:false}],['set_auto_compaction',{enabled:true}],['set_auto_retry',{enabled:true}],['set_cache_warming',{mode:'off'}],['set_steering_mode',{mode:'one-at-a-time'}],['set_follow_up_mode',{mode:'one-at-a-time'}],['set_interrupt_mode',{mode:'immediate'}],['abort_retry',{}],['get_subagents',{}]])await check(command,()=>control(command,fields));
 await check('malformed enum rejected',async()=>{await assert.rejects(control('set_interrupt_mode',{mode:'invented'}));return true;});
 await check('real prompt',async()=>{const start=events.length;await rpc('chat.prompt',{sessionId,message:'Acceptance test: without tools or file changes, reply with only the result of 11 + 31.'});const last=await waitFor(()=>events.slice(start).find(e=>['completed','error','cancelled'].includes(e.kind)));assert.equal(last.kind,'completed',JSON.stringify(last));const answer=events.slice(start).filter(e=>e.kind==='delta').map(e=>e.text).join('');assert.match(answer,/42/);return {terminal:last.kind,answer};});
 if(compactFixture)await check('compaction history preparation (synthetic test text)',async()=>{const start=events.length;await rpc('chat.prompt',{sessionId,message:'This is disposable synthetic acceptance data: '+('Menus toolbar document pane status bar. '.repeat(100))+'Without tools or file changes reply only: acceptance prepared.'});const terminal=await waitFor(()=>events.slice(start).find(e=>['completed','error','cancelled'].includes(e.kind)));assert.equal(terminal.kind,'completed');return {terminal:terminal.kind,projectKeepRecentTokens:100};});
 await check('usage',async()=>{const data=await rpc('chat.usage',{sessionId});assert.ok(data.tokens);return data;});
 await check('real compaction lifecycle',async()=>{const start=events.length;const data=await control('compact');assert.equal(data.accepted,true);await assert.rejects(rpc('chat.prompt',{sessionId,message:'must be blocked while compacting'}));const terminal=await waitFor(()=>events.slice(start).find(e=>e.frame?.type==='control_operation'&&['completed','failed'].includes(e.frame.state)),120000);assert.equal(terminal.frame.state,'completed',JSON.stringify(terminal.frame));return {ack:data,terminal:terminal.frame};});
 await check('post-compaction state',()=>control('get_state'));
 await rpc('chat.close',{sessionId});const savedSessionId=opened.savedSessionId;
 await check('session list and real resume',async()=>{const list=await rpc('sessions.list');assert.ok(list.sessions.some(s=>s.savedSessionId===savedSessionId));const resumed=await rpc('chat.open',{savedSessionId,workspaceUri:pathToFileURL(workspace).href});sessionId=resumed.sessionId;assert.equal(resumed.savedSessionId,savedSessionId);assert.ok(resumed.transcript.length>=2);return {savedSessionId,entries:resumed.transcript.length};});
}finally{clearInterval(heartbeat);if(sessionId)await rpc('chat.close',{sessionId}).catch(()=>{});client.close();}
if(checks.some(c=>c.status==='FAIL'))process.exitCode=1;
