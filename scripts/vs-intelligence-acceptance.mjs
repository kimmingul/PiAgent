import {startDaemon} from '@piagent/daemon';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=resolve(process.argv[2]),pipeName=process.argv[3]??'piagent-vs-intelligence';
// Let the broker create its own private credential directory. The evidence
// directory may already exist with inherited workspace permissions.
const daemon=await startDaemon({pipeName,secure:{authFile:resolve(root,'private/security/token')},workspaceRoot:root,allowWrites:true,omp:{executable:process.execPath,executableArgs:[resolve('tests/fixtures/vs-intelligence-omp.mjs'),'--audit',resolve(root,'private/audit.jsonl')],cwd:root,profile:'native'},onDiagnostic:error=>console.error(error.message)});
await writeFile(resolve(root,'private/ready.json'),JSON.stringify({pid:process.pid,pipeName}));
process.on('SIGINT',async()=>{await daemon.close();process.exit(0);});
process.on('SIGTERM',async()=>{await daemon.close();process.exit(0);});
await new Promise(()=>{});
