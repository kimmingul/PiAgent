import {startDaemon} from '@piagent/daemon';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
const root=resolve(process.argv[2]??'');
const pipeName=process.argv[3]??('piagent-rad-sdk-fixture-'+basename(root).replace('sdk-fixture-','').toLowerCase()+'-'+basename(dirname(root)));
if(!process.argv[2]||(await readFile(resolve(root,'.piagent-rad-fixture'),'utf8')).trim()!=='piagent-rad-fixture-v1')throw new Error('Explicit prepared RAD fixture required');
const privateRoot=resolve(root,'private');await mkdir(privateRoot,{recursive:true});
const daemon=await startDaemon({pipeName,secure:{authFile:resolve(privateRoot,'security/token')},workspaceRoot:root,allowWrites:true,
 omp:{executable:process.execPath,executableArgs:[resolve(dirname(fileURLToPath(import.meta.url)),'fixtures/rad-intelligence-omp.mjs'),'--audit',resolve(privateRoot,'audit.jsonl')],cwd:root,profile:'native'},
 onDiagnostic:error=>console.error(error.message)});
await writeFile(resolve(privateRoot,'ready.json'),JSON.stringify({pid:process.pid,pipeName,authFile:resolve(privateRoot,'security/token')}));
process.on('SIGINT',async()=>{await daemon.close();process.exit(0);});
process.on('SIGTERM',async()=>{await daemon.close();process.exit(0);});
await new Promise(()=>{});
