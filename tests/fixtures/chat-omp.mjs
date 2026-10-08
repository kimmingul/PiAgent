import readline from 'node:readline';
import { writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
if (process.argv.includes('usage')) {
  console.log(JSON.stringify({reports:[{provider:'fixture',metadata:{planType:'Test'},limits:[{label:'Weekly',amount:{usedFraction:0.25},window:{resetsAt:1800000000000}}]}]})); process.exit(0);
}
if (process.argv[2] === 'plugin') {
  if (process.argv[3] !== 'list' || process.argv[4] !== '--json') process.exit(2);
  console.log(JSON.stringify({npm:[{name:'fixture-plugin',enabled:true}],marketplace:[]})); process.exit(0);
}
const directoryIndex = process.argv.indexOf('--session-dir');
const directory = directoryIndex === -1 ? undefined : process.argv[directoryIndex + 1];
let sessionFile, previousMessages=[];
if(directory){mkdirSync(directory,{recursive:true});sessionFile=join(directory,randomUUID()+'.jsonl');const resume=process.argv.indexOf('--resume'),fork=process.argv.indexOf('--fork');if(resume!==-1)sessionFile=process.argv[resume+1];else writeFileSync(sessionFile,fork!==-1?readFileSync(process.argv[fork+1]):'');previousMessages=readFileSync(sessionFile,'utf8').split('\n').filter(Boolean).map(JSON.parse);}
const emit = frame => process.stdout.write(JSON.stringify(frame) + '\n');
const pidFile = process.argv.indexOf('--pid-file');
if (pidFile !== -1) writeFileSync(process.argv[pidFile + 1], String(process.pid));
for (const flag of (process.argv.includes('--approval-mode') ? ['--no-title','--no-pty'] : ['--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-title', '--no-pty']))
  if (!process.argv.includes(flag)) process.exit(2);
if (!directory && !process.argv.includes('--no-session')) process.exit(2);
emit({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2] });
let timers = []; let active = false; let tools = []; let toolMode = '';let loginRequest;
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const command = JSON.parse(line);
  if (command.type === 'host_tool_result') {
    if (toolMode === 'workspace-cancel') process.exit(9); // A cancelled call must not receive a result.
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: command.isError ? 'tool-error' : command.result.content[0].text } });
    emit({ type: 'agent_end', isTerminal: true }); return;
  }
  const response = data => emit({ type: 'response', id: command.id, command: command.type, success: true, data });
  if(command.type==='compact'){setTimeout(()=>response({summary:'fixture compacted'}),400);return;}
  if(command.type==='get_login_providers'){response({providers:[{id:'fixture',name:'Fixture',available:true,authenticated:false}]});return;}
  if(command.type==='login'){loginRequest=command;emit({type:'extension_ui_request',id:'oauth-code',method:'input',title:'Fixture OAuth code'});return;}
  if(command.type==='extension_ui_response'&&command.id==='oauth-code'){emit({type:'response',id:loginRequest.id,command:'login',success:true,data:{providerId:'fixture'}});return;}
  if (command.type === 'new_session') {
    if (directory) { mkdirSync(directory,{recursive:true}); sessionFile=join(directory,randomUUID()+'.jsonl');writeFileSync(sessionFile,''); }
    response({ argv: process.argv.slice(2) }); return;
  }
  if (command.type === 'switch_session') { sessionFile=command.sessionPath;previousMessages=readFileSync(sessionFile,'utf8').split('\n').filter(Boolean).map(JSON.parse);response({cancelled:false});return; }
  if (command.type === 'fork') { const source=sessionFile;sessionFile=join(directory,randomUUID()+'.jsonl');writeFileSync(sessionFile,readFileSync(source));response({cancelled:false});return; }
  if(command.type==='export_html'){writeFileSync(command.outputPath,'<!doctype html><title>Fixture export</title>');response({path:command.outputPath});return;}
  if(command.type==='get_available_commands'){response({commands:[{name:'model',description:'Model'},{name:'fixture-command',description:'Fixture'}]});return;}
  if (command.type === 'get_state') { response({sessionFile,model:{provider:'fixture',id:'test-model'}});return; }
  if (command.type === 'get_session_stats') { response({tokens:{input:10,output:20,total:30},cost:0.004,premiumRequests:0,contextUsage:{tokens:30,contextWindow:200000}});return; }
  if (command.type === 'set_host_tools') { tools = command.tools; response({}); return; }
  if (command.type === 'abort') {
    if (process.argv.includes('--ignore-abort')) return;
    timers.forEach(clearTimeout); timers = []; active = false;
    if(process.argv.includes('--approval-mode'))emit({type:'session_settled',status:'aborted'});
    emit({ type: 'agent_end', isTerminal: true }); response({}); return;
  }
  if(command.type==='follow_up'&&toolMode==='busy-prompt') {
    if(command.message==='busy-queue-failure'){emit({type:'response',id:command.id,command:command.type,success:false,error:'Queue unavailable'});return;}
    response({});timers.push(setTimeout(()=>{
      active=false;emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Queued request completed once'}});
      emit({type:'session_settled',status:'completed'});
    },100));return;
  }
  if (command.type !== 'prompt') { response({}); return; }
  active = true; emit({ type: 'agent_start' });
  if(command.message==='busy-prompt'||command.message==='busy-queue-failure') {
    toolMode='busy-prompt';emit({type:'response',id:command.id,command:'prompt',success:false,error:'Agent is already streaming. Specify streamingBehavior.'});
    timers.push(setTimeout(()=>emit({type:'prompt_result',id:command.id,agentInvoked:false,status:'error',sessionSettled:false,error:{message:'Agent is already streaming'}}),0));return;
  }
  if (command.message === 'ack-timeout') return;
  if (command.message === 'reject') { emit({ type: 'response', id: command.id, command: 'prompt', success: false }); active = false; return; }
  if (command.message === 'local') { response({ agentInvoked: false });if(process.argv.includes('--approval-mode'))emit({type:'prompt_result',agentInvoked:false,status:'completed',sessionSettled:true}); return; }
  if(command.message==='local-background') {
    response({agentInvoked:false});emit({type:'prompt_result',agentInvoked:false,status:'completed',sessionSettled:false});
    timers.push(setTimeout(()=>{active=false;emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Background work completed'}});emit({type:'session_settled',status:'completed'});},250));return;
  }
  if (command.message === 'slow-ack') {setTimeout(()=>{response({});emit({type:'agent_end',isTerminal:true});},6500);return;}
  response({});
  if(command.message==='abort-resume'||command.message==='abort-settle') {
    emit({type:'auto_compaction_start'});emit({type:'auto_compaction_end',aborted:false});
    emit({type:'message_end',message:{role:'assistant',stopReason:'aborted',errorMessage:'Request was aborted'}});
    emit({type:'agent_end',isTerminal:true});
    emit({type:'prompt_result',status:'aborted',sessionSettled:false});
    timers.push(setTimeout(()=>{
      active=false;
      if(command.message==='abort-resume')emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Continued after assistant abort'}});
      emit({type:'session_settled',status:command.message==='abort-resume'?'completed':'aborted'});
      emit({type:'prompt_result',status:command.message==='abort-resume'?'completed':'aborted',sessionSettled:true});
    },250));return;
  }
  if(command.message.startsWith('retry-')) {
    emit({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'Socket closed before response completed'}});
    emit({type:'agent_end',isTerminal:true});
    emit({type:'auto_retry_start',errorMessage:'Socket closed before response completed'});
    if(command.message==='retry-wait')return;
    timers.push(setTimeout(()=>{
      if(command.message==='retry-crash'){process.exit(7);return;}
      if(command.message==='retry-failure'){
        emit({type:'auto_retry_end',success:false,finalError:'Provider retry exhausted'});
        emit({type:'session_settled',status:'error'});return;
      }
      emit({type:'tool_execution_start',toolCallId:'retry-tool',toolName:'fixture'});
      emit({type:'tool_execution_end',toolCallId:'retry-tool',toolName:'fixture',isError:false,result:{content:[{type:'text',text:'tool succeeded'}]}});
      emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Recovered final answer'}});
      emit({type:'message_end',message:{role:'assistant',stopReason:'stop'}});
      emit({type:'auto_retry_end',success:true});
      emit({type:'session_settled',status:'completed'});
      emit({type:'prompt_result',status:'completed',sessionSettled:true});
    },250));return;
  }
  if(command.message.startsWith('/mcp ')) {
    timers.push(setTimeout(()=>{
      const [,action,id]=command.message.split(' '),path=join(process.cwd(),'.omp','mcp.json');
      const config=JSON.parse(readFileSync(path,'utf8'));config.mcpServers[id].enabled=action==='enable';
      writeFileSync(path,JSON.stringify(config));active=false;
      emit({type:'prompt_result',agentInvoked:false,status:'completed',sessionSettled:true});
    },200));return;
  }
  const prior=previousMessages.slice(); previousMessages.push(command.message);
  if(sessionFile) appendFileSync(sessionFile,JSON.stringify(command.message)+'\n');
  if(command.message==='recall') {emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:prior.join('|')}});emit({type:'agent_end',isTerminal:true});return;}
  // RAD advertises designer support, so Core prefixes its workflow instructions.
  // Keep this batch fixture exercising the requested edit through that real path.
  if (command.message === 'propose-batch' ||
      (command.message.startsWith('PiAgent GUI development workflow:') && command.message.endsWith('\n\npropose-batch'))) {
    toolMode='propose-batch'; emit({type:'host_tool_call',id:'host-edit',toolCallId:'edit-1',toolName:'workspace_propose_changes',arguments:{files:[{path:'Example.cs',content:'updated first\r\n'},{path:'Second.cs',content:'updated second\n'}],reason:'Update two files'}});return;
  }
  if (command.message === 'propose-edit') {
    if (!tools.some(t => t.name === 'workspace_propose_edit')) process.exit(8);
    toolMode = 'propose-edit';
    emit({type:'host_tool_call',id:'host-edit',toolCallId:'edit-1',toolName:'workspace_propose_edit',
      arguments:{path:'Example.cs',content:'int Double(int value) { return value * 3; }\r\n',reason:'Test edit: multiply by three'}}); return;
  }
  if (command.message.startsWith('workspace-')) {
    if (tools.length !== 2 || !tools.some(t => t.name === 'workspace_read_file') || !tools.some(t => t.name === 'workspace_search')) process.exit(8);
    toolMode = command.message;
    emit({ type: 'host_tool_call', id: 'host-read', toolCallId: 'read-1', toolName: 'workspace_read_file',
      arguments: { path: toolMode === 'workspace-deny' ? '../outside.txt' : 'Example.cs', startLine: 2, maxLines: 1 } });
    if (toolMode === 'workspace-duplicate') emit({ type: 'host_tool_call', id: 'host-read', toolCallId: 'read-2', toolName: 'workspace_read_file', arguments: { path: 'Example.cs' } });
    if (toolMode === 'workspace-cancel') emit({ type: 'host_tool_cancel', targetId: 'host-read' });
    return;
  }
  if (command.message.startsWith('PiAgent IDE context v1') || command.message.startsWith('PiAgent GUI development workflow:')) {
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: command.message } });
    emit({ type: 'agent_end', isTerminal: true }); return;
  }
  if (command.message === 'provider-error') {
    emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Provider unavailable' } });
    emit({ type: 'agent_end', isTerminal: true }); return;
  }
  if (command.message === 'large-delta') {
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'a'.repeat(16383) + '🚀한글' } });
    emit({ type: 'agent_end', isTerminal: true }); return;
  }
  if (command.message === 'crash') { setTimeout(() => process.exit(7), 10); return; }
  if (command.message === 'wait') return;
  if (command.message === 'long-running') {
    const duration=Number(process.argv[process.argv.indexOf('--long-run-ms')+1])||630000;
    emit({type:'tool_execution_start',toolCallId:'long-tool',toolName:'fixture'});
    const progress=()=>emit({type:'subagent_progress',payload:{progress:{id:'long-agent',status:'running',agent:'fixture',lastIntent:'Long duration transport check'}}});
    progress(); const pulse=setInterval(progress,10000); timers.push(pulse);
    timers.push(setTimeout(()=>{clearInterval(pulse);active=false;
      emit({type:'subagent_lifecycle',payload:{id:'long-agent',status:'completed'}});
      emit({type:'tool_execution_end',toolCallId:'long-tool',toolName:'fixture',isError:false});
      emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'long-running-completed'}});
      emit({type:'session_settled',status:'completed'});emit({type:'agent_end',isTerminal:true});
    },duration));return;
  }
  if (command.message === 'interaction') { emit({ type: 'extension_ui_request', id: 'ask', method: 'select' }); return; }
  ['안녕 ', '<script>alert(1)</script> ', '🚀'].forEach((delta, index) => {
    timers.push(setTimeout(() => emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } }), 40 + index * 20));
  });
  timers.push(setTimeout(() => emit({ type: 'agent_end', isTerminal: false }), 100));
  timers.push(setTimeout(() => { active = false; emit({ type: 'agent_end', isTerminal: true }); }, 140));
});
lines.on('close', () => { timers.forEach(clearTimeout); if (process.argv.includes('--stubborn-exit')) setInterval(() => {}, 1000); else process.exit(0); });
