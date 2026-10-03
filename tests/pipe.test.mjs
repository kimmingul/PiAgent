import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startDaemon, PipeClient, pipePath } from '@piagent/daemon';
import { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } from '@piagent/protocol';

function hello(kind, ideVersion) {
  return { protocolVersions: [1], capabilities: ['core.ping', 'future'], requiredCapabilities: ['core.ping'],
    adapter: { kind, version: '0.1.0', ideVersion, instanceId: randomUUID(), capabilities: [] } };
}
const windows = { skip: process.platform !== 'win32', timeout: 10_000 };
test('Windows pipe RAD/VS profiles, capability intersection, reconnect, isolation and duplicate listener', windows, async () => {
  const pipeName = `piagent-test-${randomUUID()}`;
  const daemon = await startDaemon({ pipeName }); const clients = [];
  try {
    const rad = await PipeClient.connect(daemon.path, {authenticate:false}); clients.push(rad);
    assert.equal((await rad.request('core.ping')).error.code, -32002);
    assert.deepEqual((await rad.request('adapter.hello', hello('rad-studio', '13.2'))).result.capabilities, ['core.ping']);
    for (const ideVersion of ['2022', '2026']) {
      const vs = await PipeClient.connect(daemon.path, {authenticate:false}); clients.push(vs);
      assert.equal((await vs.request('core.ping')).error.code, -32002);
      assert.equal((await vs.request('adapter.hello', hello('visual-studio', ideVersion))).result.protocolVersion, 1);
      const responses = await Promise.all(Array.from({ length: 8 }, (_, nonce) => vs.request('core.ping', { nonce: `한글 🚀 ${nonce}` })));
      responses.forEach((response, nonce) => assert.deepEqual(response.result, { pong: true, nonce: `한글 🚀 ${nonce}` }));
      vs.close();
    }
    await assert.rejects(startDaemon({ pipeName }));
    rad.close();
    const fresh = await PipeClient.connect(daemon.path, {authenticate:false}); clients.push(fresh);
    assert.equal((await fresh.request('core.ping')).error.code, -32002);
    assert.ok((await fresh.request('adapter.hello', hello('rad-studio', '13.2'))).result);
  } finally { for (const client of clients) client.close(); await daemon.close(); }
});

test('Windows pipe accepts split/coalesced frames and recovers after JSON parse error', windows, async () => {
  const daemon = await startDaemon({ pipeName: `piagent-split-${randomUUID()}` });
  const socket = createConnection(daemon.path); socket.on('error', () => {});
  const replies = []; const decoder = new FrameDecoder();
  socket.on('data', chunk => decoder.push(chunk, body => replies.push(JSON.parse(body.toString('utf8')))));
  try {
    await once(socket, 'connect');
    const malformed = Buffer.from([1, 0, 0, 0, 123]); // length=1, body="{"
    const wire = Buffer.concat([malformed,
      encodeFrame({ jsonrpc: '2.0', id: 'hello', method: 'adapter.hello', params: hello('test-ide', 'simulated') }),
      encodeFrame({ jsonrpc: '2.0', id: 'ping', method: 'core.ping', params: { nonce: '한글 🚀' } })]);
    socket.write(wire.subarray(0, 2)); socket.write(wire.subarray(2, 7)); socket.write(wire.subarray(7));
    for (let tries = 0; replies.length < 3 && tries < 100; tries++) await delay(10);
    assert.equal(replies.length, 3); assert.equal(replies[0].error.code, -32700);
    assert.equal(replies[1].id, 'hello'); assert.deepEqual(replies[2].result, { pong: true, nonce: '한글 🚀' });
  } finally { socket.destroy(); await daemon.close(); }
});

test('Windows pipe oversized/truncated peers and frame deadline leave other clients usable', windows, async () => {
  const daemon = await startDaemon({ pipeName: `piagent-bad-${randomUUID()}`, ioTimeoutMs: 500 });
  const good = await PipeClient.connect(daemon.path, {authenticate:false});
  try {
    await good.request('adapter.hello', hello('test-ide', 'test'));
    for (const badBytes of [Buffer.from([2, 0, 0, 0, 1]), (() => {
      const bytes = Buffer.alloc(4); bytes.writeUInt32LE(MAX_FRAME_BYTES + 1); return bytes;
    })()]) {
      const bad = createConnection(daemon.path); bad.on('error', () => {});
      await once(bad, 'connect'); const closed = new Promise(resolve => bad.once('close', resolve));
      bad.end(badBytes); await closed;
      assert.equal((await good.request('core.ping')).result.pong, true);
    }
  } finally { good.close(); await daemon.close(); }
  const short = await startDaemon({ pipeName: `piagent-timeout-${randomUUID()}`, ioTimeoutMs: 100 });
  const slow = createConnection(short.path); slow.on('error', () => {});
  try {
    await once(slow, 'connect');
    const closed = new Promise(resolve => slow.once('close', resolve));
    slow.write(Buffer.from([1])); await delay(60); slow.write(Buffer.from([0]));
    await closed; assert.equal(slow.destroyed, true);
  } finally { slow.destroy(); await short.close(); }
});

test('CLI starts as a standalone daemon and releases the pipe on termination', windows, async () => {
  const pipeName = `piagent-cli-${randomUUID()}`;
  const cli = fileURLToPath(new URL('../packages/piagent-daemon/dist/cli.js', import.meta.url));
  const child = spawn(process.execPath, [cli, '--pipe', pipeName, '--dev-pipe'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('close', resolve)); let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes.toString(); }); child.stdout.resume();
  try {
    for (let tries = 0; !stderr.includes('listening') && tries < 100; tries++) await delay(10);
    assert.ok(stderr.includes('listening'), stderr);
    const client = await PipeClient.connect(pipePath(pipeName), {authenticate:false});
    try {
      assert.ok((await client.request('adapter.hello', hello('test-ide', 'cli'))).result);
      assert.equal((await client.request('core.ping')).result.pong, true);
    } finally { client.close(); }
  } finally { child.kill(); await exited; }
  const replacement = await startDaemon({ pipeName }); await replacement.close();
});
