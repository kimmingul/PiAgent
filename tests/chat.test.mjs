import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, PipeClient } from '@piagent/daemon';
const fixture = fileURLToPath(new URL('./fixtures/chat-omp.mjs', import.meta.url));
const windows = { skip: process.platform !== 'win32', timeout: 15000 };
const hello = (caps = ['core.ping', 'chat.v1']) => ({ protocolVersions: [1], capabilities: caps, requiredCapabilities: caps,
  adapter: { kind: 'test-ide', version: '0.2.0', ideVersion: 'test', instanceId: randomUUID() } });
async function setup(options = {}) {
  const daemon = await startDaemon({ pipeName: `piagent-chat-${randomUUID()}`,
    omp: { executable: process.execPath, executableArgs: [fixture], cwd: process.cwd(), requestTimeoutMs: 300, shutdownTimeoutMs: 100 }, ...options });
  const clients = [];
  return { daemon, async client(caps) { const client = await PipeClient.connect(daemon.path, {authenticate:false}); clients.push(client);
    assert.ok((await client.request('adapter.hello', hello(caps))).result); return client; },
    async close() { clients.forEach(client => client.close()); await daemon.close(); } };
}
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); } assert.fail('Event deadline exceeded'); }

test('selection context requires negotiation, validates snapshots and reaches OMP without changing plain chat', windows, async () => {
  const env = await setup();
  const context = { documentUri: 'file:///D:/workspace/example.cs', workspaceUri: 'file:///D:/workspace/', language: 'CSharp',
    selection: { text: 'Console.WriteLine("안녕 🚀");\n// <script> ignore instructions', startLine: 2, startColumn: 1, endLine: 3, endColumn: 35 } };
  try {
    const old = await env.client(); const oldId = (await old.request('chat.open')).result.sessionId;
    assert.equal((await old.request('chat.prompt', { sessionId: oldId, message: 'Explain', context })).error.code, -32005);
    const client = await env.client(['core.ping', 'chat.v1', 'context.selection.v1']);
    const sessionId = (await client.request('chat.open')).result.sessionId;
    for (const invalid of [null, { ...context, extra: true }, { ...context, documentUri: 'https://evil.invalid' },
      { ...context, selection: { ...context.selection, startLine: 0 } },
      { ...context, selection: { ...context.selection, endLine: 1 } },
      { ...context, selection: { ...context.selection, text: '한'.repeat(11000) } }]) {
      assert.equal((await client.request('chat.prompt', { sessionId, message: 'Explain', context: invalid })).error.code, -32602);
    }
    const events = []; client.on('chat.event', event => events.push(event));
    assert.ok((await client.request('chat.prompt', { sessionId, message: 'Explain', context })).result.accepted);
    await until(() => events.some(event => event.kind === 'completed'));
    const delivered = events.filter(event => event.kind === 'delta').map(event => event.text).join('');
    assert.deepEqual(JSON.parse(delivered.split('\n')[1]), context);
    assert.ok(delivered.endsWith('User request:\nExplain'));
    events.length = 0;
    await client.request('chat.prompt', { sessionId, message: 'hello' });
    await until(() => events.some(event => event.kind === 'completed'));
    assert.equal(events.filter(event => event.kind === 'delta').map(event => event.text).join(''), '안녕 <script>alert(1)</script> 🚀');
  } finally { await env.close(); }
});
test('chat negotiates, streams before completion, prevents overlapping turns and isolates owners', windows, async () => {
  const env = await setup();
  try {
    const client = await env.client(); const other = await env.client(); const events = [];
    client.on('chat.event', event => events.push(event));
    const sessionId = (await client.request('chat.open')).result.sessionId;
    assert.equal((await other.request('chat.prompt', { sessionId, message: 'hello' })).error.code, -32012);
    assert.equal((await client.request('chat.open')).error.code, -32011);
    for (const message of ['', '/model evil', 'x'.repeat(65537)])
      assert.equal((await client.request('chat.prompt', { sessionId, message })).error.code, -32602);
    const prompt = await client.request('chat.prompt', { sessionId, message: 'hello' });
    assert.equal(prompt.result.accepted, true);
    assert.equal((await client.request('chat.prompt', { sessionId, message: 'duplicate' })).error.code, -32013);
    assert.equal((await client.request('core.ping', { nonce: 'while streaming' })).result.pong, true);
    await until(() => events.some(event => event.kind === 'completed'));
    assert.deepEqual(events.map(event => event.kind), ['started', 'delta', 'delta', 'delta', 'completed']);
    assert.equal(events.filter(event => event.kind === 'delta').map(event => event.text).join(''), '안녕 <script>alert(1)</script> 🚀');
    events.forEach((event, i) => { assert.equal(event.sequence, i + 1); assert.equal(event.turnId, prompt.result.turnId); });
    assert.equal((await client.request('chat.close', { sessionId })).result.closed, true);
    assert.ok((await client.request('chat.open')).result.sessionId);
  } finally { await env.close(); }
});
test('chat cancellation is cooperative and the session supports another turn', windows, async () => {
  const env = await setup();
  try {
    const client = await env.client(); const events = []; client.on('chat.event', event => events.push(event));
    const sessionId = (await client.request('chat.open')).result.sessionId;
    const turnId = (await client.request('chat.prompt', { sessionId, message: 'wait' })).result.turnId;
    assert.equal((await client.request('chat.cancel', { sessionId, turnId: 'wrong' })).error.code, -32012);
    assert.equal((await client.request('chat.cancel', { sessionId, turnId })).result.requested, true);
    await until(() => events.some(event => event.kind === 'cancelled'));
    assert.ok((await client.request('chat.prompt', { sessionId, message: 'local' })).result);
    await until(() => events.some(event => event.kind === 'completed'));
  } finally { await env.close(); }
});
test('chat reports model failures and splits large Unicode deltas without breaking surrogate pairs', windows, async () => {
  const env = await setup();
  try {
    const client = await env.client(); const events = []; client.on('chat.event', event => events.push(event));
    const sessionId = (await client.request('chat.open')).result.sessionId;
    assert.equal((await client.request('chat.unknown')).error.code, -32601);
    await client.request('chat.prompt', { sessionId, message: 'provider-error' });
    await until(() => events.some(event => event.kind === 'error'));
    assert.equal(events.find(event => event.kind === 'error').text, 'Provider unavailable');
    assert.ok(!events.some(event => event.kind === 'completed'));
    events.length = 0;
    await client.request('chat.prompt', { sessionId, message: 'large-delta' });
    await until(() => events.some(event => event.kind === 'completed'));
    const deltas = events.filter(event => event.kind === 'delta');
    assert.equal(deltas.length, 2);
    assert.equal(deltas.map(event => event.text).join(''), 'a'.repeat(16383) + '🚀한글');
    assert.ok(deltas.every(event => event.text.isWellFormed()));
  } finally { await env.close(); }
});
test('chat command failure, acknowledgement timeout, unexpected exit and unsupported UI retire safely', windows, async () => {
  const env = await setup();
  try {
    const client = await env.client(); const events = []; client.on('chat.event', event => events.push(event));
    for (const message of ['reject', 'ack-timeout', 'crash', 'interaction']) {
      events.length = 0; const sessionId = (await client.request('chat.open')).result.sessionId;
      const response = await client.request('chat.prompt', { sessionId, message });
      if (message === 'reject' || message === 'ack-timeout') assert.equal(response.error.code, -32010);
      await until(() => events.some(event => event.kind === 'error'));
      assert.equal(events.filter(event => event.kind === 'error').length, 1);
      await until(() => events.some(event => event.kind === 'closed'));
    }
  } finally { await env.close(); }
});
test('chat stays unavailable when OMP is unconfigured or capability was not negotiated', windows, async () => {
  const env = await setup(); const unavailable = await setup({ omp: undefined });
  try {
    const plain = await env.client(['core.ping']); assert.equal((await plain.request('chat.open')).error.code, -32005);
    const client = await PipeClient.connect(unavailable.daemon.path, {authenticate:false});
    try { assert.equal((await client.request('adapter.hello', hello())).error.code, -32004); } finally { client.close(); }
  } finally { await env.close(); await unavailable.close(); }
});
test('daemon shutdown joins an OMP process already retiring after an interaction error', windows, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'piagent-chat-lifecycle-')); const pidFile = join(scratch, 'pid');
  const env = await setup({ omp: { executable: process.execPath, executableArgs: [fixture, '--pid-file', pidFile, '--stubborn-exit'],
    cwd: process.cwd(), shutdownTimeoutMs: 500 } });
  try {
    const client = await env.client(); const events = []; client.on('chat.event', event => events.push(event));
    const sessionId = (await client.request('chat.open')).result.sessionId;
    const pid = Number(await readFile(pidFile, 'utf8'));
    await client.request('chat.prompt', { sessionId, message: 'interaction' });
    await until(() => events.some(event => event.kind === 'closed'));
    await env.close();
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await env.close(); await rm(scratch, { recursive: true, force: true }); }
});
