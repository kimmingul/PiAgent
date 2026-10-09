import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIdeSoak} from '../scripts/verify-ide-soak.mjs';

const complete = () => ({schemaVersion:1,requestedMinutes:240,passed:true,errors:[],
  startedAt:'2026-10-09T00:00:00Z',completedAt:'2026-10-09T04:00:01Z',elapsedSeconds:14401,
  samples:2880,builds:24,implementationVersion:'test-only',adapterSha256:'a'.repeat(64),
  initialResources:{privateBytes:1000,workingSetBytes:1500,handles:10,threads:3},
  currentResources:{privateBytes:1100,workingSetBytes:1600,handles:9,threads:3},peakPrivateBytes:1200,peakHandles:12});

test('native soak gate reports measured resources without treating a footprint delta as a leak diagnosis',()=>{
  const result=verifyIdeSoak(complete());assert.equal(result.privateBytesChange,100);assert.equal(result.handleCountChange,-1);
});
test('elapsed time alone cannot certify an idle, sleeping, incomplete or erroring IDE',()=>{
  for(const changes of [{passed:false},{errors:['build failed']},{samples:2},{builds:23},
    {elapsedSeconds:60},{completedAt:'2026-10-09T00:01:00Z'}])assert.throws(()=>verifyIdeSoak({...complete(),...changes}));
});
test('native soak evidence requires binary identity and coherent resource observations',()=>{
  for(const changes of [{adapterSha256:''},{implementationVersion:''},{currentResources:{}},
    {peakPrivateBytes:100},{peakHandles:1}])assert.throws(()=>verifyIdeSoak({...complete(),...changes}));
});
