import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Login} from '../packages/piagent-core/dist/login.js';
const options={executable:process.execPath,cwd:process.cwd(),profile:'native',executableArgs:[fileURLToPath(new URL('./fixtures/login-omp.mjs',import.meta.url))]};
async function wait(fn){for(let i=0;i<300;i++){if(fn())return;await delay(10);}assert.fail('Login event timed out');}
test('OAuth UI owns isolated request ids and completes without a terminal or transcript',async()=>{
 const events=[],login=new Login(options,frame=>events.push(frame));try{
  await login.start('fixture');await wait(()=>events.some(frame=>frame.method==='input'));
  const input=events.find(frame=>frame.method==='input');assert.match(input.id,/^login:/);assert.equal(input.login,true);
  await assert.rejects(login.start('fixture'),/in progress/);await assert.rejects(login.respond('code',{value:'fixture-code'}),/expired/);
  await login.respond(input.id,{value:'fixture-code'});await wait(()=>events.some(frame=>frame.state==='completed'));assert.equal(login.owns(input.id),false);
  assert.equal(events.some(frame=>JSON.stringify(frame).includes('fixture-code')),false);
 }finally{await login.cancel();}
});
test('OAuth cancellation retires only the login process and rejects stale inputs',async()=>{
 const events=[],login=new Login(options,frame=>events.push(frame));try{
  await login.start('fixture');await wait(()=>events.some(frame=>frame.method==='input'));const id=events.find(frame=>frame.method==='input').id;
  await login.respond(id,{cancelled:true});assert.equal(events.at(-1).state,'cancelled');await assert.rejects(login.respond(id,{value:'late'}));
  await login.start('fixture');await login.cancel();assert.equal(events.filter(frame=>frame.state==='cancelled').length,2);
 }finally{await login.cancel();}
});
test('OAuth rejects unavailable providers and reports a failed RPC login',async()=>{
 const events=[],login=new Login(options,frame=>events.push(frame));try{
  await assert.rejects(login.start('unknown'),/unavailable/);assert.equal(events.at(-1).state,'failed');
  await login.start('failure');await wait(()=>events.at(-1)?.state==='failed');
 }finally{await login.cancel();}
});
