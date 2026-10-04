import {Controller, type Frame} from './controller.js';
import {interaction,clearInteractions} from './interactions.js';
import {settings,settingsResult,applyPreferences} from './settings.js';
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
  settings:(frame,save)=>settings(frame,save,msg=>controller.action(msg)),
  sheet:(title,text,next)=>{hostWindow.__agentHost({t:'sheet',title,text});if(next){const button=document.createElement('button');button.className='icon-btn popup-item';button.textContent='다음 기록';button.onclick=next;element('sheet-body').append(button);}},
  emit: frame => {if(frame['t']==='status')lastStatus=frame;if(frame['t']==='preferences'){const values=frame['values'] as Frame;applyPreferences(values);const lang=values['language']==='auto'?(['ko','en','ja','de','fr'].find(lang=>navigator.language.startsWith(lang))??'en'):String(values['language']);void fetch(`lang/${lang}.json`).then(r=>r.json()).then(items=>{hostWindow.__agentHost({t:'strings',lang,items});if(lastStatus)hostWindow.__agentHost(lastStatus);if(lastCapabilities)applyCapabilities(lastCapabilities);}).catch(()=>{});return;}hostWindow.__agentHost(frame);},
  list: (title, items) => {
    hostWindow.__agentHost({t: 'sheet', title, text: ''});
    const body = element('sheet-body');
    if (!items.length) body.textContent = '저장된 항목이 없습니다.';
    for (const item of items) {
      const button = document.createElement('button'); button.className = 'icon-btn popup-item'; button.textContent = item.label; button.disabled = !!item.disabled;
      button.addEventListener('click', () => { element('sheet').hidden = true; item.run(); }); body.appendChild(button);
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
