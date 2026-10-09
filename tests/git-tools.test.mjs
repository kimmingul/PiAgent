import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {GitTools} from '../packages/piagent-core/dist/git-tools.js';
import {IdeBridge} from '../packages/piagent-core/dist/ide-tools.js';
import {startDaemon,PipeClient} from '@piagent/daemon';
const run=promisify(execFile),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function repository(){const root=await mkdtemp(join(tmpdir(),'piagent-git-tools-'));const git=async(...args)=>(await run('git',args,{cwd:root,windowsHide:true})).stdout;await git('init');await git('config','user.name','Fixture');await git('config','user.email','fixture@example.test');await writeFile(join(root,'File.cs'),'before\n');await git('add','File.cs');await git('commit','-m','Initial');await writeFile(join(root,'File.cs'),'after\n');return {root,git};}

test('Git consent displays immutable stage changes, preserves denied index and blocks plan writes',async()=>{
 const {root,git}=await repository(),frames=[],consent=new IdeBridge(frame=>frames.push(frame)),tools=new GitTools(root,consent);
 try{
  const preview=await tools.execute({operation:'preview-stage',files:['File.cs']},new AbortController().signal),args={operation:'apply',previewId:preview.previewId,revision:preview.revision};
  await assert.rejects(tools.execute(args,new AbortController().signal),/disabled/);assert.equal((await git('diff','--cached')).trim(),'');tools.writesEnabled=true;
  const denied=tools.execute(args,new AbortController().signal);await tick();const approval=frames.find(f=>f.type==='designer_approval');assert.match(approval.reason,/index/);assert.match(approval.diff,/\+after/);consent.decide(approval.proposalId,false);assert.equal((await denied).executed,false);assert.equal((await git('diff','--cached')).trim(),'');
  frames.length=0;const approved=tools.execute(args,new AbortController().signal);await tick();consent.decide(frames.find(f=>f.type==='designer_approval').proposalId,true);assert.equal((await approved).executed,true);assert.match(await git('diff','--cached'),/\+after/);
  await assert.rejects(tools.execute(args,new AbortController().signal),/expired/);
 }finally{tools.close();consent.close();await rm(root,{recursive:true,force:true});}
});

test('authenticated Git host tools negotiate independently and apply requires concrete owning-adapter consent',{skip:process.platform!=='win32',timeout:20000},async()=>{
 const {root,git}=await repository(),authFile=join(root,'private','token'),fixture=fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url));
 const daemon=await startDaemon({pipeName:'piagent-git-tools-'+randomUUID(),secure:{authFile},workspaceRoot:root,allowWrites:true,omp:{executable:process.execPath,cwd:root,executableArgs:[fixture]}}),client=await PipeClient.connect(daemon.path,{authFile});
 try{
  const caps=['chat.v1','workspace.read.v1','workspace.edit.v1','workspace.git.v1'];assert.ok((await client.request('adapter.hello',{protocolVersions:[1],capabilities:caps,requiredCapabilities:caps,adapter:{kind:'test-ide',version:'1',ideVersion:'test',instanceId:randomUUID()}})).result);
  const opened=(await client.request('chat.open',{})).result;assert.equal(opened.gitToolsEnabled,true);
  const ask=async(args,decision=false)=>{
    let answer='';const done=new Promise((resolve,reject)=>{
      const listener=e=>{if(e.kind==='delta')answer+=e.text;if(e.frame?.type==='designer_approval'){assert.match(e.frame.diff,/before|after/);void client.request('designer.decide',{sessionId:opened.sessionId,proposalId:e.frame.proposalId,approved:decision}).catch(reject);}if(['completed','error','cancelled'].includes(e.kind)){client.off('chat.event',listener);if(e.kind==='completed')resolve();else reject(new Error(e.kind));}};client.on('chat.event',listener);
    });assert.ok((await client.request('chat.prompt',{sessionId:opened.sessionId,message:'PIAGENT_GIT_TOOL:'+JSON.stringify(args)})).result);await done;return JSON.parse(answer);
  };
  const preview=await ask({operation:'preview-stage',files:['File.cs']}),args={operation:'apply',previewId:preview.previewId,revision:preview.revision};assert.match(preview.diff,/\+after/);
  assert.equal((await ask(args,false)).executed,false);assert.equal((await git('diff','--cached')).trim(),'');assert.equal((await ask(args,true)).executed,true);assert.match(await git('diff','--cached'),/\+after/);
 }finally{client.close();await daemon.close();await rm(root,{recursive:true,force:true});}
});
