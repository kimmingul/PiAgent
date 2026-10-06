import {type Frame} from './controller.js';
let send:(frame:Frame)=>void=()=>{};
let banner:HTMLElement|undefined;
let status:Frame={};
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const element=document.createElement(tag);element.textContent=text;return element;}
export function gitStatus(value:Frame,enabled:boolean,action:(frame:Frame)=>void){
  status=value;send=action;
  banner??=document.body.insertBefore(node('div'),document.getElementById('log'));
  banner.id='git-setup-banner';banner.className='git-setup-banner';banner.replaceChildren();
  banner.hidden=!value['state']||value['state']==='ready';if(banner.hidden)return;
  banner.append(node('span',String(value['message']??'')));
  if(enabled&&['missing','unborn'].includes(String(value['state']))){const setup=node('button','로컬 Git 설정');setup.textContent='로컬 Git 설정';setup.type='button';setup.onclick=()=>send({t:'gitSetup',op:'preview'});banner.append(setup);}
  const later=node('button','나중에');later.type='button';later.onclick=()=>{banner!.hidden=true;};banner.append(later);
}
export function gitPanel(value:Frame,error?:string){
  const sheet=document.getElementById('sheet')!,body=document.getElementById('sheet-body')!;
  document.getElementById('sheet-title')!.textContent='로컬 Git 관리';sheet.hidden=false;
  if(error){const message=node('p',error);message.setAttribute('role','alert');body.append(message);body.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);return;}
  body.replaceChildren();body.append(node('p',String(value['message']??status['message']??'')));
  if(!Array.isArray(value['files'])){
    if(['missing','unborn'].includes(String(value['state']))){const preview=node('button','초기화 미리보기');preview.type='button';preview.onclick=()=>send({t:'gitSetup',op:'preview'});body.append(preview);}
    return;
  }
  body.append(node('p',`첫 커밋 포함 파일 ${value['files'].length}개`));
  const files=node('pre',value['files'].map(String).join('\n'));files.className='git-preview-files';body.append(files);
  body.append(node('p','제외 후보: '+(Array.isArray(value['excluded'])&&value['excluded'].length?value['excluded'].map(String).join(', '):'없음')+' · 빌드 결과/캐시는 .gitignore로 제외'));
  const ignore=node('details'),summary=node('summary','.gitignore 변경 미리보기');ignore.append(summary,node('pre','기존:\n'+String(value['ignoreBefore'])+'\n적용 후:\n'+String(value['ignoreAfter'])));body.append(ignore);
  const name=node('input'),email=node('input');name.placeholder='커밋 작성자 이름';email.placeholder='커밋 작성자 이메일';email.type='email';name.setAttribute('aria-label',name.placeholder);email.setAttribute('aria-label',email.placeholder);name.maxLength=email.maxLength=254;body.append(name,email);
  body.append(node('p','작성자 정보는 이 커밋에만 사용합니다. GitHub 업로드 및 전역 설정 변경은 하지 않습니다.'));
  const confirm=node('button','확인 · 초기화 및 첫 커밋');confirm.type='button';confirm.onclick=()=>{if(!name.value.trim()||!email.checkValidity()||!email.value)return;confirm.disabled=true;send({t:'gitSetup',op:'apply',previewId:value['previewId'],revision:value['revision'],name:name.value,email:email.value});};body.append(confirm);
}
