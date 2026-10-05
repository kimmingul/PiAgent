# PiAgent 0.9.10 설정 화면 수정

- 설정 전용 CSS 및 가로 탭, 선택 상태, 키보드 탭 탐색을 구현했다.
- 입력창/선택창/체크박스에 채팅 테마를 적용하고 라벨을 정렬했다.
- 내용만 스크롤하며 하단 저장/취소 버튼과 버전 표시를 유지한다.
- 좁은 창/확대 화면에서는 개발자 상세 정보를 고급 탭에서 확인한다.
- Core 패키지의 실제 버전을 표시한다. 개발자: 김민걸 (Min-Gul Kim), mgkim@jbnu.ac.kr.
- 기존 채팅 스타일, 다섯 설정 분류, Core/adapter 구조 및 저장 승인 흐름을 유지한다.

`npm test` 89/89 통과. 실제 WebView2에서 표시/100·150·200% 배율/키보드/
저장 성공·실패/취소, CSP 및 12회 docking/tab/hide 전환을 검증했다.
설정 내용 영역 최소 높이와 하단 버튼의 viewport 포함 여부를 검사하고 PNG를 직접 확인했다.
설치본 전수 검증의 기존 제한은 [0.9.9 기록](MESSAGE-TIMELINE-AND-INSTALLED-ACCEPTANCE.md)을 유지한다.
검증용 unsigned preview는 `dist/PiAgent-Setup-0.9.10-unsigned-preview.exe`이다.
실제 포함 UI로 WebView2 검증을 재실행해 통과했다.
최종 코드서명 설치파일 경로는 `dist/PiAgent-Setup-0.9.10.exe`이다.
실행 중인 IDE의 설치본은 자동으로 교체하지 않았다.

USB 인증서로 최종 설치파일을 서명했다. Authenticode `Valid`, 기대 인증서와
RFC3161 타임스탬프, SHA256 체크섬 및 전체 포함 파일 해시 검증이 통과했다.
포함된 Node.js ARM64/x64 런타임의 인증 handshake/capability negotiation/ping과
설치 안전성 검사도 통과했다. 서명 설치파일에서 추출한 UI로 WebView2 검증을
재실행해 100·150·200% 배율, 저장/취소 및 12회 창 전환 검사를 통과했다.
검증 기록: `artifacts/settings-ui-signed-installer-tests.log`,
`artifacts/settings-ui-preview/signed/webview.log`,
`artifacts/settings-ui-0.9.10-signature.json`.
