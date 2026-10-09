import test from 'node:test';
import assert from 'node:assert/strict';
import {Interactions,designerApprovalContext} from '../packages/piagent-core/dist/interactions.js';
import {hostText,setLanguage} from '../ui/dist/i18n.js';

const names=['ide_context','ide_catalog','ide_symbols','ide_diagnostics'];
const approval=name=>({type:'extension_ui_request',method:'select',id:'read-'+name,title:'Allow tool: '+name,options:['Approve','Deny'],message:'External intent: inspect Korean 한글 🚀 {0}'});

test('read-only explanations keep the owning OMP decision and original external details',async()=>{
 const emitted=[],sent=[],interactions=new Interactions({uiResponse:async(id,value)=>sent.push({id,value})},frame=>emitted.push(frame));
 try{
  for(const name of names){
   const original=approval(name);interactions.accept(original);const displayed=emitted.at(-1);
   assert.equal(displayed.options,original.options);assert.equal(displayed.title,original.title);assert.equal(displayed.id,original.id);
   assert.ok(displayed.message.endsWith(original.message));assert.match(displayed.message,/관리자 권한과는 관계가 없습니다/);
   assert.equal(sent.length,0);assert.equal(original.message,'External intent: inspect Korean 한글 🚀 {0}');
  }
  await interactions.respond('read-ide_context',{value:'Deny'});
  assert.deepEqual(sent,[{id:'read-ide_context',value:{value:'Deny'}}]);
  await assert.rejects(interactions.respond('read-ide_context',{value:'Approve'}),/expired/);
  await interactions.respond('read-ide_catalog',{value:'Approve'});
  assert.equal(sent[1].value.value,'Approve');
 }finally{interactions.clear();}
});

test('unknown or malformed OMP approval frames remain untouched',()=>{
 const valid=approval('ide_context');
 for(const frame of [
  {...valid,title:'Allow tool: constructor'}, {...valid,title:'Allow tool: __proto__'}, {...valid,title:'Allow tool: bash'},
  {...valid,title:'Allow tool: ide_context '}, {...valid,title:'allow tool: ide_context'}, {...valid,title:'Allow tool: ide_context\nother'},
  {...valid,method:'input'}, {...valid,method:['select']}, {...valid,title:{name:'ide_context'}},
  {...valid,message:{external:'opaque'}}, {...valid,id:''}, {...valid,options:['Approve',{value:'Deny'}]}
 ])assert.equal(designerApprovalContext(frame),frame);
});

test('read-only approval guidance translates both languages without altering external content or options',()=>{
 try{
  for(const name of names){
   const original=approval(name),projected=designerApprovalContext(original);
   setLanguage('ko');assert.equal(hostText(projected.message),projected.message);
   setLanguage('en');const english=hostText(projected.message);
   assert.match(english,/^Approve /);assert.match(english,/OMP tool approval/);assert.match(english,/does not request administrator privileges/);
   assert.ok(english.endsWith(original.message));assert.equal(hostText(original.title),original.title);
   assert.deepEqual(projected.options,['Approve','Deny']);assert.equal(original.message,'External intent: inspect Korean 한글 🚀 {0}');
   setLanguage('ko');assert.equal(hostText(english),projected.message);
  }
 }finally{setLanguage('ko');}
});
