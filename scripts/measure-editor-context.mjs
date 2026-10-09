// Opt-in model experiment: maximum ten cold, tool-free prompts on synthetic code.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {OmpProcess} from '@piagent/omp';
// Resolve beside the public entry point in both workspace and standalone runtime.
const {EditorCompletion,documentRevision}=await import(new URL('./editor-completion.js',import.meta.resolve('@piagent/core')).href);
const executable=resolve(process.argv[2]??join(process.env.LOCALAPPDATA,'omp','omp.exe'));
const destination=resolve(process.argv[3]??'artifacts/ide-agent-20261009/editor-context-experiment.json');
const scratch=await mkdtemp(join(tmpdir(),'piagent-editor-measure-'));
const flags=['--no-tools','--no-extensions','--no-skills','--no-rules','--no-lsp','--no-session','--no-title','--no-pty'];
const probe=new OmpProcess({executable,cwd:scratch,executableArgs:flags,readyTimeoutMs:30000,requestTimeoutMs:10000});
const evidence={schemaVersion:1,capturedAt:new Date().toISOString(),scope:'Installed OMP synthetic editor inference; candidate whole-buffer vs cursor-window; no IDE UI/provider superiority claim',modelCallsLimit:10,coldProcesses:true,order:'Fixed whole-buffer then window in each pair; not randomized or counterbalanced',effort:'minimal (per-process only)',cost:null,costReason:'Editor result contract does not expose provider cost',runs:[]};
const errorReason=error=>String(error?.message??'Experiment unavailable').slice(0,300);
try{
 evidence.ompVersion=execFileSync(executable,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4096}).trim();
 await probe.start();const state=(await probe.request('get_state')).data;
 evidence.model=state?.model&&typeof state.model.provider==='string'&&typeof state.model.id==='string'?{provider:state.model.provider,id:state.model.id}:null;
 if(!evidence.model)throw new Error('Installed OMP default model identity unavailable; comparative model calls were not submitted');
 await probe.stop();
 const filler='// Synthetic fixture: bounded local arithmetic helper; no user source or secrets.\n';
 const prefix=filler.repeat(480),middle='export function add(a: number, b: number): number {\n    return ',suffix='\n}\n'+filler.repeat(480);
 const text=(prefix+middle+suffix).slice(0,61440),position=prefix.length+middle.length;
 const start=position-2048,window=text.slice(start,start+4096),revision=documentRevision(text);
 evidence.fixture={revision,fullBytes:Buffer.byteLength(text),windowBytes:Buffer.byteLength(window),fullUtf16Length:text.length,windowStart:start,localPosition:position-start};
 const service=new EditorCompletion({executable,cwd:scratch,readyTimeoutMs:30000,requestTimeoutMs:10000});
 try{
  for(let index=0;index<5;index++)for(const variant of ['whole','window']){
   const began=performance.now(),bounded=variant==='window',run={iteration:index+1,variant,bytes:Buffer.byteLength(bounded?window:text),model:evidence.model,cost:null};
   try{
    const result=await service.suggest({requestId:variant+'-'+index,file:'Synthetic.ts',text:bounded?window:text,position:bounded?position-start:position,mode:'completion',provider:evidence.model.provider,model:evidence.model.id,context:{start:bounded?start:0,totalLength:text.length,revision}},scratch);
    run.success=true;run.empty=result.empty;run.replacementBytes=Buffer.byteLength(result.text);run.timing=result.timing;
   }catch(error){run.success=false;run.reason=errorReason(error);run.observedTotalMs=performance.now()-began;}
   evidence.runs.push(run);console.log(JSON.stringify({iteration:run.iteration,variant,bytes:run.bytes,success:run.success,timing:run.timing??{totalMs:Math.round(run.observedTotalMs)},reason:run.reason}));
  }
 }finally{await service.close();}
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
 evidence.summary=Object.fromEntries(['whole','window'].map(variant=>{const runs=evidence.runs.filter(run=>run.variant===variant),success=runs.filter(run=>run.success);return [variant,{requests:runs.length,successful:success.length,medianTotalMs:success.length?median(success.map(run=>run.timing.totalMs)):null,medianFirstTokenMs:success.some(run=>run.timing.firstTokenMs!==null)?median(success.filter(run=>run.timing.firstTokenMs!==null).map(run=>run.timing.firstTokenMs)):null,medianContextBytes:median(runs.map(run=>run.bytes))}];}));
 for(const variant of ['whole','window'])for(const phase of ['queueMs','readyMs','configureMs','inferenceMs']){const success=evidence.runs.filter(run=>run.variant===variant&&run.success);evidence.summary[variant]['median'+phase[0].toUpperCase()+phase.slice(1)]=success.length?median(success.map(run=>run.timing[phase])):null;}
 evidence.comparison={payloadReductionPercent:(1-evidence.summary.window.medianContextBytes/evidence.summary.whole.medianContextBytes)*100,observedMedianTotalReductionPercent:evidence.summary.whole.medianTotalMs&&evidence.summary.window.medianTotalMs?(1-evidence.summary.window.medianTotalMs/evidence.summary.whole.medianTotalMs)*100:null,statisticalSpeedupEstablished:false};
 evidence.limitations=['Five cold requests per variant do not establish p95 or a statistically reliable speed improvement.','Synthetic repetition is not representative of all real projects; variants are interleaved, not simultaneous.','Cold means a fresh local OMP child, not a cold provider server; remote prompt caches and network load are uncontrolled.','Model identity is pinned per child from the installed default; no global model/thinking configuration changed.','No auth automation, tools, session history, real user code or external publishing.','Only response contract validity/nonempty proposals are measured, not completion quality or IDE acceptance.','Cost is unknown; context payload reduction does not imply the same token or monetary reduction.'];
}catch(error){evidence.blockedReason=errorReason(error);console.log(JSON.stringify({blockedReason:evidence.blockedReason}));}
finally{await probe.stop().catch(()=>{});await mkdir(resolve(destination,'..'),{recursive:true});await writeFile(destination,JSON.stringify(evidence,null,2)+'\n');await rm(scratch,{recursive:true,force:true});}
console.log(JSON.stringify({artifact:destination,model:evidence.model,summary:evidence.summary,blockedReason:evidence.blockedReason}));
