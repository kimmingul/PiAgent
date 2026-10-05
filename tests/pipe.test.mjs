import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
test('secure pipe keeps idle and silent running chats alive without IDE heartbeat', windows, async () => {
  const root = await mkdtemp(join(tmpdir(), 'piagent-idle-'));
  let daemon, client;
  const diagnostics = [], events = [];
  try {
    const authFile = join(root, 'private', 'token');
    daemon = await startDaemon({pipeName:`piagent-idle-${randomUUID()}`,ioTimeoutMs:500,secure:{authFile},
      onDiagnostic:error=>diagnostics.push(error.message),
      omp:{executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/chat-omp.mjs',import.meta.url))],cwd:root}});
    client = await PipeClient.connect(daemon.path,{authFile});
    const profile = hello('test-ide','idle'); profile.capabilities.push('chat.v1');
    assert.ok((await client.request('adapter.hello',profile)).result);
    await delay(1100); // No pings: an IDE UI thread may be blocked by a synchronous build.
    assert.equal((await client.request('core.ping',{nonce:'after-idle'})).result.nonce,'after-idle');
    const sessionId = (await client.request('chat.open')).result.sessionId;
    client.on('chat.event',event=>events.push(event));
    const turn = (await client.request('chat.prompt',{sessionId,message:'wait'})).result;
    await delay(1100); // OMP is silent while working/waiting for external tools.
    assert.equal(events.some(event=>['cancelled','closed','error'].includes(event.kind)),false);
    assert.equal((await client.request('core.ping')).result.pong,true);
    assert.equal((await client.request('chat.cancel',{sessionId,turnId:turn.turnId})).result.requested,true);
    assert.deepEqual(diagnostics,[]);
  } finally {
    client?.close(); await daemon?.close();
    assert.ok(root.startsWith(join(tmpdir(),'piagent-idle-')));
    await rm(root,{recursive:true,force:true});
  }
});

test('ready idle peer can send split frames later; stalled partial frames still expire', windows, async () => {
  const diagnostics = [];
  const daemon = await startDaemon({pipeName:`piagent-partial-${randomUUID()}`,ioTimeoutMs:200,onDiagnostic:error=>diagnostics.push(error.message)});
  const socket = createConnection(daemon.path); socket.on('error',()=>{});
  const connected = once(socket,'connect');
  const frames=[], decoder=new FrameDecoder();
  socket.on('data',chunk=>decoder.push(chunk,body=>frames.push(JSON.parse(body.toString('utf8')))));
  const good = await PipeClient.connect(daemon.path,{authenticate:false});
  try {
    await connected;
    socket.write(encodeFrame({jsonrpc:'2.0',id:'hello',method:'adapter.hello',params:hello('test-ide','partial')}));
    await good.request('adapter.hello',hello('test-ide','good'));
    for(let i=0;i<100&&!frames.length;i++)await delay(10);
    assert.equal(frames[0].result.protocolVersion,1);
    await delay(450);
    const ping=encodeFrame({jsonrpc:'2.0',id:'ping',method:'core.ping',params:{nonce:'split-after-idle'}});
    socket.write(ping.subarray(0,2)); await delay(30); socket.write(ping.subarray(2));
    for(let i=0;i<100&&frames.length<2;i++)await delay(10);
    assert.equal(frames[1]?.result.nonce,'split-after-idle');
    const closed=once(socket,'close');
    socket.write(ping.subarray(0,1));
    await delay(130); socket.write(ping.subarray(1,2)); // Trickling must not reset the frame deadline.
    await closed;
    assert.ok(diagnostics.includes('Pipe frame read deadline exceeded'));
    assert.equal((await good.request('core.ping')).result.pong,true);
  } finally {socket.destroy();good.close();await daemon.close();}
});
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
