import {object,type Frame} from './controller.js';
const tabs=['표시','계정','모델 역할','확장','고급'];
let result:((ok:boolean,message?:string)=>void)|undefined;
export function settingsResult(ok:boolean,message?:string):void{result?.(ok,message);}
/** Settings use the existing sheet and original RADAgent tab order. No credential editing. */
export function settings(frame:Frame,save:(values:Frame)=>void,action:(frame:Frame)=>void):void {
  const values={...object(frame['values'])};
  const sheet=document.getElementById('sheet')!,body=document.getElementById('sheet-body')!;
  document.getElementById('sheet-title')!.textContent='PiAgent 설정';sheet.hidden=false;body.replaceChildren();
  const nav=document.createElement('div'),content=document.createElement('div'),footer=document.createElement('div');nav.setAttribute('role','tablist');
  body.append(nav,content,footer);
  const button=(label:string,run:()=>void,parent:HTMLElement):HTMLButtonElement=>{const node=document.createElement('button');node.textContent=label;node.className='icon-btn popup-item';node.onclick=run;parent.append(node);return node;};
  const text=(value:string):void=>{const node=document.createElement('p');node.textContent=value;content.append(node);};
  const field=(label:string,key:string,choices?:string[]):void=>{
    const row=document.createElement('label');row.style.display='block';row.style.margin='12px 0';row.append(document.createTextNode(label+' '));
    if(choices){const select=document.createElement('select');for(const choice of choices){const option=document.createElement('option');option.value=choice;option.textContent=choice;select.append(option);}select.value=String(values[key]);select.onchange=()=>{values[key]=select.value;};row.append(select);}
    else {const input=document.createElement('input');input.type=typeof values[key]==='boolean'?'checkbox':'number';if(input.type==='checkbox')input.checked=values[key]===true;else {input.value=String(values[key]);input.min='10';input.max='24';}input.onchange=()=>{values[key]=input.type==='checkbox'?input.checked:Number(input.value);};row.append(input);}content.append(row);
  };
  const show=(tab:number):void=>{content.replaceChildren();for(const [i,node]of Array.from(nav.children).entries())node.setAttribute('aria-selected',String(i===tab));
    if(tab===0){field('언어','language',['auto','ko','en','ja','de','fr']);field('글꼴 크기','fontSize');field('높은 대비','highContrast');for(const [label,key]of [['추론 표시','showThinking'],['도구 표시','showTools'],['할 일 표시','showTodos'],['하위 에이전트 표시','showSubagents'],['완료 알림','notifications']])field(label!,key!);}
    if(tab===1){text('계정 인증은 OMP가 관리합니다. 터미널에서 omp /login으로 로그인할 수 있습니다.');button('로그인 제공자 상태',()=>action({t:'accountStatus'}),content);text('채팅 상단의 모델·추론 선택에서 사용 가능한 모델을 변경할 수 있습니다.');}
    if(tab===2){field('새 대화 기본 접근 모드','defaultApproval',['always-ask','write','yolo','plan']);text('모델 역할·preset은 OMP /modelpreset 명령으로 설정합니다.');button('모델 preset',()=>{sheet.hidden=true;action({t:'runCommand',text:'/modelpreset'});},content);}
    if(tab===3){button('MCP·플러그인 목록',()=>{sheet.hidden=true;document.getElementById('plus-btn')?.click();},content);text('목록의 관리 메뉴에서 작업영역 설정을 열 수 있습니다.');}
    if(tab===4){text('OMP: '+String(frame['ompExecutable']??''));text('Profile: '+String(frame['ompProfile']??''));text('설정은 현재 프로젝트의 비공개 저장소에 저장됩니다. OMP 실행 경로는 Core settings.json에서 설정합니다.');button('파일 변경 기록',()=>{sheet.hidden=true;action({t:'runCommand',text:'/restore'});},content);}
  };
  tabs.forEach((label,index)=>{const node=button(label,()=>show(index),nav);node.setAttribute('role','tab');});
  const status=document.createElement('p');status.setAttribute('role','status');footer.append(status);let closeAfterSave=false;
  const submit=(close:boolean):void=>{closeAfterSave=close;status.textContent='저장 중…';for(const node of Array.from(footer.querySelectorAll('button')))node.disabled=true;save({...values});};
  result=(ok,message)=>{for(const node of Array.from(footer.querySelectorAll('button')))node.disabled=false;status.textContent=ok?'저장했습니다.':message??'저장하지 못했습니다.';if(ok&&closeAfterSave)sheet.hidden=true;};
  button('적용',()=>submit(false),footer);button('저장하고 닫기',()=>submit(true),footer);button('취소',()=>{sheet.hidden=true;result=undefined;},footer);show(0);
}
export function applyPreferences(values:Frame):void {
  document.documentElement.style.fontSize=String(values['fontSize']??13)+'px';
  document.documentElement.style.setProperty('--fontSize',String(values['fontSize']??13)+'px');
  document.body.style.fontSize=String(values['fontSize']??13)+'px';
  document.body.classList.toggle('piagent-high-contrast',values['highContrast']===true);
  let style=document.getElementById('piagent-preferences-style');if(!style){style=document.createElement('style');style.id='piagent-preferences-style';document.head.append(style);}
  const selectors:string[]=[];if(values['showThinking']===false)selectors.push('.thinking-row','.tool-group.only-thinking');if(values['showTools']===false)selectors.push('.tool-row','.tool-input');if(values['showTodos']===false)selectors.push('#todo-panel');if(values['showSubagents']===false)selectors.push('.subagent-row');
  style.textContent=(selectors.length?selectors.join(',')+'{display:none!important}':'')+' .piagent-high-contrast{--fg:#fff;--bg:#000}';
}
