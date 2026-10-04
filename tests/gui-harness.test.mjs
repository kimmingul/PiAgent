import test from 'node:test';
import assert from 'node:assert/strict';
import {guiHarness} from '../packages/piagent-core/dist/gui-harness.js';
import {DesignerBridge} from '../packages/piagent-core/dist/designer.js';

test('each live framework selects only its own packaged instructions and reference catalog',async()=>{
  for(const [framework,expected] of [['vcl','vcl'],['fmx','fmx'],['wpf-xaml','wpf'],['winui3-xaml','winui3'],['winforms-framework','winforms'],['winforms','winforms']]) {
    const harness=await guiHarness({framework});
    assert.equal(harness.catalog.framework,expected);assert.equal(harness.catalog.kind,'reference');
    assert.match(harness.instructions,/^---\nname:/);assert.match(harness.instructions,/ide_designer_inspect/);
    assert.ok(harness.catalog.controls.some(item=>item.role==='menu'));
    assert.match(harness.authority,/do not imply installed/);
  }
  assert.equal(await guiHarness({framework:'unknown-xaml'}),undefined);
  assert.equal(await guiHarness({framework:'../../private'}),undefined);
});

const snapshot={schemaVersion:2,framework:'fmx',document:'D:\\fixture\\Main.pas',revision:'before',canSetProperty:true,
  supportedOperations:['setProperty','setReference','reparent'],components:[{id:'SaveButton',parentId:'Toolbar',allowedParentIds:['Panel'],
    references:[{name:'Action',target:'',writable:true,allowedTargets:['','SaveAction']}],properties:[]}]};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){const frames=[];const bridge=new DesignerBridge(frame=>frames.push(frame));bridge.enabled=true;bridge.writesEnabled=true;return {frames,bridge};}

test('inspect delivers selected harness to the model without adding mutating adapter requests',async()=>{
  const {frames,bridge}=setup();
  try {const result=bridge.execute('ide_designer_inspect',{},new AbortController().signal);bridge.reply(frames[0].id,snapshot);
    const value=await result;assert.equal(value.harness.catalog.framework,'fmx');assert.equal(value.components[0].parentId,'Toolbar');assert.equal(frames.length,1);
  }finally{bridge.close();}
});

for(const [name,args,operation] of [
  ['ide_designer_set_reference',{component:'SaveButton',property:'Action',target:'SaveAction'},'setReference'],
  ['ide_designer_reparent',{component:'SaveButton',parent:'Panel'},'reparent']
]) {
  test(`${operation} binds explicit approval to the inspected document and revision`,async()=>{
    const {frames,bridge}=setup();
    try {
      const result=bridge.execute(name,args,new AbortController().signal);bridge.reply(frames[0].id,snapshot);await flush();
      assert.equal(frames[1].type,'designer_approval');assert.match(frames[1].diff,operation==='reparent'?/Toolbar.*\n\+Panel/:/\+SaveAction/);
      assert.equal(frames.filter(f=>f.operation===operation).length,0);
      bridge.decide(frames[1].proposalId,true);await flush();
      assert.deepEqual(frames[2].args,{...args,document:snapshot.document,revision:snapshot.revision});
      bridge.reply(frames[2].id,{applied:true});assert.equal((await result).applied,true);
    }finally{bridge.close();}
  });
  test(`${operation} rejects unsupported/stale targets and honours denial, cancellation and read-only mode`,async()=>{
    for(const variant of ['legacy','unsupported','target','dirty','denied','cancelled','stale','readonly']) {
      const {frames,bridge}=setup();const abort=new AbortController();
      try {
        if(variant==='readonly')bridge.writesEnabled=false;
        const result=bridge.execute(name,args,abort.signal);
        // Attach a handler before delivering a rejection from the asynchronous bridge.
        const outcome=result.then(value=>({value}),error=>({error}));
        if(variant!=='readonly') {
          const view=structuredClone(snapshot);
          if(variant==='legacy')delete view.schemaVersion;
          if(variant==='unsupported')view.supportedOperations=[];
          if(variant==='dirty')view.canSetProperty=false;
          if(variant==='target'){view.components[0].allowedParentIds=[];view.components[0].references[0].allowedTargets=[];}
          bridge.reply(frames[0].id,view);await flush();
          if(variant==='denied')bridge.decide(frames[1].proposalId,false);
          if(variant==='cancelled')abort.abort();
          if(variant==='stale'){bridge.decide(frames[1].proposalId,true);await flush();bridge.reply(frames[2].id,null,'Designer changed');}
        }
        const settled=await outcome;
        if(variant==='denied'||variant==='cancelled')assert.equal(settled.value.applied,false);
        else assert.ok(settled.error,variant);
        assert.equal(frames.filter(f=>f.operation===operation).length,variant==='stale'?1:0,variant);
      }finally{bridge.close();}
    }
  });
}
