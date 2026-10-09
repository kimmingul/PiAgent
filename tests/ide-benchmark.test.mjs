import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRuns,validateRun} from '../scripts/ide-benchmark.mjs';
const run=(id,extra={})=>({runId:id,product:'PiAgent',productVersion:'candidate',ide:'VS2026',ideVersion:'18.10.3',taskId:'build-repair',fixtureRevision:'abc',machine:'test-machine',provider:'fixture',model:'deterministic',effort:'none',permissions:'always-ask',cache:'cold',mode:'deterministic-sdk',startedAt:'2026-10-09T00:00:00Z',elapsedMs:100,outcome:'passed',checks:[{name:'build',passed:true,evidence:'build.log'}],...extra});
test('benchmark preserves failures, unsupported tasks and unknown costs without inventing p95',()=>{
 const result=summarizeRuns([run('a'),run('b',{outcome:'failed',checks:[],elapsedMs:500}),run('c',{outcome:'unsupported',checks:[],elapsedMs:0})]).groups[0];
 assert.equal(result.completionRate,1/3);assert.equal(result.outcomes.unsupported,1);assert.equal(result.successfulLatency.p50Ms,100);assert.equal(result.successfulLatency.p95Ms,null);assert.deepEqual(result.costUsd,{known:0,unknown:3,total:null});
});
test('benchmark never pools different models, cache conditions, fixture versions or tasks',()=>{
 const result=summarizeRuns([run('a'),run('b',{model:'different'}),run('c',{cache:'warm'}),run('d',{fixtureRevision:'def'}),run('e',{taskId:'debug'})]);assert.equal(result.groups.length,5);
});
test('benchmark rejects unsupported success claims, duplicate runs and invalid measures',()=>{
 assert.throws(()=>validateRun(run('a',{checks:[]})),/evidence/);assert.throws(()=>validateRun(run('a',{elapsedMs:NaN})),/elapsedMs/);assert.throws(()=>validateRun(run('a',{firstUsefulMs:200})),/after/);
 assert.throws(()=>summarizeRuns([run('a'),run('a')]),/Duplicate/);
 const measured=summarizeRuns(Array.from({length:20},(_,i)=>run(String(i),{elapsedMs:i+1}))).groups[0];assert.equal(measured.successfulLatency.p95Ms,19);
});
