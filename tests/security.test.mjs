import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, link, symlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Authentication, Session, authProof } from '@piagent/core';
import { startDaemon, PipeClient, pipePath } from '@piagent/daemon';
import { credentialPath } from '@piagent/daemon';
const execute = promisify(execFile);
const windows = { skip: process.platform !== 'win32', timeout: 25_000 };
const hello = { protocolVersions: [1], capabilities: ['core.ping'], adapter: { kind: 'test-ide', version: 'test', ideVersion: 'test', instanceId: 'test' } };
const request = (session, method, params, id = 'test') => session.handle(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params })));
test('default credentials live outside virtualized AppData and validate pipe names',()=>{
 const old=process.env.USERPROFILE;process.env.USERPROFILE=join(tmpdir(),'piagent-profile-fixture');
 try{assert.equal(credentialPath('scope'),join(process.env.USERPROFILE,'.piagent','security','scope','token'));assert.throws(()=>credentialPath('../other'));}
 finally{if(old===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=old;}
});

test('authentication gates all methods, verifies mutual/domain proofs and rejects replay', () => {
  const token = randomBytes(32).toString('hex'), nonce = randomBytes(32).toString('hex');
  const session = new Session(undefined, new Authentication(token, 'pipe-one'));
  for (const method of ['adapter.hello', 'core.ping', 'chat.open']) assert.equal(request(session, method, hello).error.code, -32020);
  assert.equal(session.ready, false);
  assert.equal(session.handle(Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'core.auth.challenge', params: {clientNonce: nonce} }))), undefined);
  const challenge = request(session, 'core.auth.challenge', {clientNonce: nonce}).result;
  assert.equal(challenge.serverProof, authProof(token, 'server', 'pipe-one', nonce, challenge.serverNonce));
  assert.equal(request(session, 'core.auth.challenge', {clientNonce: nonce}).error.code, -32020);
  const proof = authProof(token, 'client', 'pipe-one', nonce, challenge.serverNonce);
  assert.equal(request(session, 'adapter.auth', {proof}).result.authenticated, true);
  assert.equal(request(session, 'adapter.hello', hello).result.protocolVersion, 1);
  assert.equal(request(session, 'core.ping', {}).result.pong, true);
  assert.equal(request(session, 'adapter.auth', {proof}).error.code, -32020);
  const fresh = new Session(undefined, new Authentication(token, 'pipe-one'));
  request(fresh, 'core.auth.challenge', {clientNonce: nonce});
  assert.equal(request(fresh, 'adapter.auth', {proof}).error.code, -32020);
  assert.equal(request(fresh, 'adapter.hello', hello).error.code, -32020);
  const other = new Session(undefined, new Authentication(token, 'pipe-two'));
  const second = request(other, 'core.auth.challenge', {clientNonce: nonce}).result;
  assert.equal(request(other, 'adapter.auth', {proof: authProof(token, 'server', 'pipe-two', nonce, second.serverNonce)}).error.code, -32020);
});

test('authentication rejects malformed/expired challenges and consumes failed proof attempts', () => {
  const token = 'ab'.repeat(32), nonce = 'cd'.repeat(32);
  assert.throws(() => new Authentication('invalid', 'pipe'));
  const auth = new Authentication(token, 'pipe');
  for (const params of [{}, {clientNonce: ''}, {clientNonce: nonce.toUpperCase()}, {clientNonce: nonce, extra: true}, []])
    assert.equal(auth.handle('x', 'core.auth.challenge', params).error.code, -32020);
  const result = auth.handle('x', 'core.auth.challenge', {clientNonce: nonce}).result;
  const original = Date.now;
  try { Date.now = () => original() + 31_000; assert.equal(auth.handle('x', 'adapter.auth', {proof: authProof(token, 'client', 'pipe', nonce, result.serverNonce)}).error.code, -32020); }
  finally { Date.now = original; }
  assert.equal(auth.handle('x', 'adapter.auth', {proof: authProof(token, 'client', 'pipe', nonce, result.serverNonce)}).error.code, -32020);
});

test('secure Windows pipe requires authentication, handles concurrent peers, name ownership and reconnect', windows, async () => {
  const root = await mkdtemp(join(tmpdir(), 'piagent-security-'));
  const authFile = join(root, 'private', 'token'), name = `piagent-secure-${randomUUID()}`;
  let daemon; const clients = [];
  try {
    daemon = await startDaemon({pipeName: name, secure: {authFile}});
    assert.match(daemon.securityDescriptor, /^D:P/);
    assert.match(daemon.securityDescriptor, /\(D;;FA;;;NU\)/);
    assert.equal((daemon.securityDescriptor.match(/\(A;/g) ?? []).length, 1);
    const token = await readFile(authFile, 'utf8'); assert.match(token, /^[a-f0-9]{64}$/);
    await assert.rejects(PipeClient.connect(daemon.path, {authFile:join(root,'missing')}), /Cannot read authentication credential/);
    const bad = await PipeClient.connect(daemon.path, {authenticate: false}); clients.push(bad);
    assert.equal((await bad.request('adapter.hello', hello)).error.code, -32020);
    await assert.rejects(bad.authenticate(name, '00'.repeat(32)), /Core authentication failed/);
    const connected = await Promise.all(Array.from({length: 3}, () => PipeClient.connect(daemon.path, {authFile})));
    clients.push(...connected);
    for (const client of connected) {
      assert.equal((await client.request('adapter.hello', hello)).result.protocolVersion, 1);
      assert.equal((await client.request('core.ping', {nonce: '안녕 🚀'})).result.nonce, '안녕 🚀');
    }
    await assert.rejects(startDaemon({pipeName: name, secure: {authFile}}), /pipe host/i);
    // Audit actual token ACL via Windows tooling without printing its contents.
    const script = '$ErrorActionPreference="Stop"; $acl=Get-Acl -LiteralPath $env:PIAGENT_AUDIT_PATH; [pscustomobject]@{Protected=$acl.AreAccessRulesProtected; Rules=@($acl.Access | ForEach-Object {$_.IdentityReference.Value})} | ConvertTo-Json -Compress';
    const environment = {...process.env, PIAGENT_AUDIT_PATH:authFile}; delete environment.PSModulePath;
    const audit = JSON.parse((await execute('powershell.exe', ['-NoProfile', '-Command', script], {windowsHide:true,env:environment})).stdout);
    assert.equal(audit.Protected, true); assert.equal(audit.Rules.length, 1);
    for (const client of clients) client.close(); clients.length = 0;
    await daemon.close(); daemon = await startDaemon({pipeName: name, secure: {authFile}});
    const fresh = await PipeClient.connect(pipePath(name), {authFile}); clients.push(fresh);
    assert.ok((await fresh.request('adapter.hello', hello)).result);
  } finally {
    for (const client of clients) client.close(); await daemon?.close();
    assert.ok(root.startsWith(join(tmpdir(), 'piagent-security-'))); await rm(root, {recursive: true, force: true});
  }
});

test('credential hard links and directory junctions are rejected', windows, async () => {
  const root = await mkdtemp(join(tmpdir(),'piagent-security-'));
  const name = `piagent-links-${randomUUID()}`, authFile = join(root,'private','token');
  let daemon;
  try {
    daemon = await startDaemon({pipeName:name,secure:{authFile}}); await daemon.close(); daemon = undefined;
    await symlink(join(root,'private'),join(root,'junction'),'junction');
    await assert.rejects(startDaemon({pipeName:name,secure:{authFile:join(root,'junction','token')}}),/pipe host/i);
    await link(authFile,join(root,'linked-token'));
    await assert.rejects(startDaemon({pipeName:name,secure:{authFile}}),/pipe host/i);
  } finally { await daemon?.close(); assert.ok(root.startsWith(join(tmpdir(),'piagent-security-'))); await rm(root,{recursive:true,force:true}); }
});

test('complete unauthenticated requests cannot extend the absolute authentication deadline', windows, async () => {
  const root = await mkdtemp(join(tmpdir(),'piagent-security-'));
  let daemon, client;
  try {
    daemon = await startDaemon({pipeName:`piagent-deadline-${randomUUID()}`,secure:{authFile:join(root,'private','token')}});
    client = await PipeClient.connect(daemon.path,{authenticate:false});
    const started = Date.now(); let disconnected = false;
    while (Date.now()-started < 13_000) {
      try { assert.equal((await client.request('core.ping')).error.code,-32020); }
      catch (error) { assert.match(error.message,/disconnect/i); disconnected = true; break; }
      await delay(100);
    }
    assert.equal(disconnected,true); assert.ok(Date.now()-started >= 9_000);
  } finally { client?.close(); await daemon?.close(); assert.ok(root.startsWith(join(tmpdir(),'piagent-security-'))); await rm(root,{recursive:true,force:true}); }
});

test('secure host refuses insecure credentials and never falls back when the host is unavailable', windows, async () => {
  const root = await mkdtemp(join(tmpdir(), 'piagent-security-'));
  try {
    const authFile = join(root, 'token'); await writeFile(authFile, '00'.repeat(32));
    await assert.rejects(startDaemon({pipeName: `piagent-denied-${randomUUID()}`, secure: {authFile}}), /pipe host/i);
    await assert.rejects(startDaemon({pipeName: `piagent-missing-${randomUUID()}`, secure: {brokerPath: join(root, 'missing.dll'), authFile}}), /pipe host/i);
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'piagent-security-'))); await rm(root, {recursive:true,force:true}); }
});
