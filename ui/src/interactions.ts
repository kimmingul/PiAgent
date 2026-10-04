import type {Frame} from './controller.js';
const cards=new Map<string,HTMLElement>();
export function clearInteractions():void {for(const card of cards.values())card.remove();cards.clear();}
/** Uses RADAgent's existing action-card styles. Text from tools is never injected as HTML. */
export function interaction(frame:Frame,answer:(value:Frame)=>void):void {
  if(frame['method']==='cancel') {cards.get(String(frame['targetId']))?.remove();cards.delete(String(frame['targetId']));return;}
  const id=String(frame['id']);if(cards.has(id))return;
  const card=document.createElement('div');card.className='action-card';
  const title=document.createElement('div');title.className='card-title';title.textContent=String(frame['title']??'OMP');card.append(title);
  if(frame['message']) {const text=document.createElement('div');text.className='card-summary';text.textContent=String(frame['message']);card.append(text);}
  const actions=document.createElement('div');actions.className='card-actions';
  const submit=(value:Frame):void=>{actions.querySelectorAll('button').forEach(button=>button.disabled=true);answer(value);card.remove();cards.delete(id);};
  const button=(text:string,value:Frame):void=>{const node=document.createElement('button');node.className='card-btn';node.textContent=text;node.onclick=()=>submit(value);actions.append(node);};
  if(frame['method']==='select'&&Array.isArray(frame['options']))for(const option of frame['options'])button(String(option),{value:option});
  else if(frame['method']==='confirm') {button('확인',{confirmed:true});button('거절',{confirmed:false});}
  else {
    const input=document.createElement('textarea');input.rows=3;input.value=String(frame['prefill']??'');input.placeholder=String(frame['placeholder']??'');input.setAttribute('aria-label',title.textContent);card.append(input);
    const node=document.createElement('button');node.className='card-btn primary';node.textContent='보내기';node.onclick=()=>submit({value:input.value});actions.append(node);
  }
  button('취소',{cancelled:true});card.append(actions);document.getElementById('log')!.append(card);cards.set(id,card);card.scrollIntoView({block:'nearest'});
}
