import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRuns,validateRun,assessComparison} from '../scripts/ide-benchmark.mjs';
const run=(id,extra={})=>({runId:id,product:'PiAgent',productVersion:'candidate',ide:'VS2026',ideVersion:'18.10.3',taskId:'build-repair',fixtureRevision:'abc',machine:'test-machine',provider:'fixture',model:'deterministic',effort:'none',permissions:'always-ask',cache:'cold',mode:'deterministic-sdk',startedAt:'2026-10-09T00:00:00Z',elapsedMs:100,outcome:'passed',checks:[{name:'build',passed:true,evidence:'build.log'}],...extra});
test('benchmark preserves failures, unsupported tasks and unknown costs without inventing p95',()=>{
 const result=summarizeRuns([run('a'),run('b',{outcome:'failed',checks:[],elapsedMs:500}),run('c',{outcome:'unsupported',checks:[],elapsedMs:0})]).groups[0];
 assert.equal(result.completionRate,1/3);assert.equal(result.outcomes.unsupported,1);assert.equal(result.successfulLatency.p50Ms,100);assert.equal(result.successfulLatency.p95Ms,null);assert.deepEqual(result.costUsd,{known:0,unknown:3,total:null});
});

const plan={schemaVersion:1,suiteId:'acceptance-v1',mode:'matched-model',products:['PiAgent','Copilot'],repetitions:5,suites:[{ide:'VS2026',tasks:Array.from({length:12},(_,i)=>`task-${i+1}`)}]};
const plannedRuns=()=>plan.suites.flatMap(s=>s.tasks.flatMap(taskId=>plan.products.flatMap(product=>Array.from({length:5},(_,i)=>run(`${taskId}-${product}-${i}`,{suiteId:plan.suiteId,mode:plan.mode,taskId,product,repetition:i+1,promptHash:'prompt-v1',acceptanceHash:'checks-v1',environmentRevision:'env-v1',resetEvidence:'reset.log'})))));
test('comparison requires every planned attempt and retains unsupported outcomes in coverage',()=>{
 const runs=plannedRuns();runs[0].outcome='unsupported';runs[0].checks=[];
 const complete=assessComparison(plan,runs);assert.equal(complete.eligibleForComparison,true);assert.equal(complete.expectedAttempts,120);
 const omitted=assessComparison(plan,runs.slice(1));assert.equal(omitted.eligibleForComparison,false);assert.equal(omitted.missing.length,1);
 assert.throws(()=>assessComparison(plan,[...runs,{...runs[0],runId:'replacement'}]),/Duplicate comparison attempt/);
});
test('comparison rejects mismatched prompts, reset evidence and model conditions',()=>{
 const runs=plannedRuns();runs[5].promptHash='other';runs[6].model='other';delete runs[7].resetEvidence;
 const result=assessComparison(plan,runs);assert.equal(result.eligibleForComparison,false);
 assert.ok(result.mismatched.some(m=>m.field==='promptHash'));assert.ok(result.mismatched.some(m=>m.field==='model'));
 assert.ok(result.reasons.some(r=>r.includes('resetEvidence')));
});
test('product-default comparisons allow actual model differences but pilot coverage remains explicit',()=>{
 const runs=plannedRuns().map(r=>({...r,mode:'product-default',model:r.product}));
 assert.equal(assessComparison({...plan,mode:'product-default'},runs).eligibleForComparison,true);
 const pilot={...plan,repetitions:1,suites:[{ide:'VS2026',tasks:['task-1']}]};
 const result=assessComparison(pilot,plannedRuns().filter(r=>r.taskId==='task-1'&&r.repetition===1));
 assert.equal(result.eligibleForComparison,false);assert.match(result.reasons[0],/Pilot/);
});
test('benchmark never pools different models, cache conditions, fixture versions or tasks',()=>{
 const result=summarizeRuns([run('a'),run('b',{model:'different'}),run('c',{cache:'warm'}),run('d',{fixtureRevision:'def'}),run('e',{taskId:'debug'})]);assert.equal(result.groups.length,5);
});
test('benchmark rejects unsupported success claims, duplicate runs and invalid measures',()=>{
 assert.throws(()=>validateRun(run('a',{checks:[]})),/evidence/);assert.throws(()=>validateRun(run('a',{elapsedMs:NaN})),/elapsedMs/);assert.throws(()=>validateRun(run('a',{firstUsefulMs:200})),/after/);
 assert.throws(()=>summarizeRuns([run('a'),run('a')]),/Duplicate/);
 const measured=summarizeRuns(Array.from({length:20},(_,i)=>run(String(i),{elapsedMs:i+1}))).groups[0];assert.equal(measured.successfulLatency.p95Ms,19);
});
