import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
import {modelRoles} from '../packages/piagent-core/dist/model-roles.js';
test('OMP roles use catalogue efforts, preserve other settings and reject stale/invalid changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-role-'));const config={modelRoles:{slow:'fixture/reasoning:low'},modelTags:{custom:{name:'Custom'}},unrelated:{keep:true}};
 const options={executable:process.execPath,executableArgs:[fileURLToPath(new URL('./fixtures/role-config.mjs',import.meta.url))],cwd:root};
 try{await writeFile(join(root,'config.yml'),JSON.stringify(config));const snapshot=await modelRoles(options);assert.ok(snapshot.roles.some(r=>r.id==='custom'));assert.deepEqual(snapshot.models[0].efforts,['low','high']);
  await assert.rejects(modelRoles(options,{revision:snapshot.revision,changes:{slow:'fixture/reasoning:ultra'}}),/not supported/);
  await assert.rejects(modelRoles(options,{revision:snapshot.revision,changes:{image:'fixture/reasoning'}}),/not supported/);
  await assert.rejects(modelRoles(options,{revision:snapshot.revision,changes:{slow:'@smol',smol:'@slow'}}),/cycle/);
  const saved=await modelRoles(options,{revision:snapshot.revision,changes:{slow:'fixture/reasoning:high'}});assert.equal(saved.saved,true);assert.equal(saved.roles.find(r=>r.id==='slow').value,'fixture/reasoning:high');assert.deepEqual(JSON.parse(await readFile(join(root,'config.yml'),'utf8')).unrelated,{keep:true});
  await assert.rejects(modelRoles(options,{revision:snapshot.revision,changes:{slow:'fixture/reasoning'}}),/reload/);
 }finally{await rm(root,{recursive:true,force:true});}
});
