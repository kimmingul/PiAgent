import test from 'node:test';
import assert from 'node:assert/strict';
import {IdeBridge} from '../packages/piagent-core/dist/ide-tools.js';
import {DesignerBridge} from '../packages/piagent-core/dist/designer.js';

test('IDE and structural designer schema allowlists reject inherited object names before adapter dispatch',async()=>{
 const frames=[],ide=new IdeBridge(frame=>frames.push(frame)),designer=new DesignerBridge(frame=>frames.push(frame));
 ide.enabled=true;ide.catalogEnabled=true;ide.bindCatalog({schemaVersion:1,workspaceUri:'file:///D:/fixture',revision:'one',capturedAt:new Date().toISOString(),entries:[{tool:'ide_context',operation:'snapshot',availability:'supported'}]},'file:///D:/fixture');
 designer.enabled=true;designer.extendedEnabled=true;frames.length=0;
 try{
  for(const key of ['constructor','__proto__','toString','hasOwnProperty']){
   const unknown=JSON.parse(`{"${key}":{}}`);
   await assert.rejects(ide.execute('ide_context',unknown,new AbortController().signal),/Invalid IDE arguments/);
   await assert.rejects(designer.execute('ide_designer_preview_change',{changeOperation:'createComponent',type:'TButton',...unknown},new AbortController().signal),/Invalid designer change arguments/);
  }
  await assert.rejects(designer.execute('ide_designer_preview_change',Object.assign(Object.create({changeOperation:'createComponent'}),{type:'TButton'}),new AbortController().signal),/Invalid designer change arguments/);
  assert.equal(frames.length,0,'invalid fields must not invoke SDK requests or approvals');
 }finally{ide.close();designer.close();}
});
