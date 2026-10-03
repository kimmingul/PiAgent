import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { packageCore } from '../scripts/package-core.mjs';

test('release runs outside the workspace without npm install and verifies file hashes',
  { skip: process.platform !== 'win32', timeout: 15_000 }, async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'piagent-release-'));
    const output = join(scratch, 'bundle');
    let daemon;
    let closed;
    try {
      await packageCore(output);
      await assert.rejects(packageCore(output), { code: 'EEXIST' });
      const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
      for (const [path, expected] of Object.entries(manifest.sha256))
        assert.equal(createHash('sha256').update(await readFile(join(output, path))).digest('hex'), expected);
      const pipe = `piagent-release-${randomUUID()}`;
      const authFile = join(scratch, 'private', 'token');
      daemon = spawn(process.execPath, ['core.mjs', '--pipe', pipe, '--auth-file', authFile], { cwd: output, windowsHide: true });
      closed = new Promise(resolve => daemon.once('close', resolve));
      let stderr = '';
      daemon.stderr.on('data', bytes => { stderr += bytes.toString(); });
      daemon.stdout.resume();
      for (let tries = 0; !stderr.includes('listening') && tries < 200; tries++) await delay(10);
      assert.ok(stderr.includes('listening'), stderr);
      const probe = spawn(process.execPath, ['probe.mjs', pipe, 'release-adapter', 'release'],
        { cwd: output, windowsHide: true, env: {...process.env, PIAGENT_AUTH_FILE: authFile} });
      let result = '', errors = '';
      probe.stdout.on('data', bytes => { result += bytes.toString(); });
      probe.stderr.on('data', bytes => { errors += bytes.toString(); });
      probe.on('error', error => { errors += error.message; });
      assert.equal(await new Promise(resolve => probe.once('close', resolve)), 0, errors);
      assert.match(result, /"pong":true/);
    } finally {
      daemon?.kill();
      if (closed) await closed;
      await rm(scratch, { recursive: true, force: true });
    }
  });
