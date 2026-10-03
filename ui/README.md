# Shared WebView UI (planned)

RADAgent `src/chat/chat.html`, CSS, JS 모듈을 재사용 후보로 삼는다.
현재 slice에는 UI 복사나 실행 코드를 추가하지 않는다. reference repository는 수정하지 않는다.

향후 UI는 transcript/status/usage/approval 같은 IDE-neutral view model을 받는다.
RAD Studio와 VS adapter의 WebView host bridge가 메시지를 typed Core API로 연결한다.
Delphi ToolsAPI와 VS SDK 코드는 UI에 넣지 않는다. Core protocol과 OMP raw frame도
HTML에서 직접 처리하지 않고 typed session/event 계층에서 변환한다.

우선 기존 HTML/CSS/JS의 message contract와 localization을 보존하고, 필요한 모듈부터
TypeScript로 정리한다. UI attach/detach는 OMP/session 수명과 독립적이어야 한다.
approval 카드는 승인 ID/취소 상태를, checkpoint/usage view는 Core가 관리하는 모델을 사용한다.
