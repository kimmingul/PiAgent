import test from 'node:test';
import assert from 'node:assert/strict';
import {ChunkDecoder} from '../packages/piagent-omp/dist/chunks.js';
import {DesignerBridge,designerPrompt} from '../packages/piagent-core/dist/designer.js';
import {Interactions} from '../packages/piagent-core/dist/interactions.js';
import {control} from '../packages/piagent-core/dist/omp-controls.js';

function chunks(value) {
  const data=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  const middle=Math.floor(data.length/2);
  return [data.subarray(0,middle),data.subarray(middle)].map((part,index)=>({type:'rpc_chunk',chunkId:'test',index,count:2,byteLength:data.length,data:part.toString('base64')}));
}
test('RPC v2 reassembles Unicode across chunk boundaries and rejects corrupt sequences',()=>{
  const value={type:'message_update',text:'한글 🚀'.repeat(100)};
  const frames=chunks(value), decoder=new ChunkDecoder();
  assert.equal(decoder.accept(frames[0]),undefined);assert.deepEqual(decoder.accept(frames[1]),value);decoder.end();
  for(const bad of [{...frames[0],data:'!!!!'},{...frames[0],byteLength:100_000_000},{...frames[0],index:1}])assert.throws(()=>new ChunkDecoder().accept(bad));
  for(const bad of [{type:'response'},{...frames[1],chunkId:'other'},{...frames[1],index:0}]){
    const d=new ChunkDecoder();d.accept(frames[0]);assert.throws(()=>d.accept(bad));
  }
  const partial=new ChunkDecoder();partial.accept(frames[0]);assert.throws(()=>partial.end(),/Incomplete/);
  const malformed=new ChunkDecoder(), invalid=chunks(Buffer.from([0xff,0xff]));malformed.accept(invalid[0]);assert.throws(()=>malformed.accept(invalid[1]));
  const nested=chunks({type:'rpc_chunk'}), recursion=new ChunkDecoder();recursion.accept(nested[0]);assert.throws(()=>recursion.accept(nested[1]));
});

const snapshot={document:'C:\\fixture\\Main.xaml',revision:'original',canSetProperty:true,components:[{id:'0',properties:[{name:'Width',value:'100',writable:true}]}]};
const args={component:'0',property:'Width',value:'200'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('designer workflow does not alter slash commands or non-designer connections',()=>{
  assert.equal(designerPrompt(' /model provider/model',true,true),' /model provider/model');
  assert.equal(designerPrompt('Develop a GUI',false,true),'Develop a GUI');
  assert.match(designerPrompt('Develop a GUI',true,true),/ide_designer_set_property.*explicit user approval/);
});
test('Designer changes require explicit approval and carry inspected document/revision to adapter',async()=>{
  const frames=[],bridge=new DesignerBridge(frame=>frames.push(frame));bridge.enabled=true;bridge.writesEnabled=true;
  try {
    const result=bridge.execute('ide_designer_set_property',args,new AbortController().signal);
    assert.equal(frames[0].operation,'inspect');
    assert.throws(()=>bridge.reply('forged',snapshot),/expired/);
    bridge.reply(frames[0].id,snapshot);await flush();
    assert.equal(frames.length,2);assert.equal(frames[1].type,'designer_approval');
    bridge.decide(frames[1].proposalId,true);await flush();
    assert.deepEqual(frames[2].args,{...args,document:snapshot.document,revision:'original'});
    bridge.reply(frames[2].id,{applied:true});assert.deepEqual(await result,{applied:true});
    assert.throws(()=>bridge.decide(frames[1].proposalId,true),/expired/);
    assert.equal(frames.at(-1).type,'designer_resolved');
  } finally {bridge.close();}
});
test('Designer read-only, denied, stale and cancelled requests never produce successful apply',async()=>{
  const frames=[],bridge=new DesignerBridge(frame=>frames.push(frame));bridge.enabled=true;
  await assert.rejects(bridge.execute('ide_designer_set_property',args,new AbortController().signal),/disabled/);assert.equal(frames.length,0);
  bridge.writesEnabled=true;
  for(const decision of ['deny','stale','cancel']){
    frames.length=0;const abort=new AbortController();const result=bridge.execute('ide_designer_set_property',args,abort.signal);
    bridge.reply(frames[0].id,snapshot);await flush();
    if(decision==='cancel')abort.abort();else bridge.decide(frames[1].proposalId,decision!=='deny');
    await flush();
    if(decision==='stale') {bridge.reply(frames[2].id,undefined,'Designer revision changed');await assert.rejects(result,/revision/);}
    else {assert.equal((await result).applied,false);assert.equal(frames.filter(frame=>frame.operation==='setProperty').length,0);}
  }
  bridge.close();
});
test('OMP interaction answers are scoped, validated, single-use and bounded',async()=>{
  const sent=[],frames=[],interactions=new Interactions({uiResponse:async(id,value)=>sent.push({id,value})},frame=>frames.push(frame));
  try{
    interactions.accept({type:'extension_ui_request',method:'select',id:'choice',options:['Allow','Deny']});
    await assert.rejects(interactions.respond('choice',{value:'Other'}),/Unknown/);
    await interactions.respond('choice',{value:'Deny'});
    await assert.rejects(interactions.respond('choice',{value:'Allow'}),/expired/);
    assert.deepEqual(sent,[{id:'choice',value:{value:'Deny'}}]);
    interactions.accept({type:'extension_ui_request',method:'confirm',id:'confirm'});
    await assert.rejects(interactions.respond('confirm',{value:'yes'}),/Invalid/);
    await interactions.respond('confirm',{confirmed:false});
    interactions.accept({type:'extension_ui_request',method:'input',id:'input'});
    interactions.accept({type:'extension_ui_request',method:'cancel',targetId:'input'});
    await assert.rejects(interactions.respond('input',{value:'secret'}),/expired/);
    assert.throws(()=>interactions.accept({method:'notify',message:'x'.repeat(300000)}),/limit/);
  }finally{interactions.clear();}
});
test('OMP controls reject arbitrary commands/fields, enforce idle settings and hide private state',async()=>{
  const calls=[],omp={request:async(command,fields)=>{calls.push({command,fields});return {data:{model:{id:'model'},sessionFile:'private',systemPrompt:'private'}};}};
  await assert.rejects(control(omp,'switch_session',{sessionPath:'x'},false));
  await assert.rejects(control(omp,'set_model',{provider:'p',modelId:'m',extra:true},false));
  await assert.rejects(control(omp,'set_model',{provider:'p',modelId:'m'},true));
  assert.equal(calls.length,0);
  assert.deepEqual(await control(omp,'get_state',{},false),{model:{id:'model',provider:'',name:''}});
  await control(omp,'set_cache_warming',{mode:'idle'},false);
  await assert.rejects(control(omp,'set_cache_warming',{mode:'auto'},false));
});
