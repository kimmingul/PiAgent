import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {packageCore} from '../scripts/package-core.mjs';
const execute=promisify(execFile);

test('offline runtime guides resolve local links and contract replay works without repository imports',{timeout:20000},async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'piagent-runtime-docs-'));
 try{
  const out=await packageCore(join(scratch,'runtime'));
  async function check(directory){
   for(const entry of await readdir(directory,{withFileTypes:true})){
    const file=join(directory,entry.name);
    if(entry.isDirectory()&&!['node_modules','transport'].includes(entry.name))await check(file);
    else if(entry.isFile()&&entry.name.endsWith('.md')){
     for(const match of (await readFile(file,'utf8')).matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
      const link=match[1].split(/\s+"/)[0].replace(/^<|>$/g,'').split('#')[0];
      if(!link||/^[a-z]+:/i.test(link))continue;
      const target=resolve(dirname(file),decodeURIComponent(link));
      assert.ok(!relative(out,target).startsWith('..'),`Packaged link escapes runtime: ${link}`);
      await assert.doesNotReject(access(target),`${relative(out,file)}: ${link}`);
     }
    }
   }
  }
  await check(out);
  // Syntax checking never launches OMP or submits model requests.
  await execute(process.execPath,['--check',join(out,'scripts/measure-editor-context.mjs')],{cwd:scratch,windowsHide:true});
  const benchmark=await import(pathToFileURL(join(out,'scripts/ide-benchmark.mjs')).href);
  assert.equal(typeof benchmark.summarizeRuns,'function');
  const document='D:/fixture/Form.xaml',expiresAt=Date.now()+299000;
  const shared={document,expiresAt,diff:'--- original\n+++ replacement\n-reviewed contents',recovery:{supported:true,scope:'source_and_form'}};
  const fixture=join(scratch,'raw.json');
  await writeFile(fixture,JSON.stringify({change:{...shared,proposalId:'change-token',revision:'change-state',operation:'createComponent'},restore:{...shared,proposalId:'restore-token',revision:'restore-state',checkpointId:'checkpoint',operation:'restore'}}));
  const replay=await execute(process.execPath,[join(out,'scripts/validate-designer-contract.mjs'),fixture],{cwd:scratch,windowsHide:true});
  assert.deepEqual(JSON.parse(replay.stdout),{scope:'Raw adapter payload/Core contract replay; SDK mutation simulated; clock fixed at capture',change:'PASS',restore:'PASS',complete:true});
 }finally{await rm(scratch,{recursive:true,force:true});}
});
