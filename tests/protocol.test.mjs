import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } from '@piagent/protocol';
import { Session } from '@piagent/core';

export function hello(overrides = {}) {
  return { protocolVersions: [1], capabilities: ['core.ping', 'future.method'],
    adapter: { kind: 'test-ide', version: '0.1.0', ideVersion: 'test', instanceId: 'test', capabilities: ['editor.read'] },
    ...overrides };
}
function rpc(session, method, params = {}) {
  return session.handle(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 42, method, params })));
}

test('framing preserves UTF-8 across every split and coalesced frames', () => {
  const values = [{ nonce: '안녕 🚀' }, { pong: true }];
  const wire = Buffer.concat(values.map(encodeFrame));
  for (let split = 0; split <= wire.length; split++) {
    const decoder = new FrameDecoder();
    const actual = [];
    const onFrame = body => actual.push(JSON.parse(body.toString('utf8')));
    decoder.push(wire.subarray(0, split), onFrame);
    decoder.push(wire.subarray(split), onFrame);
    decoder.end();
    assert.deepEqual(actual, values);
  }
});

test('framing rejects zero, oversized, truncated header/body and oversized output', () => {
  for (const length of [0, MAX_FRAME_BYTES + 1]) {
    const header = Buffer.alloc(4); header.writeUInt32LE(length);
    assert.throws(() => new FrameDecoder().push(header, () => {}), /length/);
  }
  for (const bytes of [Buffer.from([1]), Buffer.from([2, 0, 0, 0, 1])]) {
    const decoder = new FrameDecoder(); decoder.push(bytes, () => {});
    assert.throws(() => decoder.end(), /Truncated/);
  }
  assert.throws(() => encodeFrame('x'.repeat(MAX_FRAME_BYTES)), /length/);
});

test('version negotiation, required capabilities, retry and ping state', () => {
  const session = new Session();
  assert.equal(rpc(session, 'core.ping').error.code, -32002);
  assert.equal(rpc(session, 'adapter.hello', hello({ protocolVersions: [2] })).error.code, -32001);
  assert.equal(rpc(session, 'adapter.hello', hello({ requiredCapabilities: ['future.method'] })).error.code, -32004);
  const accepted = rpc(session, 'adapter.hello', hello({ requiredCapabilities: ['core.ping'] }));
  assert.deepEqual(accepted.result.capabilities, ['core.ping']);
  assert.deepEqual(accepted.result.adapterCapabilities, ['editor.read']);
  assert.equal(accepted.result.protocolVersion, 1);
  assert.deepEqual(rpc(session, 'core.ping', { nonce: '한글 🚀' }).result, { pong: true, nonce: '한글 🚀' });
  assert.equal(rpc(session, 'adapter.hello', hello()).error.code, -32003);
  assert.equal(rpc(session, 'other').error.code, -32601);
  assert.equal(rpc(session, 'core.ping', { extra: true }).error.code, -32602);
  assert.equal(rpc(session, 'core.ping', { nonce: '한'.repeat(342) }).error.code, -32602);
});

test('empty negotiated capabilities deny ping; legacy hello still enables ping', () => {
  const restricted = new Session();
  assert.deepEqual(rpc(restricted, 'adapter.hello', hello({ capabilities: [] })).result.capabilities, []);
  assert.equal(rpc(restricted, 'core.ping').error.code, -32005);
  const legacy = new Session(); const params = hello(); delete params.capabilities;
  assert.deepEqual(rpc(legacy, 'adapter.hello', params).result.capabilities, ['core.ping']);
  assert.deepEqual(rpc(legacy, 'core.ping').result, { pong: true, nonce: null });
});

test('invalid JSON, UTF-8, BOM, envelopes and unsafe IDs fail predictably', () => {
  const session = new Session();
  for (const bytes of [Buffer.from('{'), Buffer.from([0xff]), Buffer.from('\ufeff{}')]) {
    assert.equal(session.handle(bytes).error.code, -32700);
  }
  for (const invalid of [[], null, { jsonrpc: '1.0', id: 1, method: 'x' },
    ...[null, true, 1.2, Number.MAX_SAFE_INTEGER + 1].map(id => ({ jsonrpc: '2.0', id, method: 'x' })),
    { jsonrpc: '2.0', id: 1, method: 'x', params: null },
    { jsonrpc: '2.0', id: 1, method: 'x', result: {} }]) {
    assert.equal(session.handle(Buffer.from(JSON.stringify(invalid))).error.code, -32600);
  }
  assert.equal(session.handle(Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'adapter.hello', params: hello() }))), undefined);
  assert.equal(session.ready, false);
});

test('metadata validation is IDE-neutral and capabilities are bounded', () => {
  for (const overrides of [{ protocolVersions: [] }, { protocolVersions: [-1] },
    { protocolVersions: [1.2] }, { capabilities: ['core.ping', 'core.ping'] },
    { capabilities: ['invalid capability'] }, { capabilities: null },
    { capabilities: [], requiredCapabilities: ['core.ping'] },
    { adapter: { ...hello().adapter, instanceId: '한'.repeat(86) } }]) {
    assert.equal(rpc(new Session(), 'adapter.hello', hello(overrides)).error.code, -32602);
  }
  assert.ok(rpc(new Session(), 'adapter.hello', hello()).result);
});
