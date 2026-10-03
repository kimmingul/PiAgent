// Opt-in real model call. Existing OMP credentials remain inside the OMP process.
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startDaemon, PipeClient } from '@piagent/daemon';
const [executable, cwd, message = 'Reply with exactly: PiAgent chat verified'] = process.argv.slice(2);
if (!executable || !cwd) throw new Error('Usage: node scripts/chat-smoke.mjs <omp.exe> <scratch-workspace> [message]');
const daemon = await startDaemon({ pipeName: `piagent-live-chat-${randomUUID()}`, omp: { executable: resolve(executable), cwd: resolve(cwd) } });
let client; let heartbeat; let timer;
try {
  client = await PipeClient.connect(daemon.path);
  const rpc = async (method, params = {}) => { const reply = await client.request(method, params); if (reply.error) throw new Error(reply.error.message); return reply.result; };
  await rpc('adapter.hello', { protocolVersions: [1], capabilities: ['core.ping', 'chat.v1'], requiredCapabilities: ['chat.v1'],
    adapter: { kind: 'test-ide', version: '0.2.0', ideVersion: 'live-smoke', instanceId: randomUUID() } });
  const { sessionId } = await rpc('chat.open');
  let text = ''; let terminal;
  const completed = new Promise((accept, reject) => {
    timer = setTimeout(() => reject(new Error('Chat smoke terminal deadline exceeded')), 60000);
    client.on('chat.event', event => {
      if (event.sessionId !== sessionId) return;
      if (event.kind === 'delta') text += event.text;
      if (event.kind === 'completed' || event.kind === 'cancelled') { terminal = event.kind; accept(); }
      if (event.kind === 'error') reject(new Error(event.text));
    });
  });
  // Attach rejection handling before a prompt can fail synchronously.
  completed.catch(() => {});
  heartbeat = setInterval(() => { void rpc('core.ping', { nonce: 'live-smoke' }).catch(() => {}); }, 10000);
  await rpc('chat.prompt', { sessionId, message }); await completed;
  console.log(JSON.stringify({ terminal, text })); await rpc('chat.close', { sessionId });
} finally { clearInterval(heartbeat); clearTimeout(timer); client?.close(); await daemon.close(); }
