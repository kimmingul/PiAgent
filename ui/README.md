# Shared WebView UI

VS와 RAD Studio가 사용하는 strict TypeScript HTML/CSS UI이다. RADAgent의 composer/host bridge
패턴을 참고했으며 reference repository는 수정하지 않았다.

채팅 스트리밍·취소·새 대화, 저장된 대화 재개, 사용량·비용·계정 한도, 전체 파일 diff 검토와
명시적 승인, 체크포인트의 역방향 diff 검토·복원을 제공한다. 다중 파일 제안은 모든 파일의 diff를
한 승인 카드에 표시한다. 선택 코드 캡처는 해당 기능을 제공하는 VS adapter에서만 표시한다.

UI는 OMP raw command, shell, IDE SDK에 접근하지 않는다. 제한된 bridge action을 adapter가
Core RPC로 변환하고 proposal revision은 adapter가 보관한다. 미저장 문서는 adapter가 검사한다.
모델 출력과 저장 대화는 textContent/TextNode로 렌더링하며 HTML로 실행하지 않는다.
두 host 모두 local virtual origin, CSP, navigation/download/permission 차단을 사용한다.

`npm run build`는 src/chat.ts를 dist/chat.js로 빌드한다. VSIX에 HTML/CSS/JS를 포함하고
BPL에는 같은 자산과 해당 bitness WebView2Loader.dll을 나란히 배포한다.
Enter 전송, Shift+Enter 줄바꿈과 키보드 승인·복원을 지원한다. 작은 창에서는 본문을 스크롤한다.
창을 숨겨도 연결은 유지하며 IDE 종료/package unload는 pipe와 OMP child를 정리한다.

`tests/ui.test.mjs`는 최소 DOM으로 capability gating, 안전한 기록 표시, 승인·복원·실패 재시도,
세션 bridge action과 알려지지 않은 사용량을 검사한다. 실제 WebView host 검증은
[VALIDATION.md](../docs/VALIDATION.md)에 기록한다.
