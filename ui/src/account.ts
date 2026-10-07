import {hostText,label as localizedLabel,t} from './i18n.js';
import type {Frame} from './controller.js';
let panel:HTMLElement|undefined,body:HTMLElement|undefined,requests:HTMLElement|undefined;
let providers:Frame[]=[];
let pending=false,message='';
let action:((frame:Frame)=>void)|undefined;
const cards=new Map<string,HTMLElement>();
const button=(label:string,run:()=>void):HTMLButtonElement=>{const node=document.createElement('button');node.type='button';node.className='settings-button';localizedLabel(node,label);node.onclick=run;return node;};
function render():void {
  if(!body)return;body.replaceChildren();const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');localizedLabel(status,message);body.append(status);
  if(pending)body.append(button(t("로그인 취소"),()=>action?.({t:'cancelLogin'})));
  const list=document.createElement('ul');list.className='settings-providers';
  for(const provider of providers){const item=document.createElement('li');const text=document.createElement('span');localizedLabel(text,`${String(provider['name']??provider['id'])}: ${provider['authenticated']?t("로그인됨"):provider['available']?t("로그인 가능"):t("사용 불가")}`);const login=button(provider['authenticated']?t("다시 로그인"):t("로그인"),()=>{pending=true;message=t("로그인 준비 중…");render();action?.({t:'accountLogin',providerId:provider['id']});});login.disabled=pending||provider['available']!==true;item.append(text,login);list.append(item);}body.append(list);
}
export function accountPanel(send:(frame:Frame)=>void):HTMLElement {
  action=send;
  if(!panel){panel=document.createElement('div');panel.className='settings-account-status';body=document.createElement('div');requests=document.createElement('div');requests.className='settings-login-requests';panel.append(body,requests);render();}
  return panel;
}
export function accountStatus(items:Frame[],error?:string):void{if(!error)providers=items;if(error||!pending)message=error??(items.length?'':t("조회된 제공자가 없습니다."));render();}
export function clearAccount():void {pending=false;providers=[];message='';requests?.replaceChildren();cards.clear();render();}
export function accountEvent(frame:Frame,answer:(value:Frame)=>void):void {
  if(frame['type']==='login_status'){
    pending=frame['state']==='pending';message=hostText(frame['message']??({pending:t("브라우저에서 인증을 진행하세요. 필요한 경우 아래에 인증 코드를 입력하세요."),completed:t("로그인했습니다."),cancelled:t("로그인을 취소했습니다."),failed:t("로그인하지 못했습니다.")} as Record<string,string>)[String(frame['state'])]??'');
    if(!pending){requests?.replaceChildren();cards.clear();}render();return;
  }
  const method=String(frame['method']);
  if(method==='cancel'){cards.get(String(frame['targetId']))?.remove();cards.delete(String(frame['targetId']));return;}
  if(['notify','setStatus','open_url'].includes(method)){message=hostText(frame['instructions']??frame['message']??frame['statusText']??t("브라우저에서 인증을 진행하세요."));render();}
  if(method==='open_url'&&requests){const url=String(frame['launchUrl']??frame['url']??'');try{if(!['https:','http:'].includes(new URL(url).protocol))return;}catch{return;}const link=button(t("인증 페이지 열기"),()=>action?.({t:'openUrl',url}));requests.append(link);return;}
  if(!['select','confirm','input','editor'].includes(method)||!requests)return;
  const id=String(frame['id']);if(cards.has(id))return;
  const card=document.createElement('div');card.className='settings-login-card';const title=document.createElement('h3');localizedLabel(title,String(frame['title']??t("OMP 인증")));const text=document.createElement('p');localizedLabel(text,hostText(frame['message']??frame['instructions']??''));card.append(title,text);
  const submit=(value:Frame):void=>{answer(value);card.remove();cards.delete(id);};
  if(method==='select'&&Array.isArray(frame['options']))for(const option of frame['options'])card.append(button(String(option),()=>submit({value:option})));
  else if(method==='confirm'){card.append(button(t("확인"),()=>submit({confirmed:true})),button(t("거절"),()=>submit({confirmed:false})));}
  else{const input=document.createElement('input');input.type='text';input.autocomplete='off';input.setAttribute('aria-label',title.textContent);input.placeholder=String(frame['placeholder']??t("인증 코드 또는 반환 URL"));card.append(input,button(t("제출"),()=>{const value=input.value;input.value='';submit({value});}));}
  card.append(button(t("취소"),()=>action?.({t:'cancelLogin'})));requests.append(card);cards.set(id,card);
}
