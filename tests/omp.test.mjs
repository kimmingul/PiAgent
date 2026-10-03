import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { OmpProcess, JsonlDecoder } from '@piagent/omp';
const fixture = fileURLToPath(new URL('./fixtures/omp-fixture.mjs', import.meta.url));
function manager(scenario = 'normal', overrides = {}) {
  return new OmpProcess({ executable: process.execPath, executableArgs: [fixture, scenario],
    cwd: process.cwd(), readyTimeoutMs: 2_000, requestTimeoutMs: 150, shutdownTimeoutMs: 100, ...overrides });
}

test('OMP launch flags/cwd, ready gate, ID correlation, Unicode events and stderr', async () => {
  const omp = manager('delayed');
  const frames = []; const stderr = [];
  omp.on('frame', frame => frames.push(frame)); omp.on('stderr', line => stderr.push(line));
  try {
    await assert.rejects(omp.request('get_state'), /not ready/);
    const ready = omp.start();
    await assert.rejects(omp.request('get_state'), /not ready/);
    assert.equal((await ready).type, 'ready');
    const [state, commands] = await Promise.all([omp.request('get_state', { nonce: '한글' }), omp.request('get_available_commands')]);
    assert.equal(state.command, 'get_state'); assert.equal(commands.command, 'get_available_commands');
    assert.equal(state.data.nonce, '한글'); assert.equal(state.data.cwd, process.cwd());
    assert.deepEqual(state.data.argv, ['--mode', 'rpc-ui']);
    assert.ok(frames.some(frame => frame.type === 'session_event' && frame.text === '한글 🚀'));
    assert.ok(stderr.length > 0);
    await assert.rejects(omp.request('delete_files'), /not enabled/);
  } finally { await omp.stop(); }
  assert.equal(omp.state, 'stopped'); await omp.stop();
  await assert.rejects(omp.start(), /single-use/);
});

test('OMP malformed line recovery, failed/mismatched responses and request timeout', async () => {
  const omp = manager('malformed'); const diagnostics = [];
  omp.on('diagnostic', error => diagnostics.push(error.message));
  try {
    await omp.start();
    await assert.rejects(omp.request('get_state', { hang: true }), /request timeout/);
    await assert.rejects(omp.request('get_state', { fail: true }), /command failed/);
    await assert.rejects(omp.request('get_state', { mismatch: true }), /Mismatched/);
    await assert.rejects(omp.request('get_state', { id: 'bad' }), /Reserved/);
    assert.equal((await omp.request('get_state')).success, true);
    assert.ok(diagnostics.some(message => message.includes('malformed')));
  } finally { await omp.stop(); }
});

test('OMP missing executable, early exit, ready timeout, oversized and v2-only startup', async () => {
  for (const [scenario, pattern, options] of [
    ['early-exit', /exited/, {}], ['no-ready', /ready timeout/, { readyTimeoutMs: 100 }],
    ['oversized', /exceeds limit/, {}], ['v2-only', /Unsupported/, {}],
    ['normal', /ENOENT/, { executable: fileURLToPath(new URL('./not-an-executable.exe', import.meta.url)) }],
  ]) {
    const omp = manager(scenario, options);
    try { await assert.rejects(omp.start(), pattern); assert.equal(omp.state, 'failed'); }
    finally { await omp.stop(); }
  }
});

test('OMP rejects pending requests on unexpected exit and force-stops an unresponsive child', async () => {
  const omp = manager();
  try {
    await omp.start();
    await assert.rejects(omp.request('get_state', { exit: true }), /exited|disconnected/);
  } finally { await omp.stop(); }
  const stubborn = manager('stubborn');
  await stubborn.start(); await stubborn.stop();
  assert.equal(stubborn.state, 'stopped');
});

test('JSONL decoder preserves fragmented CRLF and detects truncated/oversized lines', () => {
  const decoder = new JsonlDecoder(); const lines = [];
  for (const byte of Buffer.from('\r\n{"text":"한글"}\r\n{}\n')) {
    decoder.push(Buffer.from([byte]), line => lines.push(JSON.parse(line.toString('utf8'))));
  }
  decoder.end(); assert.deepEqual(lines, [{ text: '한글' }, {}]);
  const partial = new JsonlDecoder(); partial.push(Buffer.from('{}'), () => {});
  assert.throws(() => partial.end(), /Truncated/);
  assert.throws(() => new JsonlDecoder().push(Buffer.alloc(1_048_577), () => {}), /limit/);
});
