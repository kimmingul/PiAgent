import assert from 'node:assert/strict';
// The helper is also shipped with the offline contract replay script.
const {DesignerBridge}=await import(new URL('./designer.js',import.meta.resolve('@piagent/core')).href);
/** Validate actual emitted SDK payloads through Core. SDK mutation is simulated;
 * capture-time clock permits replay of expired evidence without rewriting bytes. */
export async function validateDesignerContract(emitted,{allowMissingRestore=false}={}){
 assert.ok(emitted?.change,'actual change payload missing');
 const captured=emitted.capturedAt===undefined?Date.now():Date.parse(emitted.capturedAt);assert.ok(Number.isFinite(captured),'capture time missing/invalid');
 const phaseTime=(key,fallback)=>{const value=emitted[key];const time=value===undefined?fallback:Date.parse(value);assert.ok(Number.isFinite(time),'capture phase time invalid');return time;};
 let replayTime=phaseTime('changeCapturedAt',captured);
 const realNow=Date.now;Date.now=()=>replayTime;
 const frames=[];let state=emitted.changeInspect??{document:emitted.change.document,revision:'before',components:[],creatableTypes:['Button'],supportedOperations:['createComponent','previewChange','applyChange','previewRestoreChange','restoreChange']};
 let bridge;bridge=new DesignerBridge(frame=>{
  frames.push(frame);
  if(frame.type==='designer_approval')queueMicrotask(()=>bridge.decide(frame.proposalId,true));
  if(frame.type!=='designer_request')return;
  if(frame.operation==='inspect')bridge.reply(frame.id,state);
  else if(frame.operation==='previewChange')bridge.reply(frame.id,emitted.change);
  else if(frame.operation==='previewRestoreChange')bridge.reply(frame.id,emitted.restore);
  else if(frame.operation==='applyChange')bridge.reply(frame.id,{applied:true,checkpointId:emitted.restore?.checkpointId??'contract-only'});
  else if(frame.operation==='restoreChange')bridge.reply(frame.id,{restored:true});
 });bridge.enabled=true;bridge.extendedEnabled=true;bridge.writesEnabled=true;
 try{
  const signal=new AbortController().signal,operation=emitted.change.operation;
  const args=operation==='createComponent'?{changeOperation:operation,type:state.creatableTypes?.[0]}:operation==='deleteComponent'?{changeOperation:operation,component:state.components?.find(c=>c.id)?.id}:{changeOperation:operation,component:state.components?.find(c=>c.id)?.id,property:'OnClick',eventMethod:'ContractOnly'};
  await bridge.execute('ide_designer_preview_change',args,signal);
  const applyArgs={proposalId:emitted.change.proposalId,revision:emitted.change.revision};assert.equal((await bridge.execute('ide_designer_apply_change',applyArgs,signal)).applied,true);await assert.rejects(bridge.execute('ide_designer_apply_change',applyArgs,signal),/expired/);
  assert.equal(frames.find(frame=>frame.type==='designer_approval').diff,emitted.change.diff);
  if(!emitted.restore){assert.ok(allowMissingRestore,'actual restore payload not captured; native recovery contract remains unverified');return {change:'PASS',restore:'NOT_CAPTURED',complete:false};}
  replayTime=phaseTime('restoreCapturedAt',captured);
  state=emitted.restoreInspect??state;
  const checkpoint=emitted.restore.checkpointId;assert.equal(typeof checkpoint,'string');assert.ok(checkpoint);
  await bridge.execute('ide_designer_preview_restore',{checkpointId:checkpoint},signal);
  const restoreArgs={proposalId:emitted.restore.proposalId,revision:emitted.restore.revision};assert.equal((await bridge.execute('ide_designer_restore_change',restoreArgs,signal)).restored,true);
  const routed=frames.find(frame=>frame.operation==='restoreChange');assert.equal(routed.args.proposalId,emitted.restore.proposalId);assert.equal(routed.args.checkpointId,checkpoint);
  const approvals=frames.filter(frame=>frame.type==='designer_approval');assert.equal(approvals.length,2);assert.equal(approvals[1].diff,emitted.restore.diff);
  await assert.rejects(bridge.execute('ide_designer_restore_change',restoreArgs,signal),/expired/);
  return {change:'PASS',restore:'PASS',complete:true};
 }finally{bridge.close();Date.now=realNow;}
}
