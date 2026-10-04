import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {OmpProcess} from '@piagent/omp';
const executable=resolve(process.argv[2]??'.tools/omp-18.6.0/omp.exe');
const root=await mkdtemp(join(tmpdir(),'piagent-fork-'));
const managers=[];
const start=async dir=>{await mkdir(dir);const omp=new OmpProcess({executable,cwd:root,executableArgs:['--no-tools','--no-extensions','--no-skills','--no-rules','--no-lsp','--no-title','--no-pty','--session-dir',dir]});managers.push(omp);await omp.start();return omp;};
try {
 const source=await start(join(root,'source'));await source.request('new_session');const before=(await source.request('get_state')).data;
 const snapshot=await readFile(before.sessionFile);await source.stop();
 const cloneDir=join(root,'clone'),clone=await start(cloneDir),copy=join(cloneDir,'snapshot.jsonl');await copyFile(before.sessionFile,copy);
 await clone.request('switch_session',{sessionPath:copy});const fork=await clone.request('fork');assert.equal(fork.data.cancelled,false);
 const after=(await clone.request('get_state')).data;
 assert.notEqual(after.sessionId,before.sessionId);assert.equal(dirname(after.sessionFile),cloneDir);assert.notEqual(after.sessionFile,copy);
 assert.deepEqual(await readFile(before.sessionFile),snapshot);
 const evidence={at:new Date().toISOString(),sourceUnchanged:true,uniqueSessionId:true,privateForkDirectory:true,forkCancelled:fork.data.cancelled};
 await mkdir('artifacts/chat-ui-implementation',{recursive:true});await writeFile('artifacts/chat-ui-implementation/message-fork-real.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {for(const manager of managers)await manager.stop();await rm(root,{recursive:true,force:true});}
