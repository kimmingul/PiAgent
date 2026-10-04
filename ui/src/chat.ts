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
const sessionTools = element('sessionTools'), sessions = element<HTMLSelectElement>('sessions');
const refreshSessions = element<HTMLButtonElement>('refreshSessions'), resumeSession = element<HTMLButtonElement>('resumeSession');
const usageTools = element('usageTools'), refreshUsage = element<HTMLButtonElement>('refreshUsage'), usageText = element('usageText');
let selectionEnabled = false, sessionsEnabled = false, usageEnabled = false;
refreshSessions.onclick = () => bridge.postMessage({action:'listSessions'});
resumeSession.onclick = () => {
  if (!sessions.value || !connected || busy || review) return;
  switching = true; busy = true; controls(); status.textContent = '저장된 대화 재개 중…';
  bridge.postMessage({action:'resumeSession',savedSessionId:sessions.value});
};
refreshUsage.onclick = () => bridge.postMessage({action:'usage'});
sessions.onchange = () => controls();
const approvalCard = element('approvalCard'), approvalTitle = element('approvalTitle'), approvalReason = element('approvalReason'), approvalDiff = element('approvalDiff');
const approveChange = element<HTMLButtonElement>('approveChange'), rejectChange = element<HTMLButtonElement>('rejectChange');
const checkpointTools = element('checkpointTools'), checkpoints = element<HTMLSelectElement>('checkpoints');
const refreshCheckpoints = element<HTMLButtonElement>('refreshCheckpoints'), previewRestore = element<HTMLButtonElement>('previewRestore');
let writeEnabled = false, deciding = false;
let review: { mode:'edit'|'restore'; id:string } | undefined;
let connected = false; let busy = false; let switching = false; let sessionId = ''; let turnId = ''; let sequence = 0;
let assistant: HTMLElement | undefined; let total = 0;
function controls(): void {
  send.disabled = !connected || busy || !!review || !input.value.trim(); stop.disabled = !busy || !turnId;
  reset.disabled = !connected || busy || !!review; connect.disabled = connected || busy; capture.disabled = !selectionEnabled || !connected || busy; clearContext.disabled = busy || !contextSummary;
  refreshSessions.disabled = !connected || busy || !!review; resumeSession.disabled = refreshSessions.disabled || !sessions.value;
  refreshUsage.disabled = !connected || busy || !!review;
  approveChange.disabled = rejectChange.disabled = !connected || !review || deciding;
  refreshCheckpoints.disabled = !connected || busy || !!review; previewRestore.disabled = refreshCheckpoints.disabled || !checkpoints.value;
}
function clearReview(): void { review = undefined; deciding = false; approvalCard.hidden = true; approvalDiff.textContent = ''; controls(); }
function showReview(mode: 'edit'|'restore', data: Record<string, unknown>): void {
  review = {mode, id:String(mode === 'edit' ? data['proposalId'] : data['checkpointId'])}; deciding = false;
  const files = data['files'] as {path:string}[] | undefined;
  approvalCard.hidden = false; approvalTitle.textContent = `${mode === 'edit' ? '변경 승인' : '복원 확인'} · ${files && files.length > 1 ? files.map(f => f.path).join(', ') : String(data['path'])}`;
  approvalReason.textContent = mode === 'edit' ? String(data['reason']) : '이 변경 직전의 파일 내용으로 되돌립니다. 이후 파일이 달라졌다면 복원을 거부합니다.';
  approvalDiff.textContent = String(data['diff']); approveChange.textContent = mode === 'edit' ? '승인하고 적용' : '복원 적용'; rejectChange.textContent = mode === 'edit' ? '거절' : '닫기'; controls();
}
approveChange.onclick = () => { if (!review || deciding) return; deciding = true; controls();
  bridge.postMessage(review.mode === 'edit' ? {action:'decideChange',proposalId:review.id,decision:'approve'} : {action:'restoreChange',checkpointId:review.id}); };
rejectChange.onclick = () => { if (!review || deciding) return;
  if (review.mode === 'restore') { clearReview(); return; } deciding = true; controls(); bridge.postMessage({action:'decideChange',proposalId:review.id,decision:'reject'}); };
refreshCheckpoints.onclick = () => bridge.postMessage({action:'listCheckpoints'});
previewRestore.onclick = () => { if (checkpoints.value) bridge.postMessage({action:'previewRestore',checkpointId:checkpoints.value}); };
checkpoints.onchange = controls;
function line(role: string, text: string): HTMLElement {
  const article = document.createElement('article'); const label = document.createElement('strong');
  label.textContent = role; const body = document.createElement('pre'); body.textContent = text;
  article.append(label, body); transcript.append(article);
  while (transcript.children.length > 100) transcript.firstElementChild?.remove();
  transcript.scrollTop = transcript.scrollHeight; return body;
}
function error(text: string): void { status.textContent = text; busy = false; controls(); }
connect.onclick = () => { status.textContent = '연결 중…'; bridge.postMessage({ action: 'connect' }); };
reset.onclick = () => { if (!connected || busy || review) return; switching = true; busy = true; controls(); status.textContent = '새 대화 시작 중…'; bridge.postMessage({ action: 'reset' }); };
stop.onclick = () => { stop.disabled = true; status.textContent = '취소 요청 중…'; bridge.postMessage({ action: 'cancel', turnId }); };
input.oninput = controls;
capture.onclick = () => { bridge.postMessage({ action: 'captureSelection' }); };
clearContext.onclick = () => { bridge.postMessage({ action: 'clearSelection' }); };
form.onsubmit = event => {
  event.preventDefault(); if (!connected || busy || review || !input.value.trim()) return;
  const message = input.value; if (new TextEncoder().encode(message).length > 65536) { error('메시지는 64 KiB 이하로 입력해 주세요.'); return; }
  if (message.trimStart().startsWith('/')) { error('이번 버전에서는 일반 텍스트 질문을 입력해 주세요.'); return; }
  line('나', message + (contextSummary ? `\n[선택 코드 첨부: ${contextSummary}]` : '')); input.value = ''; assistant = undefined; total = 0; busy = true; turnId = ''; controls();
  status.textContent = '응답 대기 중…'; bridge.postMessage({ action: 'prompt', message });
};
input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } };
bridge.addEventListener('message', event => {
  const frame = event.data as Record<string, unknown>;
  if (frame['type'] === 'sessions') {
    sessions.replaceChildren(); for (const item of frame['sessions'] as Record<string,unknown>[]) {
      const option = document.createElement('option'); option.value = String(item['savedSessionId']);
      option.textContent = `${String(item['title'])} · ${new Date(Number(item['updatedAt'])).toLocaleString()}`;
      option.disabled = item['resumable'] !== true; sessions.append(option);
    } controls(); return;
  }
  if (frame['type'] === 'usage') {
    const data = frame['data'] as Record<string,unknown>, tokens = data['tokens'] as Record<string,unknown>;
    const number = (value:unknown): string => typeof value === 'number' ? value.toLocaleString(undefined,{maximumFractionDigits:6}) : '정보 없음';
    const limits = data['providerLimits'] as {plan?:string;limits?:{label?:string;window?:string;usedFraction?:number;resetsAt?:number}[]} | undefined;
    usageText.textContent = `${String(data['provider'] ?? '')} / ${String(data['model'] ?? '')}\n세션 토큰: ${number(tokens?.['total'])} (입력 ${number(tokens?.['input'])} · 출력 ${number(tokens?.['output'])} · 캐시 읽기 ${number(tokens?.['cacheRead'])})\n세션 비용 (USD): ${number(data['cost'])}\nPremium requests: ${number(data['premiumRequests'])}`
      + (limits ? `\n플랜: ${limits.plan ?? '정보 없음'}\n` + (limits.limits ?? []).map(l => `${l.label ?? l.window ?? '한도'}: ${typeof l.usedFraction === 'number' ? (l.usedFraction * 100).toFixed(1) + '%' : '정보 없음'} 사용`).join('\n') : '\n계정 한도: 정보 없음'); return;
  }
  if (frame['type'] === 'operationError') { deciding = false; if (!turnId) { busy = false; switching = false; } status.textContent = String(frame['message']); controls(); }
  else if (frame['type'] === 'checkpoints') {
    checkpoints.replaceChildren();
    for (const item of frame['items'] as Record<string,unknown>[]) {
      const option = document.createElement('option'); option.value = String(item['checkpointId']);
      const files = item['files'] as {path:string}[] | undefined;
      const paths = files && files.length > 1 ? files.map(file => file.path).join(', ') : String(item['path']);
      option.textContent = `${paths} · ${new Date(Number(item['createdAt'])).toLocaleString()} · ${String(item['state'])}`; checkpoints.append(option);
    } controls();
  } else if (frame['type'] === 'restorePreview') showReview('restore',frame['data'] as Record<string,unknown>);
  else if (frame['type'] === 'restored') { clearReview(); status.textContent = frame['warning'] ? `파일 복원됨 · ${String(frame['warning'])}` : '파일을 복원했습니다. 새 대화로 이어가세요.'; line('파일 복원',status.textContent); bridge.postMessage({action:'listCheckpoints'}); }
  else if (frame['type'] === 'selection') {
    const context = frame['context'] as { documentUri: string; language: string; selection: { text: string; startLine: number; endLine: number } } | null;
    contextSummary = context ? `${context.documentUri} · ${context.language} · ${context.selection.startLine}–${context.selection.endLine}행` : '';
    preview.hidden = !context; preview.open = !!context; contextLabel.textContent = contextSummary;
    contextText.textContent = context?.selection.text ?? '';
    if (context) { if (!input.value.trim()) input.value = '선택한 코드가 어떻게 동작하는지 한국어로 설명해 주세요.'; input.focus(); }
    controls();
  } else if (frame['type'] === 'session') {
    connected = true; busy = false; switching = false; sessionId = String(frame['sessionId']); turnId = ''; sequence = 0;
    selectionEnabled = frame['selectionEnabled'] === true; capture.hidden = clearContext.hidden = !selectionEnabled;
    sessionsEnabled = frame['sessionsEnabled'] === true; sessionTools.hidden = !sessionsEnabled;
    usageEnabled = frame['usageEnabled'] === true; usageTools.hidden = !usageEnabled;
    element('savedSession').textContent = frame['savedSessionId'] ? '자동 저장됨' : '';
    clearReview(); checkpoints.replaceChildren(); writeEnabled = frame['writeEnabled'] === true; checkpointTools.hidden = !writeEnabled;
    transcript.replaceChildren(); status.textContent = writeEnabled ? `연결됨 · 승인 후 변경 가능: ${String(frame['workspaceUri'])}` : frame['readOnly'] === true
      ? `연결됨 · 읽기 전용 workspace: ${String(frame['workspaceUri'])}` : '연결됨 · 텍스트 채팅';
    element('toolScope').textContent = writeEnabled ? '파일 변경마다 승인 · Git checkpoint' : frame['readOnly'] === true ? '파일 읽기·검색 · 파일 변경 도구 없음' : '텍스트 채팅 · 파일 변경 도구 없음';
    if (writeEnabled) bridge.postMessage({action:'listCheckpoints'});
    for (const item of (frame['transcript'] ?? []) as {role:string;text:string}[]) line(item.role === 'user' ? '나' : item.role === 'assistant' ? 'PiAgent' : '상태', item.text);
    if (sessionsEnabled) bridge.postMessage({action:'listSessions'});
    if (usageEnabled) bridge.postMessage({action:'usage'});
    controls(); input.focus();
  } else if (frame['type'] === 'disconnected') {
    connected = false; switching = false; error(String(frame['message'] ?? '연결 종료')); turnId = ''; controls();
    clearReview();
  } else if (frame['type'] === 'error') { error(String(frame['message'])); }
  else if (frame['type'] === 'event') {
    const data = frame['data'] as Record<string, unknown>;
    if (data['sessionId'] !== sessionId || typeof data['sequence'] !== 'number' || data['sequence'] <= sequence) return;
    sequence = data['sequence']; const kind = data['kind'];
    if (kind === 'warning') { status.textContent = String(data['text']); line('주의',String(data['text'])); controls(); return; }
    if (kind === 'started') { turnId = String(data['turnId']); busy = true; status.textContent = '응답 중…'; }
    else if (data['turnId'] === turnId) {
      if (kind === 'approval_requested') { showReview('edit',data['approval'] as Record<string,unknown>); status.textContent = '파일 변경 승인 대기 중'; }
      else if (kind === 'approval_resolved') { clearReview(); const result = data['approval'] as Record<string,unknown>;
        status.textContent = result['approved'] === true ? (result['warning'] ? `변경 적용됨 · ${String(result['warning'])}` : '변경 적용 완료 · checkpoint 저장됨') : String(result['reason']);
        line('파일 변경',status.textContent); }
      else if (kind === 'tool_started' || kind === 'tool_completed') {
        status.textContent = `${kind === 'tool_started' ? '도구 실행 중' : '도구 실행 완료'} · ${String(data['text'])}`;
      } else if (kind === 'delta') {
        assistant ??= line('PiAgent', ''); const text = String(data['text'] ?? '');
        if (total < 2_000_000) { const part = text.slice(0, 2_000_000 - total); assistant.append(document.createTextNode(part)); total += part.length; }
        transcript.scrollTop = transcript.scrollHeight;
      } else if (kind === 'completed' || kind === 'cancelled' || kind === 'error') {
        busy = false; status.textContent = kind === 'completed' ? '응답 완료' : kind === 'cancelled' ? '취소됨' : String(data['text'] ?? '응답 오류');
        turnId = ''; input.focus();
        clearReview(); if (writeEnabled) bridge.postMessage({action:'listCheckpoints'});
        if (sessionsEnabled) bridge.postMessage({action:'listSessions'});
        if (usageEnabled) bridge.postMessage({action:'usage'});
      }
    }
    if (kind === 'closed') { connected = false; busy = switching; clearReview(); status.textContent = switching ? '대화 준비 중…' : '세션 종료 · 다시 연결할 수 있습니다.'; }
    controls();
  }
});
controls(); connect.focus(); bridge.postMessage({ action: 'ready' });
