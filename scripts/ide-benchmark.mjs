import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const outcomes=new Set(['passed','failed','timeout','unsupported','cancelled']);
const required=['runId','product','productVersion','ide','ideVersion','taskId','fixtureRevision','machine','provider','model','effort','permissions','cache','mode'];
const numeric=['elapsedMs','firstUsefulMs','inputTokens','outputTokens','costUsd','peakMemoryBytes','cpuMs','interventions'];
const contextKeys=required.filter(key=>key!=='runId');
export function validateRun(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('A run must be an object');
 for(const key of required)if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>1024)throw Error(`Invalid ${key}`);
 if(!['cold','warm'].includes(value.cache)||!['matched-model','product-default','deterministic-sdk'].includes(value.mode)||!outcomes.has(value.outcome))throw Error('Invalid comparison mode/cache/outcome');
 for(const key of numeric)if(value[key]!==undefined&&value[key]!==null&&(!Number.isFinite(value[key])||value[key]<0))throw Error(`Invalid ${key}`);
 if(!Number.isFinite(value.elapsedMs))throw Error('elapsedMs is required');
 if(value.firstUsefulMs!=null&&value.firstUsefulMs>value.elapsedMs)throw Error('First useful result is after the run ended');
 if(typeof value.startedAt!=='string'||!Number.isFinite(Date.parse(value.startedAt)))throw Error('Invalid startedAt');
 if(value.outcome==='passed'&&(!Array.isArray(value.checks)||!value.checks.length||value.checks.some(c=>!c||c.passed!==true||typeof c.name!=='string'||!c.name||typeof c.evidence!=='string'||!c.evidence)))throw Error('Passing runs require independent checks with evidence');
 if(value.note!==undefined&&(typeof value.note!=='string'||value.note.length>4096))throw Error('Invalid note');
 return value;
}
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;};
const metric=(runs,key)=>{const values=runs.map(r=>r[key]).filter(v=>typeof v==='number');return {known:values.length,unknown:runs.length-values.length,total:values.length?values.reduce((a,b)=>a+b,0):null};};
const peakMetric=(runs,key)=>{const values=runs.map(r=>r[key]).filter(v=>typeof v==='number');return {known:values.length,unknown:runs.length-values.length,max:values.length?Math.max(...values):null,p50:percentile(values,.5)};};
export function summarizeRuns(input){
 const seen=new Set(),groups=new Map();
 for(const raw of input){const run=validateRun(raw);if(seen.has(run.runId))throw Error(`Duplicate runId: ${run.runId}`);seen.add(run.runId);
  const key=JSON.stringify(contextKeys.map(k=>run[k]));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(run);
 }
 return {schemaVersion:1,generatedAt:new Date().toISOString(),note:'Measurements are grouped by identical conditions. Check evidence independently. No universal product ranking is inferred.',groups:[...groups.values()].map(runs=>{
  const passed=runs.filter(r=>r.outcome==='passed'),durations=passed.map(r=>r.elapsedMs),first=passed.map(r=>r.firstUsefulMs).filter(v=>typeof v==='number');
  return {conditions:Object.fromEntries(contextKeys.map(k=>[k,runs[0][k]])),attempts:runs.length,outcomes:Object.fromEntries([...outcomes].map(s=>[s,runs.filter(r=>r.outcome===s).length])),completionRate:passed.length/runs.length,
   successfulLatency:{samples:durations.length,p50Ms:percentile(durations,.5),p95Ms:durations.length>=20?percentile(durations,.95):null,rangeMs:durations.length?[Math.min(...durations),Math.max(...durations)]:null,rawMs:durations},
   firstUsefulLatency:{samples:first.length,p50Ms:percentile(first,.5),p95Ms:first.length>=20?percentile(first,.95):null},
   costUsd:metric(runs,'costUsd'),inputTokens:metric(runs,'inputTokens'),outputTokens:metric(runs,'outputTokens'),interventions:metric(runs,'interventions'),peakMemoryBytes:peakMetric(runs,'peakMemoryBytes'),cpuMs:metric(runs,'cpuMs'),runIds:runs.map(r=>r.runId)};
 })};
}
export async function main(args){
 if(args.length!==2)throw Error('Usage: node scripts/ide-benchmark.mjs <runs.jsonl> <report.json>');
 const input=resolve(args[0]),output=resolve(args[1]);if(input===output)throw Error('Input and report must differ');
 const content=await readFile(input,'utf8');const runs=content.split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{try{return JSON.parse(line);}catch{throw Error(`Invalid JSON at record ${index+1}`);}});
 if(!runs.length)throw Error('No benchmark runs supplied');
 const report=summarizeRuns(runs);await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(`Recorded ${runs.length} runs in ${report.groups.length} comparable groups. Report: ${output}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
