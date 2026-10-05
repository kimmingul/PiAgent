// Read-only diagnostic on an acceptance-owned session. Never emits provider credentials/raw frames.
import {OmpProcess} from '@piagent/omp';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const workspace=resolve(process.argv[2]),output=resolve(process.argv[3]);
const report=JSON.parse(await readFile(process.argv[4],'utf8'));
const saved=report.checks.find(c=>c.name==='session list and real resume').data.savedSessionId;
const namespace=createHash('sha256').update(workspace.toLowerCase()).digest('hex');
const sessionRoot=join(process.env.USERPROFILE,'.piagent/security/piagent-dev/sessions',namespace,saved);
const files=await readdir(sessionRoot,{recursive:true});
const session=files.find(f=>f.endsWith('.jsonl'));
if(!session)throw new Error('No owned acceptance session');
const omp=new OmpProcess({executable:join(process.env.LOCALAPPDATA,'omp/omp.exe'),cwd:workspace,executableArgs:['--no-session','--no-tools','--no-extensions','--no-skills','--no-rules','--no-lsp','--no-title','--no-pty'],requestTimeoutMs:120000});
let classification='unknown';
omp.on('frame',frame=>{if(frame.type==='response'&&frame.command==='compact'&&frame.success===false){const error=String(frame.error??'');classification=/Nothing to compact.*too small/i.test(error)?'session-too-small':/Already compacted/i.test(error)?'already-compacted':/No.*model/i.test(error)?'no-model':/API key|credential|auth/i.test(error)?'provider-auth':/cancel/i.test(error)?'cancelled':'other-error';}});
try{await omp.start();await omp.request('switch_session',{sessionPath:join(sessionRoot,session)});let success=false;try{await omp.request('compact');success=true;}catch{}await writeFile(output,JSON.stringify({workspace,success,classification,rawFramesNotRetained:true},null,2));console.log(JSON.stringify({success,classification}));}finally{await omp.stop();}
