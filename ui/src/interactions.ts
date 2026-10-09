import {hostText,label as localizedLabel,t} from './i18n.js';
import type {Frame} from './controller.js';
const cards=new Map<string,HTMLElement>();
export function clearInteractions():void {for(const card of cards.values())card.remove();cards.clear();}
/** Uses RADAgent's existing action-card styles. Text from tools is never injected as HTML. */
export function interaction(frame:Frame,answer:(value:Frame)=>void):void {
  if(frame['method']==='cancel') {cards.get(String(frame['targetId']))?.remove();cards.delete(String(frame['targetId']));return;}
  const id=String(frame['id']);if(cards.has(id))return;
  const card=document.createElement('div');card.className='action-card';
  const title=document.createElement('div');title.className='card-title';localizedLabel(title,String(frame['title']??'OMP'));card.append(title);
  if(frame['message']) {const text=document.createElement('div');text.className='card-summary';localizedLabel(text,hostText(frame['message']));card.append(text);}
  const actions=document.createElement('div');actions.className='card-actions';
  const submit=(value:Frame):void=>{actions.querySelectorAll('button').forEach(button=>button.disabled=true);answer(value);card.remove();cards.delete(id);};
  const button=(text:string,value:Frame,owned=true):void=>{const node=document.createElement('button');node.className='card-btn';if(owned)localizedLabel(node,text);else node.textContent=text;node.onclick=()=>submit(value);actions.append(node);};
  if(frame['method']==='select'&&Array.isArray(frame['options'])) {
    const nativeToolApproval=/^Allow tool: [A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(String(frame['title']??''));
    for(const option of frame['options']) {
      const text=nativeToolApproval&&option==='Approve'?t("승인"):nativeToolApproval&&option==='Deny'?t("거절"):String(option);
      button(text,{value:option},nativeToolApproval&&(option==='Approve'||option==='Deny'));
    }
  }
  else if(frame['method']==='confirm') {button(t("확인"),{confirmed:true});button(t("거절"),{confirmed:false});}
  else {
    const input=document.createElement('textarea');input.rows=3;input.value=String(frame['prefill']??'');input.placeholder=String(frame['placeholder']??'');input.setAttribute('aria-label',title.textContent);card.append(input);
    const node=document.createElement('button');node.className='card-btn primary';localizedLabel(node,t("보내기"));node.onclick=()=>submit({value:input.value});actions.append(node);
  }
  button(t("취소"),{cancelled:true});card.append(actions);document.getElementById('log')!.append(card);cards.set(id,card);card.scrollIntoView({block:'nearest'});
}
