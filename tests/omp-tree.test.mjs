import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OmpProcess} from '@piagent/omp';
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
test('bounded Windows retirement joins an EOF-ignoring OMP and its inherited-stdio descendant',{skip:process.platform!=='win32',timeout:10000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'piagent-tree-fixture-')),cleanup=join(directory,'exit-sentinel');
 const omp=new OmpProcess({executable:process.execPath,cwd:process.cwd(),executableArgs:[fileURLToPath(new URL('./fixtures/omp-descendant.mjs',import.meta.url)),'--cleanup-file',cleanup],shutdownTimeoutMs:100});let descendant;
 try{
  descendant=(await omp.start()).descendantPid;const owner=omp.pid;assert.ok(alive(owner));assert.ok(alive(descendant));
  const began=Date.now();await omp.stop();assert.ok(Date.now()-began<7500);assert.equal(omp.state,'stopped');assert.equal(alive(owner),false);assert.equal(alive(descendant),false);await omp.stop();
 }finally{await writeFile(cleanup,'exit owned fixture processes');await new Promise(resolve=>setTimeout(resolve,150));await omp.stop().catch(()=>{});await rm(directory,{recursive:true,force:true});}
});
