import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const core=process.argv[2];
const {startDaemon,PipeClient}=core?await import(pathToFileURL(join(resolve(core),'node_modules/@piagent/daemon/dist/index.js'))):await import('@piagent/daemon');
const duration=630000,root=await mkdtemp(join(tmpdir(),'piagent-long-run-')),clients=[],events=[[],[]];let daemon;
const started=Date.now();
try {
  const authFile=join(root,'private','token');
  daemon=await startDaemon({pipeName:'piagent-long-'+randomUUID(),secure:{authFile},omp:{executable:process.execPath,executableArgs:[fileURLToPath(new URL('../tests/fixtures/chat-omp.mjs',import.meta.url)),'--long-run-ms',String(duration)],cwd:root}});
  const sessions=[];
  for(let i=0;i<2;i++){
    const client=await PipeClient.connect(daemon.path,{authFile});clients.push(client);
    await client.request('adapter.hello',{protocolVersions:[1],capabilities:['chat.v1','omp.controls.v1','core.ping'],adapter:{kind:'test-ide',version:'long-run',ideVersion:'test',instanceId:randomUUID()}});
    client.on('chat.event',event=>events[i].push(event));
    const {result}=await client.request('chat.open');assert.ok(result);
    const prompt=await client.request('chat.prompt',{sessionId:result.sessionId,message:i?'wait':'long-running'});assert.ok(prompt.result);
    sessions.push({sessionId:result.sessionId,turnId:prompt.result.turnId});
  }
  // No heartbeat requests: both active subagents and a completely silent provider must survive.
  while(Date.now()-started<duration+10000&&!events[0].some(e=>e.kind==='completed')){
    await delay(15000);
    for(const stream of events)assert.ok(!stream.some(e=>['closed','error','cancelled'].includes(e.kind)),JSON.stringify(stream.at(-1)));
    console.log(JSON.stringify({elapsedSeconds:Math.round((Date.now()-started)/1000),active:events[0].at(-1)?.kind,quiet:events[1].at(-1)?.kind}));
  }
  assert.ok(events[0].some(e=>e.kind==='completed'));
  assert.ok(events[0].filter(e=>e.kind==='delta').some(e=>e.text==='long-running-completed'));
  assert.ok(events[1].some(e=>e.kind==='activity'&&e.frame?.phase==='awaiting_progress'));
  assert.equal((await clients[1].request('core.ping')).result.pong,true);
  await clients[1].request('chat.cancel',sessions[1]);
  for(let n=0;n<100&&!events[1].some(e=>e.kind==='cancelled');n++)await delay(50);
  assert.equal(events[1].filter(e=>e.kind==='cancelled').length,1);
  console.log('PASS: >10 minutes active + silent authenticated sessions; completion and user cancellation');
  if(process.argv[3])await writeFile(process.argv[3],JSON.stringify({pass:true,elapsedMs:Date.now()-started,core:core??'workspace',activeEvents:events[0].length,quietEvents:events[1].length},null,2));
}finally{clients.forEach(c=>c.close());await daemon?.close();assert.ok(root.startsWith(join(tmpdir(),'piagent-long-run-')));await rm(root,{recursive:true,force:true});}
