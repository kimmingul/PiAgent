interface HostBridge { postMessage(message: unknown): void; addEventListener(type: 'message', callback: (event: MessageEvent) => void): void; }
const bridge = (window as unknown as { chrome: { webview: HostBridge } }).chrome.webview;
const element = <T extends HTMLElement>(id: string): T => {
  const item = document.getElementById(id); if (!item) throw new Error(`Missing ${id}`); return item as T;
};
const status = element('status'); const transcript = element('transcript');
const input = element<HTMLTextAreaElement>('message'); const form = element<HTMLFormElement>('composer');
const send = element<HTMLButtonElement>('send'); const stop = element<HTMLButtonElement>('stop');
const connect = element<HTMLButtonElement>('connect'); const reset = element<HTMLButtonElement>('reset');
const capture = element<HTMLButtonElement>('capture'), clearContext = element<HTMLButtonElement>('clearContext');
const preview = element<HTMLDetailsElement>('contextPreview'), contextLabel = element('contextLabel'), contextText = element('contextText');
let contextSummary = '';
let connected = false; let busy = false; let sessionId = ''; let turnId = ''; let sequence = 0;
let assistant: HTMLElement | undefined; let total = 0;
function controls(): void { send.disabled = !connected || busy || !input.value.trim(); stop.disabled = !busy || !turnId; reset.disabled = !connected || busy; connect.disabled = connected; capture.disabled = !connected || busy; clearContext.disabled = busy || !contextSummary; }
function line(role: string, text: string): HTMLElement {
  const article = document.createElement('article'); const label = document.createElement('strong');
  label.textContent = role; const body = document.createElement('pre'); body.textContent = text;
  article.append(label, body); transcript.append(article);
  while (transcript.children.length > 100) transcript.firstElementChild?.remove();
  transcript.scrollTop = transcript.scrollHeight; return body;
}
function error(text: string): void { status.textContent = text; busy = false; controls(); }
connect.onclick = () => { status.textContent = '연결 중…'; bridge.postMessage({ action: 'connect' }); };
reset.onclick = () => { bridge.postMessage({ action: 'reset' }); };
stop.onclick = () => { stop.disabled = true; status.textContent = '취소 요청 중…'; bridge.postMessage({ action: 'cancel', turnId }); };
input.oninput = controls;
capture.onclick = () => { bridge.postMessage({ action: 'captureSelection' }); };
clearContext.onclick = () => { bridge.postMessage({ action: 'clearSelection' }); };
form.onsubmit = event => {
  event.preventDefault(); if (!connected || busy || !input.value.trim()) return;
  const message = input.value; if (new TextEncoder().encode(message).length > 65536) { error('메시지는 64 KiB 이하로 입력해 주세요.'); return; }
  if (message.trimStart().startsWith('/')) { error('이번 버전에서는 일반 텍스트 질문을 입력해 주세요.'); return; }
  line('나', message + (contextSummary ? `\n[선택 코드 첨부: ${contextSummary}]` : '')); input.value = ''; assistant = undefined; total = 0; busy = true; turnId = ''; controls();
  status.textContent = '응답 대기 중…'; bridge.postMessage({ action: 'prompt', message });
};
input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } };
bridge.addEventListener('message', event => {
  const frame = event.data as Record<string, unknown>;
  if (frame['type'] === 'selection') {
    const context = frame['context'] as { documentUri: string; language: string; selection: { text: string; startLine: number; endLine: number } } | null;
    contextSummary = context ? `${context.documentUri} · ${context.language} · ${context.selection.startLine}–${context.selection.endLine}행` : '';
    preview.hidden = !context; preview.open = !!context; contextLabel.textContent = contextSummary;
    contextText.textContent = context?.selection.text ?? '';
    if (context) { if (!input.value.trim()) input.value = '선택한 코드가 어떻게 동작하는지 한국어로 설명해 주세요.'; input.focus(); }
    controls();
  } else if (frame['type'] === 'session') {
    connected = true; busy = false; sessionId = String(frame['sessionId']); turnId = ''; sequence = 0;
    transcript.replaceChildren(); status.textContent = frame['readOnly'] === true
      ? `연결됨 · 읽기 전용 workspace: ${String(frame['workspaceUri'])}` : '연결됨 · 텍스트 채팅';
    element('toolScope').textContent = frame['readOnly'] === true ? '파일 읽기·검색 · 파일 변경 도구 없음' : '텍스트 채팅 · 파일 변경 도구 없음';
    controls(); input.focus();
  } else if (frame['type'] === 'disconnected') {
    connected = false; error(String(frame['message'] ?? '연결 종료')); turnId = ''; controls();
  } else if (frame['type'] === 'error') { error(String(frame['message'])); }
  else if (frame['type'] === 'event') {
    const data = frame['data'] as Record<string, unknown>;
    if (data['sessionId'] !== sessionId || typeof data['sequence'] !== 'number' || data['sequence'] <= sequence) return;
    sequence = data['sequence']; const kind = data['kind'];
    if (kind === 'started') { turnId = String(data['turnId']); busy = true; status.textContent = '응답 중…'; }
    else if (data['turnId'] === turnId) {
      if (kind === 'tool_started' || kind === 'tool_completed') {
        status.textContent = `${kind === 'tool_started' ? '파일 조회 중' : '파일 조회 완료'} · ${String(data['text'])}`;
      } else if (kind === 'delta') {
        assistant ??= line('PiAgent', ''); const text = String(data['text'] ?? '');
        if (total < 2_000_000) { const part = text.slice(0, 2_000_000 - total); assistant.append(document.createTextNode(part)); total += part.length; }
        transcript.scrollTop = transcript.scrollHeight;
      } else if (kind === 'completed' || kind === 'cancelled' || kind === 'error') {
        busy = false; status.textContent = kind === 'completed' ? '응답 완료' : kind === 'cancelled' ? '취소됨' : String(data['text'] ?? '응답 오류');
        turnId = ''; input.focus();
      }
    }
    if (kind === 'closed') { connected = false; busy = false; status.textContent = '세션 종료 · 다시 연결할 수 있습니다.'; }
    controls();
  }
});
controls(); bridge.postMessage({ action: 'ready' });
