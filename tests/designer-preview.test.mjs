import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerBridge} from '../packages/piagent-core/dist/designer.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=()=>({document:'D:/fixture/Form.pas',revision:'before',schemaVersion:2,components:[{id:'button'}],creatableTypes:['TButton'],supportedOperations:['createComponent','deleteComponent','bindEvent','previewChange','applyChange','previewRestoreChange','restoreChange']});
const preview=(overrides={})=>({proposalId:'preview',document:'D:/fixture/Form.pas',revision:'token-revision',diff:'+ Button: TButton (Width 80)',expiresAt:Date.now()+299000,operation:'createComponent',recovery:{supported:true,scope:'source_and_form'},...overrides});
function harness({state=snapshot(),result=preview(),available=()=>true}={}){
 const frames=[];let bridge;bridge=new DesignerBridge(frame=>{frames.push(frame);if(frame.type==='designer_request'&&frame.operation==='inspect')bridge.reply(frame.id,state);if(frame.type==='designer_request'&&['previewChange','previewRestoreChange'].includes(frame.operation))bridge.reply(frame.id,result);},available);bridge.enabled=true;bridge.extendedEnabled=true;bridge.writesEnabled=true;bridge.cancellationEnabled=true;return {bridge,frames,state,result};
}
test('designer previews bind advertised standard types and review immutable diffs before a single apply',async()=>{
 const {bridge,frames,result}=harness();try{
  const args={proposalId:'preview',revision:'token-revision'};await assert.rejects(bridge.execute('ide_designer_apply_change',args,new AbortController().signal),/expired/);
  await bridge.execute('ide_designer_preview_change',{changeOperation:'createComponent',type:'TButton',name:'Button',width:80},new AbortController().signal);result.diff='untrusted later mutation';
  const pending=bridge.execute('ide_designer_apply_change',args,new AbortController().signal);await tick();const approval=frames.find(f=>f.type==='designer_approval');assert.match(approval.diff,/Width 80/);bridge.decide(approval.proposalId,true);await tick();const request=frames.find(f=>f.operation==='applyChange');assert.equal(request.args.revision,'token-revision');assert.equal(request.args.document,'D:/fixture/Form.pas');bridge.reply(request.id,{applied:true,checkpointId:'checkpoint'});assert.equal((await pending).applied,true);await assert.rejects(bridge.execute('ide_designer_apply_change',args,new AbortController().signal),/expired/);
 }finally{bridge.close();}
});
test('designer creation/deletion cannot bypass advertised operations, recovery proof or type/range bounds',async()=>{
 for(const config of [{state:{...snapshot(),supportedOperations:['previewChange','applyChange']}},{result:preview({recovery:{supported:false,scope:'source_and_form'}})},{result:preview({document:'D:/other/Form.pas'})}]){
  const {bridge}=harness(config);try{await assert.rejects(bridge.execute('ide_designer_preview_change',{changeOperation:'deleteComponent',component:'button'},new AbortController().signal));}finally{bridge.close();}
 }
 const {bridge}=harness();try{for(const args of [{changeOperation:'createComponent',type:'UnverifiedControl'},{changeOperation:'createComponent',type:'TButton',width:0},{changeOperation:'deleteComponent',component:'absent'},{changeOperation:'bindEvent',component:'button'}])await assert.rejects(bridge.execute('ide_designer_preview_change',args,new AbortController().signal));}finally{bridge.close();}
});
test('reviewed scalar and collection changes require live operation and inspected property before apply',async()=>{
 const state={...snapshot(),components:[{id:'button',properties:[{name:'Font.Name',value:'Arial',writable:true}]},{id:'list',properties:[{name:'Columns[0].Caption',value:'Before',writable:false}]}],supportedOperations:[...snapshot().supportedOperations,'setScalarProperty','setCollectionProperty']};
 const {bridge,frames}=harness({state,result:preview({operation:'setCollectionProperty',diff:'-Before\n+After'})});
 try{
  for(const args of [
   {changeOperation:'setScalarProperty',component:'list',property:'Columns[0].Caption',value:'After'},
   {changeOperation:'setCollectionProperty',component:'list',property:'Columns[1].Caption',value:'After'},
   {changeOperation:'setCollectionProperty',component:'list',property:'Columns[0].Caption',value:'x'.repeat(257)},
   {changeOperation:'setCollectionProperty',component:'list',property:'Columns[0].Caption',value:'After',type:'TButton'}
  ])await assert.rejects(bridge.execute('ide_designer_preview_change',args,new AbortController().signal));
  const args={changeOperation:'setCollectionProperty',component:'list',property:'Columns[0].Caption',value:''};
  await bridge.execute('ide_designer_preview_change',args,new AbortController().signal);
  const previewRequest=frames.find(f=>f.operation==='previewChange');assert.equal(previewRequest.args.value,'');
  const applying=bridge.execute('ide_designer_apply_change',{proposalId:'preview',revision:'token-revision'},new AbortController().signal);
  await tick();const consent=frames.find(f=>f.type==='designer_approval');assert.match(consent.diff,/Before/);bridge.decide(consent.proposalId,true);
  await tick();const apply=frames.find(f=>f.operation==='applyChange');assert.ok(apply);bridge.reply(apply.id,{applied:true,checkpointId:'checkpoint'});assert.equal((await applying).applied,true);
  state.supportedOperations=state.supportedOperations.filter(op=>op!=='setCollectionProperty');
  await assert.rejects(bridge.execute('ide_designer_preview_change',args,new AbortController().signal),/unsupported/);
 }finally{bridge.close();}
 const scalar=harness({state:{...state,supportedOperations:[...state.supportedOperations,'setScalarProperty']},result:preview({operation:'setScalarProperty'})});
 try{await scalar.bridge.execute('ide_designer_preview_change',{changeOperation:'setScalarProperty',component:'button',property:'Font.Name',value:'Courier New'},new AbortController().signal);
  assert.equal(scalar.frames.find(f=>f.operation==='previewChange').args.value,'Courier New');
 }finally{scalar.bridge.close();}
});
test('designer state changing during consent blocks mutation and restore requires separate concrete approval',async()=>{
 const {bridge,frames,state}=harness();try{
  await bridge.execute('ide_designer_preview_change',{changeOperation:'createComponent',type:'TButton'},new AbortController().signal);const pending=bridge.execute('ide_designer_apply_change',{proposalId:'preview',revision:'token-revision'},new AbortController().signal);await tick();const approval=frames.find(f=>f.type==='designer_approval');state.revision='edited';bridge.decide(approval.proposalId,true);await assert.rejects(pending,/changed during approval/);assert.equal(frames.some(f=>f.operation==='applyChange'),false);
  frames.length=0;await bridge.execute('ide_designer_preview_restore',{checkpointId:'checkpoint'},new AbortController().signal);const restoring=bridge.execute('ide_designer_restore_change',{proposalId:'preview',revision:'token-revision'},new AbortController().signal);await tick();const restoreConsent=frames.find(f=>f.type==='designer_approval');bridge.decide(restoreConsent.proposalId,true);await tick();const request=frames.find(f=>f.operation==='restoreChange');assert.equal(request.args.checkpointId,'checkpoint');assert.equal(request.args.proposalId,'preview');bridge.reply(request.id,{restored:true});assert.equal((await restoring).restored,true);
 }finally{bridge.close();}
});
test('extended designer writes are disabled in plan mode and cancellation is propagated without accepting late results',async()=>{
 const {bridge,frames}=harness();try{
  await bridge.execute('ide_designer_preview_change',{changeOperation:'createComponent',type:'TButton'},new AbortController().signal);bridge.writesEnabled=false;await assert.rejects(bridge.execute('ide_designer_apply_change',{proposalId:'preview',revision:'token-revision'},new AbortController().signal),/disabled/);assert.equal(frames.some(f=>f.type==='designer_approval'),false);
 }finally{bridge.close();}
 const cancelled=[],other=new DesignerBridge(frame=>cancelled.push(frame));other.enabled=true;other.cancellationEnabled=true;const abort=new AbortController(),pending=other.execute('ide_designer_inspect',{},abort.signal);const request=cancelled[0];abort.abort();await assert.rejects(pending,/cancelled/);assert.equal(cancelled.at(-1).type,'designer_cancel');assert.throws(()=>other.reply(request.id,{}),/expired/);other.close();
});
test('designer catalog denial cannot be bypassed by fabricated host calls or support changes during consent',async()=>{
 const denied=harness({available:()=>false});try{
  await assert.rejects(denied.bridge.execute('ide_designer_preview_change',{changeOperation:'createComponent',type:'TButton'},new AbortController().signal),/not advertised/);assert.equal(denied.frames.length,0);
 }finally{denied.bridge.close();}
 const {bridge,frames,state}=harness();try{
  await bridge.execute('ide_designer_preview_change',{changeOperation:'createComponent',type:'TButton'},new AbortController().signal);
  const applying=bridge.execute('ide_designer_apply_change',{proposalId:'preview',revision:'token-revision'},new AbortController().signal);await tick();const consent=frames.find(f=>f.type==='designer_approval');state.supportedOperations=[];bridge.decide(consent.proposalId,true);
  await assert.rejects(applying,/no longer supported/);assert.equal(frames.some(f=>f.operation==='applyChange'),false);
 }finally{bridge.close();}
});
