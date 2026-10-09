import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateDesignerContract} from './helpers/designer-contract.mjs';
const executable=resolve(process.env.PIAGENT_VS_CONTRACT_EXE??'adapters/visualstudio/PiAgent.Vsix.Tests/bin/Release/net472/PiAgent.Vsix.Tests.exe');

test('actual C# designer payloads survive Core immutable preview, consent and exact restore-token routing',{skip:process.platform!=='win32'||!existsSync(executable),timeout:15000},async()=>{
 const emitted=JSON.parse(execFileSync(executable,['--designer-contract'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:262144}));
 assert.ok(emitted.change&&emitted.restore,'C# emitter must use real change/restore result factory');
 assert.deepEqual(await validateDesignerContract(emitted),{change:'PASS',restore:'PASS',complete:true});
});
const rad=process.env.PIAGENT_RAD_CONTRACT_JSON;
test('actual RAD captured designer payloads satisfy complete Core change/recovery contract',{skip:!rad,timeout:15000},async()=>{
 for(const file of rad.split(';').filter(Boolean)){
  const emitted=JSON.parse(readFileSync(resolve(file),'utf8').replace(/^\uFEFF/,''));
  assert.deepEqual(await validateDesignerContract(emitted),{change:'PASS',restore:'PASS',complete:true});
 }
});
