import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, link, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WorkspaceReader } from '@piagent/core';
import { startDaemon, PipeClient } from '@piagent/daemon';
import { setTimeout as delay } from 'node:timers/promises';

const fixture = fileURLToPath(new URL('./fixtures/chat-omp.mjs', import.meta.url));
const signal = () => new AbortController().signal;
async function sandbox() {
  const base = await mkdtemp(join(tmpdir(), 'piagent-workspace-'));
  const root = join(base, 'root'); await mkdir(root);
  await writeFile(join(root, 'Example.cs'), 'first\n안녕 🚀 needle\nlast\n');
  await writeFile(join(base, 'outside.txt'), 'outside needle');
  return { base, root, reader: await WorkspaceReader.create(root), close: () => {
    assert.ok(base.startsWith(join(tmpdir(), 'piagent-workspace-'))); return rm(base, { recursive: true, force: true });
  } };
}
test('workspace reads bounded UTF-8 lines and searches literal Unicode without writing', async () => {
  const env = await sandbox();
  try {
    const result = await env.reader.execute('workspace_read_file', { path: 'Example.cs', startLine: 2, maxLines: 1 }, signal());
    assert.deepEqual(result, { path: 'Example.cs', startLine: 2, endLine: 2, text: '안녕 🚀 needle', truncated: true });
    const found = await env.reader.execute('workspace_search', { query: 'NEEDLE', caseSensitive: false }, signal());
    assert.deepEqual(found.matches, [{ path: 'Example.cs', line: 2, text: '안녕 🚀 needle' }]);
    assert.equal(await readFile(join(env.root, 'Example.cs'), 'utf8'), 'first\n안녕 🚀 needle\nlast\n');
    assert.equal((await env.reader.execute('workspace_search', { query: '.*' }, signal())).matches.length, 0);
  } finally { await env.close(); }
});
test('workspace rejects traversal, ADS, excluded files, binary/oversized content and malformed args', async () => {
  const env = await sandbox();
  try {
    await mkdir(join(env.root, '.git')); await writeFile(join(env.root, '.git', 'config'), 'needle secret');
    await writeFile(join(env.root, '.env'), 'needle secret'); await writeFile(join(env.root, 'private.pem'), 'needle secret');
    await writeFile(join(env.root, 'binary.dat'), Buffer.from([0, 1, 2]));
    await writeFile(join(env.root, 'invalid.txt'), Buffer.from([0xff]));
    await writeFile(join(env.root, 'large.txt'), 'x'.repeat(262145));
    await writeFile(join(env.root, 'line.txt'), 'x'.repeat(32769));
    for (const path of ['../outside.txt', env.base, 'Example.cs:secret', '.git/config', '.env', 'private.pem', 'NUL', 'Example.cs.', 'binary.dat', 'invalid.txt', 'large.txt', 'line.txt'])
      await assert.rejects(env.reader.execute('workspace_read_file', { path }, signal()));
    for (const args of [{ path: 'Example.cs', maxLines: 201 }, { path: 'Example.cs', startLine: 0 }, { path: 'Example.cs', extra: true }, null])
      await assert.rejects(env.reader.execute('workspace_read_file', args, signal()));
    for (const args of [{ query: '' }, { query: '\n' }, { query: 'x', caseSensitive: 1 }, { query: 'x', maxResults: 51 }])
      await assert.rejects(env.reader.execute('workspace_search', args, signal()));
    await assert.rejects(env.reader.execute('workspace_write_file', {}, signal()));
    const found = await env.reader.execute('workspace_search', { query: 'needle' }, signal());
    assert.equal(found.matches.length, 1); assert.equal(found.matches[0].path, 'Example.cs');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(env.reader.execute('workspace_read_file', { path: 'Example.cs' }, abort.signal));
  } finally { await env.close(); }
});
test('workspace excludes directory junctions/symlinks and hard-linked files', async () => {
  const env = await sandbox();
  try {
    const directory = join(env.base, 'outside'); await mkdir(directory); await writeFile(join(directory, 'escape.txt'), 'needle');
    await symlink(directory, join(env.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await link(join(env.base, 'outside.txt'), join(env.root, 'hard.txt'));
    await assert.rejects(env.reader.execute('workspace_read_file', { path: 'linked/escape.txt' }, signal()));
    await assert.rejects(env.reader.execute('workspace_read_file', { path: 'hard.txt' }, signal()));
    assert.equal((await env.reader.execute('workspace_search', { query: 'needle' }, signal())).matches.length, 1);
  } finally { await env.close(); }
});
test('workspace tool registration, errors, cancellation and capability gating cross the real pipe', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const env = await sandbox(); const clients = [];
  const daemon = await startDaemon({ pipeName: `piagent-workspace-${randomUUID()}`, workspaceRoot: env.root,
    omp: { executable: process.execPath, executableArgs: [fixture], cwd: env.root } });
  try {
    for (const enabled of [false, true]) {
      const client = await PipeClient.connect(daemon.path, {authenticate:false}); clients.push(client);
      const caps = ['core.ping', 'chat.v1', ...(enabled ? ['workspace.read.v1'] : [])];
      assert.ok((await client.request('adapter.hello', { protocolVersions: [1], capabilities: caps, requiredCapabilities: caps,
        adapter: { kind: 'test', version: '0.4.0', ideVersion: 'test', instanceId: randomUUID() } })).result);
      const opened = (await client.request('chat.open')).result; assert.equal(opened.toolsEnabled, enabled);
      const events = []; client.on('chat.event', event => events.push(event));
      await client.request('chat.prompt', { sessionId: opened.sessionId, message: enabled ? 'workspace-read' : 'hello' });
      for (let i = 0; i < 200 && !events.some(e => e.kind === 'completed'); i++) await delay(10);
      assert.ok(events.some(e => e.kind === 'completed'));
      if (enabled) {
        const result = JSON.parse(events.filter(e => e.kind === 'delta').map(e => e.text).join(''));
        assert.equal(result.text, '안녕 🚀 needle'); assert.ok(events.some(e => e.kind === 'tool_started'));
        events.length = 0;
        await client.request('chat.prompt', { sessionId: opened.sessionId, message: 'workspace-deny' });
        for (let i = 0; i < 200 && !events.some(e => e.kind === 'completed'); i++) await delay(10);
        assert.ok(events.some(e => e.kind === 'delta' && e.text === 'tool-error'));
        events.length = 0;
        const turn = (await client.request('chat.prompt', { sessionId: opened.sessionId, message: 'workspace-cancel' })).result.turnId;
        await client.request('chat.cancel', { sessionId: opened.sessionId, turnId: turn });
        assert.ok((await client.request('core.ping', { nonce: 'cancelled tool' })).result.pong);
        await delay(100);
        assert.ok(!events.some(e => e.kind === 'error'));
        events.length = 0;
        await client.request('chat.prompt', { sessionId: opened.sessionId, message: 'workspace-duplicate' });
        for (let i = 0; i < 200 && !events.some(e => e.kind === 'closed'); i++) await delay(10);
        assert.ok(events.some(e => e.kind === 'error' && e.text === '잘못되었거나 중복된 IDE 도구 요청을 받아 작업 세션을 종료했습니다.'));
        assert.ok(events.some(e => e.kind === 'closed'));
      }
    }
  } finally { clients.forEach(c => c.close()); await daemon.close(); await env.close(); }
});
