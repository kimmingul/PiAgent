import assert from 'node:assert/strict';
import { PipeClient, pipePath } from './index.js';

async function main(): Promise<void> {
  const [name = 'piagent-dev', kind = 'rad-studio', ideVersion = 'simulator', ...extra] = process.argv.slice(2);
  if (extra.length > 0) throw new Error('Usage: probe [pipe-name] [adapter-kind] [ide-version]');
  const client = await PipeClient.connect(pipePath(name));
  try {
    const hello = await client.request('adapter.hello', {
      protocolVersions: [1], capabilities: ['core.ping'], requiredCapabilities: ['core.ping'],
      adapter: { kind, version: '0.1.0', ideVersion, instanceId: `probe-${process.pid}`, capabilities: [] },
    });
    assert.equal(hello.error, undefined);
    assert.deepEqual(hello.result && (hello.result as { capabilities: string[] }).capabilities, ['core.ping']);
    console.log(JSON.stringify(hello));
    const pong = await client.request('core.ping', { nonce: 'PiAgent 안녕 🚀' });
    assert.equal(pong.error, undefined);
    assert.deepEqual(pong.result, { pong: true, nonce: 'PiAgent 안녕 🚀' });
    console.log(JSON.stringify(pong));
  } finally { client.close(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
