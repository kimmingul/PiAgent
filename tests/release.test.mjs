import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { packageCore } from '../scripts/package-core.mjs';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);
test('default PowerShell install/start connects, checks integrity and removes only its verified version',
 {skip:process.platform!=='win32',timeout:30000},async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'piagent-install-')),bundle=join(scratch,'bundle'),installRoot=join(scratch,'runtime');
 const pipe=`piagent-install-${randomUUID()}`;
 const environment={...process.env,LOCALAPPDATA:join(scratch,'user-data')};
 let launcher,launcherClosed;
 const stopLauncher=async()=>{
  if(!launcher)return;
  // Only this spawned launcher's process tree: no shared IDE/Core or user process is touched.
  await execute('taskkill',['/PID',String(launcher.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
  await launcherClosed;launcher=undefined;
 };
 try{
  await packageCore(bundle);const manifest=JSON.parse(await readFile(join(bundle,'release-manifest.json'),'utf8'));
  const install=()=>execute('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(bundle,'scripts/install-core.ps1'),'-InstallRoot',installRoot,'-NodeExecutable',process.execPath,'-PipeName',pipe],{windowsHide:true});
  const {stdout}=await install();assert.match(stdout,/Installed:/);const target=join(installRoot,manifest.version);
  assert.equal(JSON.parse(await readFile(join(target,'install-receipt.json'),'utf8')).product,'PiAgent');
  launcher=spawn('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(target,'scripts/start-core.ps1')],{cwd:scratch,windowsHide:true,env:environment});
  launcherClosed=new Promise(resolve=>launcher.once('close',resolve));let startup='';
  launcher.stdout.resume();launcher.stderr.on('data',bytes=>{startup+=bytes.toString();});
  launcher.on('error',error=>{startup+=error.message;});
  for(let tries=0;!startup.includes('listening')&&launcher.exitCode===null&&tries<200;tries++)await delay(25);
  assert.match(startup,/listening/);
  const probe=await execute(process.execPath,[join(target,'probe.mjs'),pipe,'installer-test','release'],{cwd:scratch,windowsHide:true,env:environment});
  assert.match(probe.stdout,/"pong":true/);await stopLauncher();
  await assert.rejects(install(),error=>/already installed/.test(error.stderr));
  await execute('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(bundle,'scripts/uninstall-core.ps1'),'-InstallDirectory',target],{windowsHide:true});
  await assert.rejects(readFile(join(target,'core.mjs')),{code:'ENOENT'});
  const {writeFile}=await import('node:fs/promises');await writeFile(join(bundle,'core.mjs'),'tampered');await assert.rejects(install(),error=>/hash mismatch/.test(error.stderr));
 }finally{await stopLauncher();await rm(scratch,{recursive:true,force:true});}
});

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
      const {guiHarness}=await import(pathToFileURL(join(output,'node_modules/@piagent/core/dist/gui-harness.js')).href);
      assert.equal((await guiHarness({framework:'fmx'})).catalog.framework,'fmx');
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
