import {label as localizedLabel,attribute,t} from './i18n.js';
import {accountPanel} from './account.js';
import {rolesPanel} from './roles.js';
import {executionPanel} from './execution.js';
import {object,type Frame} from './controller.js';
const tabLabels=()=>[t("표시"),t("계정"),t("모델 역할"),t("확장"),t("고급")];
let result:((ok:boolean,message?:string)=>void)|undefined;
export function settingsResult(ok:boolean,message?:string):void{result?.(ok,message);}
/** Settings use the existing sheet and original RADAgent tab order. No credential editing. */
export function settings(frame:Frame,save:(values:Frame)=>void,action:(frame:Frame)=>void):void {
  const tabs=tabLabels();
  const values={...object(frame['values'])};
  const sheet=document.getElementById('sheet')!,body=document.getElementById('sheet-body')!;
  localizedLabel(document.getElementById('sheet-title')!,t("PiAgent 설정"));sheet.hidden=false;body.replaceChildren();
  const root=document.createElement('div');root.className='piagent-settings';
  const nav=document.createElement('div'),content=document.createElement('div'),footer=document.createElement('div');
  nav.className='settings-tabs';nav.setAttribute('role','tablist');attribute(nav,'aria-label',t("설정 분류"));
  content.className='settings-content';content.id='settings-content';content.setAttribute('role','tabpanel');
  footer.className='settings-footer';root.append(nav,content,footer);body.append(root);
  const button=(label:string,run:()=>void,parent:HTMLElement):HTMLButtonElement=>{const node=document.createElement('button');node.type='button';localizedLabel(node,label);node.className='settings-button';node.onclick=run;parent.append(node);return node;};
  const text=(value:string):void=>{const node=document.createElement('p');localizedLabel(node,value);content.append(node);};
  const field=(label:string,key:string,choices?:string[]):void=>{
    const row=document.createElement('label');row.className='settings-field';const caption=document.createElement('span');localizedLabel(caption,label);row.append(caption);
    if(choices){const select=document.createElement('select');const names:Record<string,string>={auto:t("자동 (시스템 언어)"),ko:t("한국어"),en:'English',ja:'日本語',de:'Deutsch',fr:'Français','always-ask':t("항상 묻기"),write:t("쓰기 허용"),yolo:t("전체 액세스"),plan:t("계획")};for(const choice of choices){const option=document.createElement('option');option.value=choice;localizedLabel(option,names[choice]??choice);select.append(option);}select.value=String(values[key]);select.onchange=()=>{values[key]=select.value;};row.append(select);}
    else {const input=document.createElement('input');input.type=typeof values[key]==='boolean'?'checkbox':'number';if(input.type==='checkbox'){row.classList.add('settings-check');input.checked=values[key]===true;}else {input.value=String(values[key]);input.min='10';input.max='24';input.step='1';}input.onchange=()=>{values[key]=input.type==='checkbox'?input.checked:Number(input.value);};row.append(input);}content.append(row);
  };
  const show=(tab:number):void=>{content.replaceChildren();content.scrollTop=0;content.setAttribute('aria-labelledby',`settings-tab-${tab}`);for(const [i,node]of Array.from(nav.children).entries()){node.setAttribute('aria-selected',String(i===tab));(node as HTMLElement).tabIndex=i===tab?0:-1;}
    if(tab===0){field(t("언어"),'language',['auto','ko','en','ja','de','fr']);text(t("자동: 한국어 시스템은 한국어, 그 외에는 영어를 사용합니다."));field(t("글꼴 크기"),'fontSize');field(t("높은 대비"),'highContrast');for(const [label,key]of [[t("추론 표시"),'showThinking'],[t("도구 표시"),'showTools'],[t("할 일 표시"),'showTodos'],[t("하위 에이전트 표시"),'showSubagents'],[t("완료 알림"),'notifications']])field(label!,key!);}
    if(tab===1){text(t("제공자를 선택해 로그인하세요. 인증은 OMP와 제공자의 공식 페이지에서 처리합니다."));button(t("로그인 제공자 상태"),()=>action({t:'accountStatus'}),content);content.append(accountPanel(action));action({t:'accountStatus'});}
    if(tab===2){field(t("새 대화 기본 접근 모드"),'defaultApproval',['always-ask','write','yolo','plan']);content.append(rolesPanel(action));}
    if(tab===3){button(t("MCP·플러그인 목록"),()=>{sheet.hidden=true;document.getElementById('plus-btn')?.click();},content);text(t("목록의 관리 메뉴에서 작업영역 설정을 열 수 있습니다."));}
    if(tab===4){button(t("로컬 Git 관리"),()=>action({t:'gitSetup',op:'status'}),content);const heading=document.createElement('h3');localizedLabel(heading,t("PiAgent 정보"));content.append(heading,about.cloneNode(true));text('OMP: '+String(frame['ompExecutable']??''));text('Profile: '+String(frame['ompProfile']??''));text(t("설정은 현재 프로젝트의 비공개 저장소에 저장됩니다. OMP 실행 경로는 Core settings.json에서 설정합니다."));button(t("파일 변경 기록"),()=>{sheet.hidden=true;action({t:'runCommand',text:'/restore'});},content);content.append(executionPanel(action));}
  };
  tabs.forEach((label,index)=>{const node=button(label,()=>show(index),nav);node.className='settings-tab';node.id=`settings-tab-${index}`;node.setAttribute('role','tab');node.setAttribute('aria-controls','settings-content');node.onkeydown=event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();show(next);(nav.children[next] as HTMLElement).focus();};});
  const about=document.createElement('div');about.className='settings-about';
  const version=document.createElement('strong');localizedLabel(version,`PiAgent ${typeof frame['piagentVersion']==='string'?frame['piagentVersion']:t("· 버전 확인 불가")}`);
  const developer=document.createElement('span');localizedLabel(developer,t("개발자: 김민걸 (Min-Gul Kim)"));
  const email=document.createElement('span');localizedLabel(email,'mgkim@jbnu.ac.kr');about.append(version,developer,email);footer.append(about);
  const status=document.createElement('p');status.className='settings-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');footer.append(status);
  const actions=document.createElement('div');actions.className='settings-actions';footer.append(actions);let closeAfterSave=false;
  const submit=(close:boolean):void=>{closeAfterSave=close;localizedLabel(status,t("저장 중…"));for(const node of Array.from(footer.querySelectorAll('button')))node.disabled=true;save({...values});};
  result=(ok,message)=>{for(const node of Array.from(footer.querySelectorAll('button')))node.disabled=false;localizedLabel(status,ok?t("저장했습니다."):message??t("저장하지 못했습니다."));if(ok&&closeAfterSave)sheet.hidden=true;};
  button(t("적용"),()=>submit(false),actions);button(t("저장하고 닫기"),()=>submit(true),actions).classList.add('settings-primary');button(t("취소"),()=>{sheet.hidden=true;result=undefined;},actions);show(frame['accountTab']===true?1:0);
}
export function applyPreferences(values:Frame):void {
  document.documentElement.style.fontSize=String(values['fontSize']??13)+'px';
  document.documentElement.style.setProperty('--fontSize',String(values['fontSize']??13)+'px');
  document.body.style.fontSize=String(values['fontSize']??13)+'px';
  document.body.classList.toggle('piagent-high-contrast',values['highContrast']===true);
  let style=document.getElementById('piagent-preferences-style');if(!style){style=document.createElement('style');style.id='piagent-preferences-style';document.head.append(style);}
  const selectors:string[]=[];if(values['showThinking']===false)selectors.push('.thinking-row','.tool-group.only-thinking');if(values['showTools']===false)selectors.push('.tool-row','.tool-input');if(values['showTodos']===false)selectors.push('#todo-panel');if(values['showSubagents']===false)selectors.push('.subagent-row');
  localizedLabel(style,(selectors.length?selectors.join(',')+'{display:none!important}':'')+' .piagent-high-contrast{--fg:#fff;--bg:#000}');
}
