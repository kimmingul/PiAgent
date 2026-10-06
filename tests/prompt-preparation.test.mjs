import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {WorkspaceReader,WorkspaceChanges} from '@piagent/core';
const exec=promisify(execFile);
test('large turn snapshots preserve file contents with bounded Git process count',async()=>{
 const root=await mkdtemp(join(tmpdir(),'piagent-snapshot-speed-'));
 try{
  const git=async(...args)=>exec('git',args,{cwd:root,windowsHide:true});await git('init');
  for(let i=0;i<380;i++)await writeFile(join(root,`File${i}.cs`),`// ${i}\n`);
  await git('add','.');await git('-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture');
  const reader=await WorkspaceReader.create(root),changes=await WorkspaceChanges.create(reader);
  let calls=0;const original=changes.git.bind(changes);changes.git=(...args)=>{calls++;return original(...args);};
  const snapshot=await changes.beginTurn();assert.equal(snapshot.files.length,380);assert.equal(snapshot.excluded,0);assert.ok(calls<=2,`snapshot spawned ${calls} Git processes`);
  assert.equal(snapshot.files.find(f=>f.path==='File379.cs').bytes.toString(),'// 379\n');
  await git('update-index','--add','--cacheinfo','120000,'+'a'.repeat(40)+',Link.cs');
  const safe=await changes.beginTurn();assert.ok(!safe.files.some(f=>f.path==='Link.cs'));assert.equal(safe.excluded,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
