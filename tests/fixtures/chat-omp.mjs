import readline from 'node:readline';
import { writeFileSync } from 'node:fs';
const emit = frame => process.stdout.write(JSON.stringify(frame) + '\n');
const pidFile = process.argv.indexOf('--pid-file');
if (pidFile !== -1) writeFileSync(process.argv[pidFile + 1], String(process.pid));
for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-session', '--no-title', '--no-pty'])
  if (!process.argv.includes(flag)) process.exit(2);
emit({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2] });
let timers = []; let active = false;
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const command = JSON.parse(line);
  const response = data => emit({ type: 'response', id: command.id, command: command.type, success: true, data });
  if (command.type === 'new_session') { response({ argv: process.argv.slice(2) }); return; }
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
