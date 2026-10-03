# Shared WebView UI

0.4.0은 session의 readOnly/workspaceUri와 tool_started/tool_completed를 표시한다.
UI/adapter가 읽기 root를 공급하지 않으며 도구 실행은 Core 책임이다.

RADAgent의 composer/host bridge 패턴을 참고해 최소 입력·응답·취소 UI를 TypeScript로 작성했다.
reference repository는 수정하지 않는다. 전체 RADAgent UI 포팅은 하지 않는다.

현재 UI는 transcript/status와 typed chat event를 받는다. usage/approval은 후속 범위다.
VS adapter의 WebView host bridge가 메시지를 typed Core API로 연결한다. RAD WebView host는 후속 범위이다.
Delphi ToolsAPI와 VS SDK 코드는 UI에 넣지 않는다. Core protocol과 OMP raw frame도
HTML에서 직접 처리하지 않고 typed session/event 계층에서 변환한다.

src/chat.ts를 루트 npm run build로 dist/chat.js에 빌드한다. VSIX build가 HTML/CSS/JS를 패키징한다.
WebView2는 bridge의 ready/connect/reset/prompt/cancel/captureSelection/clearSelection을 사용한다.
0.3.0은 host가 캡처한 선택 코드의 URI·언어·범위·텍스트를 미리 표시한다. UI가 임의 context를 공급하지 않는다.
외부 네트워크 콘텐츠는 로드하지 않는다.
모델 출력은 HTML로 해석하지 않는다. Enter 전송, Shift+Enter 줄바꿈, 연결·새 대화·취소를 지원한다.
Tool window 숨김/재표시는 연결을 유지한다. IDE/tool window disposal은 pipe와 OMP session을 정리한다.
approval 카드는 승인 ID/취소 상태를, checkpoint/usage view는 Core가 관리하는 모델을 사용한다.
