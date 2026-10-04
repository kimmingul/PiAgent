import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const release = resolve(process.argv[2]);
const { startDaemon, PipeClient } = await import(pathToFileURL(join(release, 'core/node_modules/@piagent/daemon/dist/index.js')));
const temp = await mkdtemp(join(tmpdir(), 'piagent-bundle-test-'));
const authFile = join(temp, 'private', 'token');
let daemon, client;
try {
  daemon = await startDaemon({ pipeName: `piagent-bundle-${randomUUID()}`, secure: {authFile} });
  client = await PipeClient.connect(daemon.path, {authFile});
  const hello = await client.request('adapter.hello', {
    protocolVersions: [1], capabilities: ['core.ping'], requiredCapabilities: ['core.ping'],
    adapter: {kind:'bundle-test', version:'0.9.0', ideVersion:'installer', instanceId:randomUUID(), capabilities:[]}
  });
  assert.equal(hello.error, undefined); assert.equal(hello.result.protocolVersion, 1);
  const ping = await client.request('core.ping', {nonce:'설치 검증 🚀'});
  assert.deepEqual(ping.result, {pong:true, nonce:'설치 검증 🚀'});
  console.log(`PASS bundled Node ${process.version} ${process.arch}: authenticated handshake / capability negotiation / ping`);
} finally {
  client?.close(); await daemon?.close(); await rm(temp, {recursive:true, force:true});
}
