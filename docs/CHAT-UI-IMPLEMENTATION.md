# 채팅 UI 구현 및 검증 기록

2026-10-05 KST. 기준 감사: [CHAT-UI-AUDIT-AND-IMPLEMENTATION-PLAN.md](CHAT-UI-AUDIT-AND-IMPLEMENTATION-PLAN.md).
초기 기록은 Core 0.9.0의 additive protocol 변경 및 VSIX 0.9.6 개발 산출물 기준이다.
현재 0.9.14로 서명·설치했으며 전체 실사용 acceptance는 PARTIAL/MANUAL 잔여 항목 때문에 완료로
주장하지 않는다. 2026-10-06 기준 상태는 [설치 acceptance](INSTALLED-ACCEPTANCE-0.9.14.md),
[후속 결함 수정](ACCEPTANCE-FIXES-0.9.14.md), [장시간 작업 수정](LONG-RUNNING-TURN-FIX.md)을 따른다.

## 구현한 동작

| 원본 UI 진입점 | 구현 경로와 결과 | 범위 |
|---|---|---|
| `/btw`, BTW 버튼, 후속 질문 | 전용 Core BTW 서비스 → tool-free OMP child → 원본 접힌 카드/노트 패널 | 메인 JSONL snapshot fork, 자체 resume, 중지/삭제, 검색·현재 대화 필터. 메인 turn/model을 변경하지 않음 |
| 설정 ⚙ | 원본 sheet에 표시·계정·모델 역할·확장·고급 탭 | 표시 preference와 새 대화 기본 접근 모드를 프로젝트 비공개 저장소에 영속 저장. 성공 ack 후 닫기; 실패 시 값 유지 |
| 모델·effort·접근 모드 | discovery → 명시적 allowlist → 실제 상태 재조회 | 변경 직렬화, busy/연결 종료 비활성화, 이전 세션 응답 무시 |
| 파일·URL·복사 | VS DTE / RAD ToolsAPI, HTTP(S) 외부 브라우저, native clipboard | clipboard ack 이후 성공 표시. 파일은 현재 IDE 프로젝트 경로와 존재 검사 |
| `@` | Core bounded workspace 목록 → 원본 autocomplete | ignore/secret/link 제외, 프로젝트 전환 캐시 초기화, 조회 실패에서 무한 요청 방지 |
| `+` 파일·이미지 | 양 IDE native picker → prompt attachment paths / ImageContent | PNG/JPEG/GIF/WebP sniff 검사. 이미지당 512 KiB, 이미지 8개, base64 합계 700,000 bytes. 일반 파일/폴더는 경로 참조 |
| `+` 폴더 | 양 IDE native directory picker → OMP `/add-dir` | native profile의 실제 추가 workspace root. PiAgent checkpoint 범위가 자동 확장되는 것은 아님 |
| MCP·플러그인 | 실제 목록, 서버 `/mcp` 변경, CLI plugin 변경 후 private session 재개 | UI optimistic toggle 제거. MCP 명령은 main turn 경로를 사용. plugin 관리와 MCP config 관리를 분리 |
| 빌드 | VS SolutionBuild / RAD ProjectBuilder | IDE main thread에서 호출하고 성공/실패 반환 |
| HTML 내보내기 | OMP private export → IDE 저장 대화상자 → 선택 경로 복사 | 임의 UI 출력 경로를 Core에 전달하지 않음 |
| `/` 명령 | 로컬 명령 우선 + runtime OMP discovery | 일반 native 명령 실행; plan/restricted 모드 경계 유지. private workspace/session을 바꾸는 명령은 명시적 오류 |
| 실행 중 메시지·retry | steer / follow_up / remove_queued_message / abort_retry | 첨부·선택 영역 큐는 거절하고 초안 유지. 같은 문장 같은 큐 중복 제한은 OMP의 text 기반 취소 계약 때문 |
| subagent 상세 | get_subagent_messages + fromByte cursor | 원본 sheet에 안전한 Markdown 내용과 다음 기록 버튼 |
| 세션 기록 | schema 1 읽기 호환, 저장 시 2 | user/assistant/status/event 분리, 시간·첨부 경로와 안전한 thinking/tool/todos/subagent/model/plan 이벤트 재생. 승인은 재생하지 않음 |
| 계획 카드·실행 | read-only 응답 → `docs/plans/piagent-UUID.md` → hash 검사 → always-ask로 같은 세션 재개 | plan mode 쓰기 예외는 전용 fresh 문서 생성뿐. 편집된 계획은 자동 실행 거절 |
| 사용량 전체 보고서 | 원본 usage 진입점 → 별도 sheet | unknown은 확인 불가. main과 보관된 BTW topic 통계를 분리; fork baseline 차감, 삭제된 topic까지 포함하는 전체 지출로 표기하지 않음 |
| 파일 변경 기록 | host edit 및 turn 시작/끝 native/designer disk 비교 → Git object checkpoint | dirty UTF-8 원본 bytes 보존, HEAD/index 불변, hash/revision/dirty IDE buffer 검사 후 승인 복원 |

원본 33종 action은 `ui/src/contracts.ts`에 명시했다. Controller route 누락과 임의 RPC 전달을 검사하는 테스트가 있다.
`restore` 메시지 action은 `chat.timeline.v1` preview/approve 경로로 연결한다. 원본 대화를 보존하고
선택한 메시지 이전의 실제 OMP JSONL과 표시 기록으로 새 대화를 만든다. 지원 파일은 승인 후 복원한다.
선택한 메시지는 초안으로 돌아오며 자동 제출하지 않는다. 파일-only `/restore`와는 별도 동작이다.

## 상태 및 저장 경계

- 일반 제출·BTW·큐 제출 ack는 ID별로 처리한다. 실패/세션 변경/연결 종료는 초안을 성공으로 처리하지 않는다.
- BTW notes와 follow-up 입력도 성공 ack 이전에 지우지 않는다.
- approval failure는 원래 카드로 돌아가며 yolo/write 모드에서도 자동 재승인 루프를 만들지 않는다.
- close/dispose는 prompt 준비, checkpoint/plan 저장, main/BTW child 종료를 기다린 뒤 lease를 해제한다.
- preference 쓰기는 프로젝트 저장소별로 직렬화한다. 인증/USB PIN/provider secret은 이 파일에 저장하지 않는다.
- BTW: 동시 실행 2개, topic 500개, topic당 32 turns, 300초 deadline, bounded streaming/pagination.
- transcript: 기존 200 entries/256 KiB 제한 유지. 전체 OMP JSONL과 표시용 기록은 별개다.
- RAD 프로젝트가 바뀐 상태의 prompt는 보내지 않고 새 workspace에 연결한다. 기존 초안은 보존하고 연결 완료 후 재전송한다.

## 검증 근거

- `npm test`: 전체 회귀 suite. 최종 결과는 `artifacts/chat-ui-implementation/tests.log`.
- C# 및 Delphi Win64 worker/transport: `tests/adapters.integration.mjs`. 새 preferences/files/export/BTW 서비스도 실제 인증 Named Pipe를 사용한다.
  VS2022/Win32 metadata smoke는 IDE 실사용 검증이 아니다.
- 실제 bundled HTML/ESM을 WebView2에서 실행하는 `PiAgent.WebView.Smoke --ui <ui folder>`:
  `/btw` 실패 초안 보존/성공 초기화, 접힌 카드, notes, 설정 5개 탭, `@`, CSP/JS 오류 검사,
  dock/tab/hide 12회 뒤 브라우저와 한글 초안 보존. `artifacts/chat-ui-implementation/webview.log`.
- 실제 OMP 18.5.0 및 별도 18.6.0 executable: command/model discovery, private JSONL 생성, HTML export,
  공백 경로 `/add-dir`, model BTW `2+2 → 4`, 재개 follow-up `→ 8`, 메인 파일 byte 불변.
  `scripts/verify-omp-chat-ui.mjs <absolute omp.exe> --model-test`로 재현한다.
  isolated temp 프로젝트에서 tool/skill/extension/rule/LSP를 끈 검증이다. 실제 IDE 프로젝트를 변경하지 않는다.
- VSIX 0.9.6와 RAD Win64 BPL 빌드. 설치된 signed VSIX 0.9.5/기존 setup 파일은 교체하지 않았다.

## 아직 완료로 판정하지 않은 범위

1. **메시지 시점 파일+대화 복원/분기**: 구현 및 VS2026/RAD64 실제 대화 검증 완료.
   VS 파일 byte 복원·dirty editor 차단과 RAD FMX 속성 변경 후 byte 복원을 확인했다.
   실제 IDE 추가 검증과 RAD 디자이너 갱신 수정 결과는 아래 최신 acceptance 문서를 따른다.
2. **native/designer checkpoint 전체 범위**: 현재 Git 추적 기존 UTF-8 텍스트만 관찰한다.
   시작 snapshot 최대 500개/8 MiB, 파일당 32 KiB; 종료 변경 최대 8개/256 KiB.
   생성/삭제/바이너리/미추적/non-Git/추가 workspace root/미저장 IDE buffer는 자동 복원 대상이 아니다.
3. **전체 원본 role/provider/advanced 설정 편집**: 표시 preference는 구현했다. 계정 인증은 사람이 OMP `/login`으로 수행하고,
   모델 role preset은 실제 OMP `/modelpreset` flow를 사용한다. 임의 provider credential 편집 UI는 구현하지 않았다.
4. **모든 OMP extension UI**: select/confirm/input/editor와 notify/status/title/widget/open URL을 연결한다.
   알 수 없는 reply-required interaction은 취소+안내한다. 모든 third-party/custom rich dialog 지원을 의미하지 않는다.
5. **큐 메시지 전체 rich history**와 live event의 모든 OMP 변형은 후속 보강 대상이다. RAD 선택 capture는 ToolsAPI의 TopView.Block snapshot을 사용하며 실제 IDE acceptance가 남아 있다.
6. **실제 설치 IDE 전수 acceptance**: 현재 harness와 pipe 테스트는 VS2026/RAD13.2 설치 UI 전체 실사용 검증을 대체하지 않는다.
   설치/재시작/로드 hash 검사, 실재 MCP/plugin toggle, dirty editor/디자이너 문서 링크·복원 등의 매트릭스는 남아 있다.
7. **서명 배포**: USB는 존재하지만 이 작업 시점에 DPAPI PIN 등록 파일이 없었다.
   `scripts/set-signing-pin.ps1`에서 사용자가 로컬로 한 번 등록한 뒤 기본 서명 build를 실행해야 한다.
   대화에 PIN을 입력하거나 인증 UI를 자동 조작하지 않는다. 이번 build는 검증용 unsigned이며 기존 signed dist를 덮어쓰지 않는다.

문서에 남은 항목을 유지하고 전체 채팅 UI 완료 또는 설치본 검증 완료로 보고하지 않는다.

## 최신 설치 검증

위 0.9.6/미설치 기록은 당시 검증 결과이다. 현재 검증용 unsigned VSIX는 0.9.8이며 RAD Win64 BPL과
Node ARM64 Core를 versioned release로 설치했다. 서명된 설치파일은 만들지 않았다.
최신 상태와 항목별 실사용/자동화 검증 구분은 [메시지·설치 검증](MESSAGE-TIMELINE-AND-INSTALLED-ACCEPTANCE.md)을 따른다.
