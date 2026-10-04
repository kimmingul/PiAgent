import readline from 'node:readline';
import { writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
if (process.argv.includes('usage')) {
  console.log(JSON.stringify({reports:[{provider:'fixture',metadata:{planType:'Test'},limits:[{label:'Weekly',amount:{usedFraction:0.25},window:{resetsAt:1800000000000}}]}]})); process.exit(0);
}
const directoryIndex = process.argv.indexOf('--session-dir');
const directory = directoryIndex === -1 ? undefined : process.argv[directoryIndex + 1];
let sessionFile, previousMessages=[];
const emit = frame => process.stdout.write(JSON.stringify(frame) + '\n');
const pidFile = process.argv.indexOf('--pid-file');
if (pidFile !== -1) writeFileSync(process.argv[pidFile + 1], String(process.pid));
for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-title', '--no-pty'])
  if (!process.argv.includes(flag)) process.exit(2);
if (!directory && !process.argv.includes('--no-session')) process.exit(2);
emit({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2] });
let timers = []; let active = false; let tools = []; let toolMode = '';
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const command = JSON.parse(line);
  if (command.type === 'host_tool_result') {
    if (toolMode === 'workspace-cancel') process.exit(9); // A cancelled call must not receive a result.
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: command.isError ? 'tool-error' : command.result.content[0].text } });
    emit({ type: 'agent_end', isTerminal: true }); return;
  }
  const response = data => emit({ type: 'response', id: command.id, command: command.type, success: true, data });
  if (command.type === 'new_session') {
    if (directory) { mkdirSync(directory,{recursive:true}); sessionFile=join(directory,randomUUID()+'.jsonl');writeFileSync(sessionFile,''); }
    response({ argv: process.argv.slice(2) }); return;
  }
  if (command.type === 'switch_session') { sessionFile=command.sessionPath;previousMessages=readFileSync(sessionFile,'utf8').split('\n').filter(Boolean).map(JSON.parse);response({cancelled:false});return; }
  if (command.type === 'get_state') { response({sessionFile,model:{provider:'fixture',id:'test-model'}});return; }
  if (command.type === 'get_session_stats') { response({tokens:{input:10,output:20,total:30},cost:0.004,premiumRequests:0,contextUsage:{tokens:30,contextWindow:200000}});return; }
  if (command.type === 'set_host_tools') { tools = command.tools; response({}); return; }
  if (command.type === 'abort') {
    timers.forEach(clearTimeout); timers = []; active = false;
    emit({ type: 'agent_end', isTerminal: true }); response({}); return;
  }
  if (command.type !== 'prompt') { response({}); return; }
  active = true; emit({ type: 'agent_start' });
  if (command.message === 'ack-timeout') return;
  if (command.message === 'reject') { emit({ type: 'response', id: command.id, command: 'prompt', success: false }); active = false; return; }
  if (command.message === 'local') { response({ agentInvoked: false }); return; }
  response({});
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
  if (command.message === 'interaction') { emit({ type: 'extension_ui_request', id: 'ask', method: 'select' }); return; }
  ['안녕 ', '<script>alert(1)</script> ', '🚀'].forEach((delta, index) => {
    timers.push(setTimeout(() => emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } }), 40 + index * 20));
  });
  timers.push(setTimeout(() => emit({ type: 'agent_end', isTerminal: false }), 100));
  timers.push(setTimeout(() => { active = false; emit({ type: 'agent_end', isTerminal: true }); }, 140));
});
lines.on('close', () => { timers.forEach(clearTimeout); if (process.argv.includes('--stubborn-exit')) setInterval(() => {}, 1000); else process.exit(0); });
