import {Controller, type Frame} from './controller.js';
import {interaction,clearInteractions} from './interactions.js';
import {settings,settingsResult,applyPreferences} from './settings.js';
import {accountStatus,accountEvent,clearAccount} from './account.js';
import {rolesResult,clearRoles} from './roles.js';
import {executionResult,executionEvent,clearExecution} from './execution.js';
import {gitStatus,gitPanel} from './git.js';
interface Host { postMessage(frame: Frame): void; addEventListener(type: string, listener: (event: MessageEvent) => void): void; }
const hostWindow = window as unknown as {chrome: {webview: Host}; piagentPost: (frame: Frame) => void; __agentHost: (frame: Frame) => void};
const element = (id: string): HTMLElement => document.getElementById(id)!;
const disable = (id: string, disabled = true): void => { (element(id) as HTMLButtonElement).disabled = disabled; };
let lastStatus:Frame|undefined,lastCapabilities:Frame|undefined;
const applyCapabilities=(frame:Frame):void=>{
  disable('btw-btn',!frame['btwEnabled']||!frame['connected']);disable('export-btn',!frame['exportEnabled']||!frame['connected']||!!frame['busy']);
  disable('approval-select',!frame['approvalModes']||!frame['connected']||!!frame['busy']);disable('plus-btn',!frame['attachmentsEnabled']||!frame['connected']||!!frame['busy']);
  disable('model-btn',!frame['ompControlsEnabled']||!frame['connected']||!!frame['busy']);disable('thinking-select',!frame['ompControlsEnabled']||!frame['connected']||!!frame['busy']);
};
const controller = new Controller(frame => hostWindow.chrome.webview.postMessage(frame), {
  interaction, clearInteractions,
  settingsResult,
  gitStatus:(data,enabled)=>gitStatus(data,enabled,msg=>controller.action(msg)),gitPanel,
  accountStatus,
  accountEvent,clearAccount,
  rolesResult,clearRoles,
  executionResult,executionEvent,clearExecution,
  settings:(frame,save)=>settings(frame,save,msg=>controller.action(msg)),
  sheet:(title,text,next)=>{hostWindow.__agentHost({t:'sheet',title,text});if(next){const button=document.createElement('button');button.className='icon-btn popup-item';button.textContent='다음 기록';button.onclick=next;element('sheet-body').append(button);}},
  emit: frame => {if(frame['t']==='status')lastStatus=frame;if(frame['t']==='preferences'){const values=frame['values'] as Frame;applyPreferences(values);const lang=values['language']==='auto'?(['ko','en','ja','de','fr'].find(lang=>navigator.language.startsWith(lang))??'en'):String(values['language']);void fetch(`lang/${lang}.json`).then(r=>r.json()).then(items=>{hostWindow.__agentHost({t:'strings',lang,items});if(lastStatus)hostWindow.__agentHost(lastStatus);if(lastCapabilities)applyCapabilities(lastCapabilities);}).catch(()=>{});return;}hostWindow.__agentHost(frame);},
  list: (title, items) => {
    hostWindow.__agentHost({t: 'sheet', title, text: ''});
    const body = element('sheet-body');
    if (!items.length) body.textContent = '저장된 항목이 없습니다.';
    for (const item of items) {
      const button = document.createElement('button'); button.className = 'icon-btn popup-item'; button.textContent = item.label; button.disabled = !!item.disabled;
      button.addEventListener('click', () => { element('sheet').hidden = true; item.run(); });
      if(!item.remove){body.appendChild(button);continue;}
      const row=document.createElement('div');row.className='session-list-row';row.append(button);
      const remove=document.createElement('button');remove.className='icon-btn';remove.textContent='삭제';remove.setAttribute('aria-label',`${item.label} 삭제`);row.append(remove);
      remove.onclick=()=>{
        const prompt=document.createElement('div');prompt.className='session-delete-confirm';
        const text=document.createElement('span');text.textContent='빈 세션을 삭제할까요? 이 작업은 되돌릴 수 없습니다.';
        const yes=document.createElement('button');yes.className='icon-btn';yes.textContent='삭제 확인';
        const no=document.createElement('button');no.className='icon-btn';no.textContent='취소';
        yes.onclick=()=>{yes.disabled=no.disabled=true;item.remove?.();};
        no.onclick=()=>{prompt.remove();row.hidden=false;remove.focus();};
        prompt.append(text,yes,no);row.after(prompt);row.hidden=true;no.focus();
      };body.append(row);
    }
    body.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  },
  capabilities: frame => {
    // Preserve the original controls and placement, but never advertise unsupported Core commands.
    lastCapabilities=frame;applyCapabilities(frame);
  }
});
hostWindow.piagentPost = frame => {
  if (frame['t'] !== 'ready') { controller.action(frame); return; }
  const language = ['ko', 'en', 'ja', 'de', 'fr'].find(lang => navigator.language.startsWith(lang)) ?? 'en';
  void fetch(`lang/${language}.json`).then(response => { if (!response.ok) throw new Error('Missing UI translations'); return response.json() as Promise<Frame>; }).then(items => {
    hostWindow.__agentHost({t: 'strings', lang: language, items});
    hostWindow.__agentHost({t: 'commands', items: [
      {name: 'new', description: '새 대화'}, {name: 'sessions', description: '저장된 대화'},
      {name: 'usage', description: '사용량'}, {name: 'restore', description: '파일 변경 기록'}, {name: 'selection', description: '편집기 선택 영역 가져오기'}
    ]}); controller.action(frame);
  }).catch(() => controller.action(frame));
};
hostWindow.chrome.webview.addEventListener('message', event => controller.receive(event.data as Frame));
