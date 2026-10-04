import {Controller, type Frame} from './controller.js';
import {interaction,clearInteractions} from './interactions.js';
interface Host { postMessage(frame: Frame): void; addEventListener(type: string, listener: (event: MessageEvent) => void): void; }
const hostWindow = window as unknown as {chrome: {webview: Host}; piagentPost: (frame: Frame) => void; __agentHost: (frame: Frame) => void};
const element = (id: string): HTMLElement => document.getElementById(id)!;
const disable = (id: string, disabled = true): void => { (element(id) as HTMLButtonElement).disabled = disabled; };
const controller = new Controller(frame => hostWindow.chrome.webview.postMessage(frame), {
  interaction, clearInteractions,
  emit: frame => hostWindow.__agentHost(frame),
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
    for (const id of ['btw-btn', 'export-btn']) disable(id);
    disable('approval-select',!frame['approvalModes']||!frame['connected']||!!frame['busy']);disable('plus-btn',!frame['attachmentsEnabled']||!frame['connected']||!!frame['busy']);
    disable('model-btn',!frame['ompControlsEnabled']);disable('thinking-select',!frame['ompControlsEnabled']);
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
