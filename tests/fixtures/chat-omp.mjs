import readline from 'node:readline';
import { writeFileSync } from 'node:fs';
const emit = frame => process.stdout.write(JSON.stringify(frame) + '\n');
const pidFile = process.argv.indexOf('--pid-file');
if (pidFile !== -1) writeFileSync(process.argv[pidFile + 1], String(process.pid));
for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-session', '--no-title', '--no-pty'])
  if (!process.argv.includes(flag)) process.exit(2);
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
  if (command.type === 'new_session') { response({ argv: process.argv.slice(2) }); return; }
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
  if (command.message.startsWith('workspace-')) {
    if (tools.length !== 2 || !tools.some(t => t.name === 'workspace_read_file') || !tools.some(t => t.name === 'workspace_search')) process.exit(8);
    toolMode = command.message;
    emit({ type: 'host_tool_call', id: 'host-read', toolCallId: 'read-1', toolName: 'workspace_read_file',
      arguments: { path: toolMode === 'workspace-deny' ? '../outside.txt' : 'Example.cs', startLine: 2, maxLines: 1 } });
    if (toolMode === 'workspace-duplicate') emit({ type: 'host_tool_call', id: 'host-read', toolCallId: 'read-2', toolName: 'workspace_read_file', arguments: { path: 'Example.cs' } });
    if (toolMode === 'workspace-cancel') emit({ type: 'host_tool_cancel', targetId: 'host-read' });
    return;
  }
  if (command.message.startsWith('PiAgent IDE context v1')) {
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
