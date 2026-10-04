import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('WebView requires explicit approval, prevents duplicate decisions and previews restore before applying', async () => {
  // Minimal DOM boundary: exercise the shipped controller and host-message contract, no browser dependency.
  class Element {
    value = ''; textContent = ''; children = []; disabled = false; hidden = false;
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    focus() {}
  }
  const html = await readFile(new URL('../ui/src/chat.html',import.meta.url),'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],new Element()]));
  const messages = []; let receive;
  const document = {getElementById:id=>elements.get(id),createElement:()=>new Element(),createTextNode:text=>text};
  const webview = {postMessage:message=>messages.push(message),addEventListener:(_type,callback)=>{receive=callback;}};
  const source = await readFile(new URL('../ui/dist/chat.js',import.meta.url),'utf8');
  runInNewContext(source.replace(/export\s*\{\s*\};?/g,''),{document,window:{chrome:{webview}},TextEncoder});
  const emit = data=>receive({data}); const el=id=>elements.get(id);
  emit({type:'session',sessionId:'saved-runtime',sessionsEnabled:true,usageEnabled:true,selectionEnabled:false,savedSessionId:'saved',transcript:[{role:'user',text:'stored question'},{role:'assistant',text:'<script>stored text</script>'}]});
  assert.equal(el('capture').hidden,true);assert.equal(el('sessionTools').hidden,false);assert.equal(el('usageTools').hidden,false);
  assert.equal(el('transcript').children[1].children[1].textContent,'<script>stored text</script>');
  emit({type:'sessions',sessions:[{savedSessionId:'saved',title:'Stored',updatedAt:0,resumable:true}]});
  el('sessions').value='saved';el('resumeSession').onclick();el('resumeSession').onclick();assert.equal(messages.at(-1).action,'resumeSession');
  assert.equal(messages.filter(message=>message.action==='resumeSession').length,1);assert.equal(el('reset').disabled,true);
  emit({type:'event',data:{sessionId:'saved-runtime',turnId:null,sequence:1,kind:'closed'}});
  assert.equal(el('connect').disabled,true);assert.equal(el('resumeSession').disabled,true);
  emit({type:'usage',data:{provider:'test',model:'fixture',cost:null,premiumRequests:null,tokens:{total:123},providerLimits:null}});
  assert.match(el('usageText').textContent,/123/);assert.match(el('usageText').textContent,/USD\): 정보 없음/);
  emit({type:'session',sessionId:'s',writeEnabled:true,workspaceUri:'file:///fixture'});
  let sequence=0;
  const event=(kind,extra={})=>emit({type:'event',data:{sessionId:'s',turnId:'t',sequence:++sequence,kind,...extra}});
  event('started');
  event('warning',{turnId:null,text:'Transcript save failed'});
  assert.equal(el('stop').disabled,false); assert.equal(el('reset').disabled,true);
  assert.match(el('status').textContent,/Transcript save failed/);
  event('approval_requested',{approval:{proposalId:'p',path:'Example.cs',reason:'test',diff:'-old\n+new'}});
  assert.equal(el('approvalCard').hidden,false); assert.equal(el('approvalDiff').textContent,'-old\n+new');
  assert.equal(messages.filter(m=>m.action==='decideChange').length,0);
  el('approveChange').onclick(); el('approveChange').onclick();
  assert.equal(messages.filter(m=>m.action==='decideChange').length,1);
  assert.equal(messages.at(-1).decision,'approve'); assert.equal(el('approveChange').disabled,true);
  event('approval_resolved',{approval:{approved:true,warning:'Inspect journal'}});
  assert.match(el('status').textContent,/Inspect journal/); assert.equal(el('approvalCard').hidden,true);
  event('completed');
  emit({type:'checkpoints',items:[{checkpointId:'c',path:'Example.cs',files:[{path:'Example.cs'},{path:'Second.cs'}],createdAt:0,state:'applied'}]});
  assert.match(el('checkpoints').children[0].textContent,/Example.cs, Second.cs/);
  el('checkpoints').value='c'; el('previewRestore').onclick();
  assert.equal(messages.at(-1).action,'previewRestore');
  emit({type:'restorePreview',data:{checkpointId:'c',path:'Example.cs',diff:'-new\n+old'}});
  assert.equal(el('send').disabled,true);
  el('rejectChange').onclick(); assert.equal(messages.at(-1).action,'previewRestore');
  emit({type:'restorePreview',data:{checkpointId:'c',path:'Example.cs',diff:'-new\n+old'}});
  el('approveChange').onclick(); assert.equal(messages.at(-1).action,'restoreChange');
  emit({type:'operationError',message:'File changed'}); assert.equal(el('approveChange').disabled,false);
  emit({type:'restored',warning:'Inspect restore journal'}); assert.match(el('status').textContent,/Inspect restore journal/);
  assert.equal(el('approvalCard').hidden,true);
  event('started'); event('approval_requested',{approval:{proposalId:'p2',path:'Example.cs',reason:'test',diff:'diff'}});
  el('rejectChange').onclick(); assert.equal(messages.at(-1).decision,'reject');
  emit({type:'disconnected'}); assert.equal(el('approvalCard').hidden,true); assert.equal(el('send').disabled,true);
});
