// Opt-in: requires compiled C# and Delphi harnesses from scripts/build-adapters.ps1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, pipePath } from '@piagent/daemon';
const execute = promisify(execFile);
const file = path => fileURLToPath(new URL(`../${path}`, import.meta.url));
const csharp = file('adapters/visualstudio/PiAgent.Transport.Smoke/bin/Release/net10.0/PiAgent.Transport.Smoke.dll');
const delphi = platform => file(`adapters/radstudio/bin/${platform}/PipeSmoke.exe`);
const windows = { skip: process.platform !== 'win32', timeout: 15_000 };

test('C# VS chat optionally negotiates and invokes read-only workspace tools', windows, async () => {
  const root = await mkdtemp(join(tmpdir(), 'piagent-adapter-workspace-'));
  let daemon;
  try {
    await writeFile(join(root, 'Example.cs'), 'first\n안녕 🚀 needle\nlast');
    daemon = await startDaemon({ pipeName: `piagent-workspace-csharp-${randomUUID()}`, workspaceRoot: root,
      omp: { executable: process.execPath, executableArgs: [file('tests/fixtures/chat-omp.mjs')], cwd: root } });
    const result = JSON.parse((await run('dotnet', [csharp, daemon.path.split('\\').at(-1), '2026', 'workspace'])).stdout.trim());
    assert.equal(JSON.parse(result.text).text, '안녕 🚀 needle'); assert.equal(result.cancelled, true);
  } finally {
    await daemon?.close();
    assert.ok(root.startsWith(join(tmpdir(), 'piagent-adapter-workspace-')));
    await rm(root, { recursive: true, force: true });
  }
});

test('C# adapter selection capability delivers the exact Unicode snapshot to OMP', windows, async () => {
  const name = `piagent-context-csharp-${randomUUID()}`;
  const daemon = await startDaemon({ pipeName: name, omp: { executable: process.execPath,
    executableArgs: [file('tests/fixtures/chat-omp.mjs')], cwd: process.cwd() } });
  try {
    const result = JSON.parse((await run('dotnet', [csharp, name, '2026', 'context'])).stdout.trim());
    const context = JSON.parse(result.text.split('\n')[1]);
    assert.equal(context.documentUri, 'file:///D:/workspace/Example.cs');
    assert.equal(context.selection.text, '// 안녕 🚀'); assert.equal(result.cancelled, true);
  } finally { await daemon.close(); }
});

test('C# duplex chat streams Unicode text while pinging and cooperatively cancels', windows, async () => {
  const name = `piagent-chat-csharp-${randomUUID()}`;
  const daemon = await startDaemon({ pipeName: name, omp: { executable: process.execPath,
    executableArgs: [file('tests/fixtures/chat-omp.mjs')], cwd: process.cwd() } });
  try {
    const result = await run('dotnet', [csharp, name, '2026', 'chat']);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { text: '안녕 <script>alert(1)</script> 🚀', cancelled: true });
  } finally { await daemon.close(); }
});

async function run(executable, args) {
  return execute(executable, args, { windowsHide: true, timeout: 8_000, encoding: 'utf8' });
}
test('C# VS adapter transport negotiates and pings Node Core for VS 2022/2026 metadata', windows, async () => {
  const name = `piagent-csharp-${randomUUID()}`;
  const daemon = await startDaemon({ pipeName: name });
  try {
    for (const version of ['2022', '2026']) {
      const result = await run('dotnet', [csharp, name, version]);
      const [hello, pong] = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
      assert.equal(hello.protocolVersion, 1); assert.deepEqual(hello.capabilities, ['core.ping']);
      assert.deepEqual(pong, { pong: true, nonce: 'PiAgent 안녕 🚀' });
    }
  } finally { await daemon.close(); }
});
for (const platform of ['Win32', 'Win64']) {
  test(`Delphi ${platform} BPL transport negotiates and pings Node Core`, windows, async () => {
    const name = `piagent-delphi-${randomUUID()}`;
    const daemon = await startDaemon({ pipeName: name });
    try {
      const result = await run(delphi(platform), [name]);
      const [hello, pong] = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
      assert.equal(hello.protocolVersion, 1); assert.deepEqual(hello.capabilities, ['core.ping']);
      // Delphi console encoding can differ; Ping itself verifies the exact Unicode echo.
      assert.equal(pong.pong, true);
    } finally { await daemon.close(); }
  });
}
for (const mode of ['cancel', 'badframe']) {
  test(`C# and Delphi clients handle ${mode} without hanging`, windows, async () => {
    const name = `piagent-fault-${randomUUID()}`; const sockets = new Set();
    const server = createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
      if (mode === 'badframe') socket.once('data', () => socket.write(Buffer.from([1, 0, 16, 0]))); // 1 MiB + 1
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipePath(name), resolve); });
    try {
      for (const [executable, args] of [['dotnet', [csharp, name, 'test', mode]],
        [delphi('Win32'), [name, mode]], [delphi('Win64'), [name, mode]]]) {
        const result = await run(executable, args);
        assert.ok(result.stdout.includes(`expected-failure: ${mode}`), result.stdout);
      }
    } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
  });
}
