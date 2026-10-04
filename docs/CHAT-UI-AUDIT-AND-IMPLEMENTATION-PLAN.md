# PiAgent 채팅 UI 기능 감사 및 구현 계획

작성일: 2026-10-04 · 기준 커밋: `a90806c` · 구현 담당 인계 대상: GPT-6.1 sol

## 1. 결론과 작업 범위

현재 채팅창은 RADAgent의 화면과 renderer를 가져왔지만, 기능을 실행하는 Controller·adapter·Core 연결은 일부만 구현되어 있다. **RADAgent UI/UX와 기능이 모두 이식된 상태가 아니다.** 이번 `/btw`, BTW 버튼, 설정 문제는 설치본이 오래되어서만 발생하는 문제가 아니라 현재 코드에도 존재하는 구현 누락이다.

이번 작업은 조사와 계획 작성이다. 제품 소스, 설치본, OMP 설정은 변경하지 않았다. 아래의 신규 파일명·RPC·capability는 **구현 제안**이며, 이미 구현된 API를 뜻하지 않는다. 기존 RADAgent 저장소는 계속 읽기 전용 reference로 사용한다.

구현 원칙:

- 기존 RADAgent의 레이아웃·메뉴·상호작용을 기준으로 기능을 복원한다. 기능을 버튼으로 새로 나열하는 UI 개편은 하지 않는다.
- Node.js/TypeScript strict ESM Core는 IDE-neutral을 유지한다. SDK, 파일 선택기, IDE 문서 열기·빌드는 C#/Delphi adapter가 담당한다.
- 실행 가능한 기능만 capability로 광고한다. 영구 비활성화나 무응답으로 덮어 놓고 완료로 처리하지 않는다.
- UI 이벤트 → Controller → adapter → Named Pipe → Core → OMP → 응답/이벤트 → 화면까지 확인한다. 메서드 이름이 allowlist에 있다는 사실만으로 구현 완료라고 판단하지 않는다.
- Windows ARM64 PC에서 VS2026, RAD Studio 13.2 **64-bit IDE**를 우선 검증한다. VS2022는 최종 완료 직전에 검증한다. 이번 범위에 RAD 32-bit 실사용 검증은 추가하지 않는다.

## 2. 조사 증거와 한계

### 2.1 실행 중인 설치본

| 항목 | 이번 확인 결과 |
| --- | --- |
| 실행 IDE | Visual Studio 2026, `NanumPDF` 솔루션 열림 |
| 설치 VSIX | `0.9.5`, VS 인스턴스 `18.0_4dee894c` |
| 설치 Core release | `0.9.0-20261004131345` |
| 설치 UI 비교 | `controller.js`, `bridge.js`, `composer.js`, `btw.js`, `panels.js`, `topbar.js`, `clicks.js` 7개 SHA-256이 로컬 산출물/소스와 일치 |
| BTW 버튼 | 실행 중인 WebView 접근성 트리에서 disabled 확인 |
| 내보내기 버튼 | 실행 중인 WebView 접근성 트리에서 disabled 확인 |
| 설정 버튼 | 클릭 시 실제로 “연결 다시 시도”, “파일 변경 기록” 두 항목만 표시. 연결 중인 상태라 재연결 항목은 disabled |
| 프로젝트 표시 | `NanumPDF`, `file:///C:/Users/kimmi/source/repos/NanumPDF` 표시 확인 |
| 실제 OMP | 설정의 경로와 실행 프로세스 모두 `%LOCALAPPDATA%/omp/omp.exe`; 해당 바이너리의 `--version` 결과 **18.5.0** |
| OMP 문서와 차이 | 기존 `docs/OMP-DESIGNERS.md`의 검증 기준은 18.6.0. 설치된 현재 바이너리를 18.6.0 또는 최신이라고 가정하면 안 됨 |
| NanumPDF Git 상태 | `git rev-parse --is-inside-work-tree` 실패: 현재 Git 저장소가 아님 |

설정 패널 확인 후 닫았으며, 사용자가 입력해 둔 `/btw` 초안은 전송하거나 바꾸지 않았다. RAD Studio는 실행되어 있지 않아 이번에는 adapter 소스만 조사했다. 모든 버튼을 실제 IDE에서 눌러 완료한 것으로 해석하면 안 된다.

### 2.2 자동 재현 및 기존 테스트

- renderer JS의 정적 `t` 이벤트와 HTML `data-action`을 추출하면 **33종**이다. 이 중 **13종**은 `Controller.action()` case가 없다. 이 수는 클릭 가능한 버튼 수나 전체 OMP 기능 수가 아니다.
- 실제 `composer.js`를 Node VM의 최소 DOM 대역과 실제 `ui/dist/controller.js`에 연결해 `/btw audit`를 전송했다. 결과: host 요청 0개, `submitted` 응답 0개, “현재 연결에서 지원하지 않는 기능입니다.” notice 1개, 초안 유지. 브라우저 E2E가 아닌 renderer/Controller 경로 재현이다.
- `yolo` 모드 승인 요청 후 `operationError`를 주입하면 `decideChange` 전송 수가 1회에서 2회로 늘어난다. 오류가 자동 재승인을 유발하는 경로를 확인했다. 실제 파일 변경을 실행하지 않은 Controller 재현이다.
- `node --test tests/ui.test.mjs tests/omp-designer.test.mjs`: **16/16 통과**.
- `node --test --test-concurrency=1 tests/chat.test.mjs tests/sessions.test.mjs tests/workspace-binding.test.mjs`: **11/11 통과**.
- 합계 **27개 기존 테스트가 통과해도 아래 기능 누락은 존재**한다. UI 테스트는 주로 Controller의 일부 경로와 renderer 파일 존재/해시를 확인하며 전체 이벤트 연결을 검사하지 않는다.
- 실제 OMP 18.5.0을 별도 임시 cwd, `--no-session --no-tools --no-extensions --no-skills --no-rules --no-lsp --no-title --no-pty`로 실행하여 `get_state`, `get_available_commands`만 조회했다. 모델 프롬프트는 보내지 않았다. RPC v1/v2 지원과 47개 명령 이름을 확인했다. `btw`는 이 조회 결과에 없고, RADAgent에서는 별도 child/session으로 제공하는 host 기능이다.
- 로컬 조사 산출물: `artifacts/chat-ui-audit/action-audit.json`, `artifacts/chat-ui-audit/omp-probe.json`. `artifacts`는 Git 제외 영역이므로 핵심 증거는 이 문서에 함께 기록했다.

## 3. 기능별 연결 현황

표의 “경로 있음”은 코드 연결 또는 지정된 테스트가 있다는 뜻이다. 이번 조사에서 해당 기능의 모든 IDE 실사용 조합을 검증했다는 뜻은 아니다.

| UI 이벤트/기능 | 현재 상태 | 근거·남은 문제 |
| --- | --- | --- |
| `ready` | 경로 있음 | bridge → adapter ready/connect. 초기 renderer의 `btwList`는 연결 처리 없음 |
| `submit` 일반 채팅 | 경로 있음 | prompt/stream/완료·오류 테스트 있음. busy queue와 이미지 payload는 미구현 |
| `abort` | 경로 있음 | turn ID 기준 취소, Core 테스트 있음. BTW·retry 취소와 별개 |
| `newSession` | 경로 있음 | chat.close/open. 초안·첨부·모델·프로젝트 전환 경계 테스트 보강 필요 |
| `sessions` | 부분 구현 | 목록/재개 있음. 전체 rich history 재현은 안 됨 |
| `settings` | 실질 미구현 | 실제 설정 페이지 없이 재연결/변경 기록 메뉴만 있음 |
| `btw` | **누락** | composer가 전용 이벤트로 가로채므로 OMP prompt로도 전달되지 않음 |
| `btwList` | **누락** | 초기 wire/패널 열기 시 보내지만 Controller/백엔드 없음 |
| `btwStop` | **누락** | BTW child/process 관리 없음 |
| `btwDelete` | **누락** | BTW 저장소/삭제 RPC 없음 |
| `export` | **누락** | 버튼 상시 disabled, Controller 없음. OmpProcess의 export_html allowlist만 존재 |
| `setModel` | 부분 구현 | 실제 discovery/set/get 경로 있음. busy/disconnect disabled 상태가 bridge에서 덮임 |
| `setThinking` | 부분 구현 | 같은 문제. 실패 시 선택값 복원/요청 직렬화 보강 필요 |
| `setApproval` | 경로 있음 | 세션 보존·모드 재시작 테스트 있음. 오류 복구와 모드 설명/보장 범위는 별도 문제 |
| `approval` | 경로 있음 | 파일/디자이너 제안의 승인·거절 있음. 자동 승인 모드 오류 재전송 문제 존재 |
| `attachFiles` | VS 부분, RAD 누락 | VS는 선택 경로를 전송. 사진의 실제 이미지 payload 전송은 없음 |
| `addFolder` | VS 부분, RAD 누락 | VS는 폴더 경로 첨부. RADAgent의 workspace folder 추가와 동일 의미가 아님 |
| `listExtensions` | VS 경로 있음, RAD 누락 | Core의 CLI/config 기반 목록 있음. 실제 설치 항목이 있는 환경의 E2E 미검증 |
| `toggleMcpServer` | VS 부분, RAD 누락 | OMP `/mcp` prompt 기반 변경. 성공 완료·목록 동기화·실패 rollback 확인 필요 |
| `togglePlugin` | VS 부분, RAD 누락 | CLI 변경 후 OMP 재시작. UI optimistic toggle 실패 복원 없음 |
| `manageExtensions` | VS 의미 불일치, RAD 누락 | MCP/플러그인 “관리”가 모두 프로젝트 MCP JSON 파일 열기로 연결됨 |
| `compile` | VS 부분, RAD 누락 | VS SolutionBuild 호출. 결과/오류의 채팅 반환 없음 |
| `listFiles` (`@`) | **누락** | composer가 요청하지만 응답 공급자가 없어 파일 자동완성 안 됨 |
| `openFile` | **누락** | 텍스트/도구 결과/계획 문서 링크를 클릭해도 IDE 열기 경로 없음 |
| `openUrl` | **누락** | 링크는 preventDefault하고 host 이벤트만 전송; adapter 처리 없음 |
| `copy` | 부분 구현 | Controller는 no-op. 코드 블록은 browser clipboard 시도, BTW 복사는 host만 호출하므로 동작 안 함 |
| `runCommand` | 부분 구현 | 로컬 5개 명령만 처리. 일반 submit의 native slash 처리와 경로 다름 |
| `usage` | 부분 구현 | 통계 조회/팝업 있음. “전체 보고서” 링크는 닫힌 팝업의 캐시만 갱신 |
| `cancelQueued` | **누락** | Controller 없음. Core control allowlist만 일부 존재 |
| `abortRetry` | **누락** | retry 카드 버튼은 존재하나 Controller 없음 |
| `subagentLog` | **누락** | 진행 행을 눌러도 상세 로그 요청 없음 |
| `proceedPlan` | **누락** | 계획 카드 renderer만 있고 실행 처리·생성 이벤트 경로 없음 |
| `restore` | **누락** | RADAgent의 메시지별 복원/분기 계약. 현재 `changes.restore`와 별개이며 연결 안 됨 |

추가 표시 기능도 완전하지 않다. thinking/tool 기본 projection은 있지만 `toolInputDelta`, `todos`, `display`, `checkpoint`, `plan` 등 renderer가 받는 모든 이벤트를 현재 `omp-events.ts`가 공급하지 않는다. 턴 소요시간 renderer는 started/ended를 요구하지만 Controller는 빈 `turnEnd`를 보낸다. 이러한 누락을 “UI 파일이 있으므로 지원”으로 판정하지 않는다.

## 4. 문제 목록과 원인

우선순위: **P0** = 데이터 변경·오류 상태의 통제 문제, **P1** = 핵심 사용 기능의 누락/오작동, **P2** = 표시·일관성·진단 품질.

### F01 · P1 · BTW 전체 실행 경로 누락 — 확정

- `ui/src/bridge.ts:22`: BTW와 export를 매 status 갱신마다 무조건 disabled 처리.
- `ui/src/composer.js:59`: `/btw`를 파싱하고 `submit` 대신 `btw`를 보냄.
- `ui/src/controller.ts:46`: `btw`, `btwList`, `btwStop`, `btwDelete` case 없음. Core/adapter에도 전용 서비스 없음.
- `submitted {id,ok}`가 돌아오지 않으므로 composer pending도 정상 정리되지 않는다. 버튼만 활성화하거나 `/btw`를 메인 prompt로 보내는 수정은 원래 UX 복원이 아니다.
- reference: `RADAgent.ChatBtw.pas`, `RADAgent.BtwRunner.pas`, `RADAgent.BtwStore.pas`, `RADAgent.ChatPageCommands.pas`. 메인 대화와 분리된 OMP child, 도구 없는 질문, follow-up 재개, 프로젝트별 영속 메모가 원래 동작이다.

### F02 · P1 · 설정창이 임시 메뉴로 대체됨 — 설치본에서 확인

- `ui/src/controller.ts:91`: settings → 2개 메뉴만 표시.
- 표시/언어/글꼴/알림, 계정·모델, 모델 역할, MCP/플러그인, 고급 설정의 실제 조회·저장·적용 경로가 없다.
- reference: `RADAgent.SettingsDialog.pas:111`의 Display / Account / Roles / Extensions / Advanced 탭, `RADAgent.SettingsAccount.pas`, `RADAgent.SettingsProject.pas`, `RADAgent.AgentSettings.pas`.
- 기존 설정 UX를 공통 UI에 복원하되, clangd 등 RAD 전용 항목은 adapter capability가 있을 때만 제공한다.

### F03 · P1 · 링크·복사·@파일·내보내기 누락 — 소스/Controller 대조

- `ui/src/clicks.js`, `tools.js`, `approval.js`: openFile/openUrl을 보내지만 Controller/adapter 수신 case 없음.
- `composer.js:129`: 최초 `@` 입력에 listFiles 요청 후 빈 배열만 유지. 재조회/프로젝트 전환 시 캐시 무효화도 필요.
- `controller.ts:97`의 copy no-op은 “모든 renderer가 clipboard를 처리한다”는 잘못된 전제다. `btw.js:81`은 host copy만 요청한다.
- browser clipboard 실패는 무시하면서 “복사됨”을 표시하므로 성공 표시도 신뢰할 수 없다.
- export_html은 `packages/piagent-omp/src/index.ts:120` allowlist에 있지만 `omp-controls.ts`/UI/adapter를 통과하는 export 기능은 없다.

### F04 · P1 · slash catalog와 실행 의미 불일치 — 실제 OMP 조회 포함

- `bridge.ts:32`: 자동완성은 new/sessions/usage/restore/selection 5개로 고정.
- `omp-controls.ts`는 get_available_commands를 허용하지만 Controller는 호출하거나 응답을 catalog로 변환하지 않는다.
- 현재 OMP에서 조회한 명령은 47개이며 model, fast, effort, todo, compact, mcp, plugins 등이 포함된다. 자동완성과 실제 지원 목록이 다르다.
- native profile의 일반 submit은 일부 slash를 OMP에 전달하지만 `runCommand`는 5개 switch만 사용한다. plan/restricted에서는 slash 처리 정책이 또 다르다.
- OMP 명령을 UI의 일반 턴과 동일하게 취급하면 session/model/queue 전환과 UI 상태가 어긋날 수 있다. 명령별 ownership과 완료 이벤트를 분류해야 한다.

### F05 · P1 · 실행 중 지시·예약, retry 취소, subagent 상세 누락 — 소스 확정

- `controller.ts:38`: queueEnabled가 항상 false. `submit.followUp`도 Core로 전달하지 않음.
- cancelQueued/abortRetry/subagentLog는 미수신. Core에는 remove_queued_message/abort_retry/get_subagent_messages 등의 일부 control이 있어 UI 연결 작업과 누락된 broker 작업을 구분해야 한다.
- OmpProcess allowlist에 steer/follow_up가 있다는 사실만으로 상위 계층에서 호출 가능하지 않다.
- 현재 renderer는 queue의 메시지 본문으로 대상을 식별한다. 중복 텍스트·context prefix·첨부가 있을 때의 상관관계 규칙도 필요하다.

### F06 · P0 · 오류를 받으면 자동 재승인하는 경로 — 자동 재현 확정

- `controller.ts:172`: operationError가 오면 기존 review를 해제하고 showReview로 다시 만든다.
- `controller.ts:114`: yolo 또는 해당 턴이 승인된 write 모드는 showReview에서 즉시 approval을 재전송한다.
- stale revision 등 해결되지 않은 오류를 반복 수신하면 반복 재시도 가능성이 있다. 확인된 사실은 오류 1회 주입 시 승인 요청 1회가 추가 전송된다는 것이다.
- operationError에 action/request 상관관계도 없어 다른 작업 오류가 승인/제출 상태에 영향을 줄 수 있다. 실패한 변경의 자동 재전송을 멈추고 사용자가 새 diff를 검토할 수 있어야 한다.

### F07 · P1 · busy/disconnect 상태와 UI 활성화 충돌 — 소스 확정

- `composer.js:273`는 busy/disconnected일 때 thinking을 끄지만, 직후 `bridge.ts:24`가 ompControlsEnabled만 보고 다시 켤 수 있다. 모델 버튼에도 두 계층이 활성 상태를 쓴다.
- Controller는 idle이 아니면 요청을 조용히 무시한다. 화면에서는 클릭/선택이 가능하지만 반영되지 않는 상태가 생긴다.
- 모델/effort 변경의 pending 상태와 실패 후 원래 선택값 복원 규칙도 부족하다.

### F08 · P1 · RAD adapter가 VS 기능을 따라오지 못함 — 소스 확정, 실사용 미검증

- `PiAgent.ChatWorker.pas:65`: chat.open에 현재 RAD 프로젝트 workspaceUri를 넣지 않는다. Hello에도 workspace.bind.v1 요청이 없다. 기본 Core workspace로 연결될 수 있다.
- selectionEnabled=false이며 attachmentsEnabled가 없다. 따라서 공유 bridge는 RAD의 `+` 전체를 비활성화한다.
- attachFiles/addFolder/listExtensions/manageExtensions/togglePlugin/toggleMcpServer/compile handler가 없다.
- `ChatWorker.pas:151`은 prompt의 message만 보내고 attachments를 넘기지 않는다.
- 단순히 capability를 true로 바꾸면 오히려 “UI action unavailable”만 늘어난다. UI thread의 ToolsAPI/file dialog 처리와 worker의 protocol 전달을 함께 구현해야 한다.

### F09 · P1 · 첨부·폴더·확장 관리 기능의 의미 및 실패 처리 부족 — 소스 확정

- VS 파일 선택 결과는 이름/경로뿐이고 Core는 prompt에 경로 목록을 붙인다. “사진 추가”를 실제 이미지 입력 지원으로 볼 수 없다.
- addFolder는 폴더 경로 첨부이며 RADAgent의 AddWorkspaceFolder와 의미가 다르다. reference 동작과 OMP의 add-dir/작업영역 범위를 확인해 구분한다.
- MCP 관리와 플러그인 관리가 동일한 manageExtensions 이벤트라서 둘 다 `.omp/mcp.json`만 연다. 어떤 목록에서 눌렀는지 구별하지 못한다.
- `plusmenu.js:45`는 즉시 스위치 상태를 바꾸지만 실패 시 되돌리는 응답 계약이 없다.
- `extensions.ts`는 provider CLI와 몇 개 config 위치를 해석한다. 현재/지원 OMP의 plugin list JSON 형태, 설정 우선순위, user/project provenance를 실제 설치 항목으로 검증해야 한다.
- compile은 VS 빌드를 시작하지만 성공/실패/취소/진단 정보를 채팅에 반환하지 않는다.

### F10 · P1 · 계획/체크포인트 UX와 실제 보장 범위 불일치 — 소스 및 프로젝트 상태 확인

- plan 카드와 proceedPlan handler, 메시지별 checkpoint 이벤트/restore handler가 연결되어 있지 않다.
- 현재 plan 모드는 read-only prompt와 tool 제한이며, tooltip의 “docs\\plans에 계획서 작성 후 실행” workflow는 구현되어 있지 않다.
- 현재 `changes.*`는 host proposal에 대한 파일 복원이다. RADAgent의 “해당 사용자 메시지 이전 파일+대화로 복원/분기”와 다르다.
- native OMP write/실행과 IDE designer write 전체가 현재 Git checkpoint에 포착되는 것은 아니다. `docs/OMP-DESIGNERS.md`에도 이 한계가 기록되어 있다.
- NanumPDF는 Git 저장소가 아닌데 native session의 writeEnabled는 true가 될 수 있다. settings의 변경 기록 메뉴는 writeEnabled로 활성화되지만 Core의 changes.list는 changes service가 없으면 거절한다. **write capability와 checkpoint/restore capability를 분리해야 한다.**
- Git worktree의 `.git` 파일, monorepo 하위 솔루션도 현재 standalone-root 제약과 충돌할 수 있으므로 별도 fixture가 필요하다.

### F11 · P1/P2 · 세션 재개·사용량·rich event 표시가 부분 구현 — 소스 확정

- `sessions.ts:10` transcript는 user/assistant/status + text만 저장한다. 시간, tool/thinking, 첨부, 모델 구간, checkpoint, BTW 연결 메타데이터는 보존하지 않는다.
- `chat.js:handleHistory`는 user 이외 text를 assistant bubble로 렌더링하므로 status `completed`도 모델 답변처럼 나타날 수 있다.
- `controller.ts`는 데이터 없는 turnEnd를 보내므로 `turntime.js`의 시간 표시 조건을 충족하지 않는다.
- `panels.js:95`의 사용량 전체 보고서는 팝업을 닫고 runCommand('/usage')를 호출한다. Controller는 통계를 다시 읽을 뿐 보고서를 열지 않는다.
- omp-events.ts는 thinking/tool/queue/retry 시작/compaction 시작/subagent 일부만 projection한다. todo, 상세 tool input, retry/compaction 종료, 모델 변경, 시간·중단·goal 등의 지원 계약을 확인하고 빠진 공급자를 채워야 한다.
- `interactions.ts`/Controller는 select/confirm/input/editor/cancel, 일부 notify/status/editor-text만 처리한다. auth/open_url 및 rich UI 요청은 전체 지원이 아니다. 응답을 필요로 하는 요청을 조용히 무시해서 OMP가 대기하도록 두면 안 된다.

### F12 · P2 · 표시 설정·진단·문서가 실행 상태를 설명하지 못함

- bridge는 navigator.language만 사용하고 host theme/display preferences를 보내지 않는다. 원래 renderer가 있더라도 표시 설정 경로는 없다.
- 기본 notice/operationError만으로 어느 UI action, adapter method, OMP 요청이 실패했는지 파악하기 어렵다.
- `PROTOCOL.md`에는 현재 v2 negotiation 코드와 달리 v1 skeleton만 쓴다는 과거 설명이 남아 있다. 문서·설치 버전·지원 기능을 같은 기준으로 정리해야 한다.
- “원본 renderer 바이트 유지” 테스트는 기능을 보장하지 않으며 필요한 버그 수정을 막을 수도 있다. UX 보존 검사와 원본 provenance 검사를 분리해야 한다.

## 5. 구현 설계

### 5.1 먼저 공통 action/result/capability 계약을 만든다

새 `ui/src/contracts.ts` 또는 동등한 위치에 33개 이벤트와 bridge 내부 connect/captureSelection 등을 명시적 discriminated union으로 정의한다. 아래 세 종류를 구분한다.

1. UI 내부 동작: 패널 열기/닫기, 필터, 초안 등.
2. IDE 동작: 파일·URL·clipboard, 선택기, 선택 영역, 빌드, 디자이너.
3. Core/OMP 동작: BTW, 세션, 명령, 설정, 사용량, 큐, subagent, 승인·복원.

모든 비동기 action은 request ID와 성공/실패/취소를 갖는다. 제출 초안은 승인된 요청만 지우고 모든 실패는 pending을 정리한다. stale session/workspace 응답을 폐기한다. transport와 OMP 요청 ID를 로그에 연계하되 PIN·토큰·원문 대화·전체 경로/설정 내용을 무차별 기록하지 않는다.

capability는 기능별 지원 여부와 unavailable 이유를 포함한다. connected/busy/pending/profile/workspace 조건을 하나의 계산 경로로 반영한다. 예: BTW는 메인 턴 busy여도 사용 가능, 모델 변경은 busy일 때 불가, 설정 조회는 disconnected여도 가능한 항목이 있음. 기존 광범위한 attachmentsEnabled/writeEnabled 하나로 모든 메뉴를 켜지 않는다.

새 RPC를 추가할 때 반드시 함께 수정할 곳:

- `packages/piagent-protocol/src/*`: capability와 계약.
- `packages/piagent-core/src/index.ts`: dispatch/협상/validation.
- Core의 해당 service + `packages/piagent-omp/src/index.ts`의 필요한 명령만.
- `adapters/visualstudio/PiAgent.Transport/PipeAdapterClient.cs`의 요청 allowlist/deadline.
- `adapters/radstudio/src/PiAgent.PipeClient.pas`의 동일 항목.
- C# `ChatControl.cs`, Delphi `ChatForm.pas`/`ChatWorker.pas`, Controller의 action과 response.

새 API 이름을 단순 wildcard 전달로 열지 않는다. 이전 adapter가 새 capability를 협상하지 않았을 때의 동작도 테스트한다.

### 5.2 BTW는 Core의 별도 서비스로 복원한다

제안 파일: `packages/piagent-core/src/btw.ts`, `btw-store.ts`.

- 제안 capability/RPC: `chat.btw.v1`; `btw.ask`, `btw.list`, `btw.cancel`, `btw.delete`. 이름·세부 필드는 protocol 문서에 확정 후 사용한다.
- main savedSession ID와 workspace에 귀속된 topic ID를 사용한다. runtime session ID가 바뀌어도 “이 대화만” 필터가 유지되어야 한다.
- reference처럼 별도 `omp --mode rpc-ui` child를 사용한다. 메인 대화 컨텍스트의 일관된 snapshot을 받아 fork하고 메인 transcript에 BTW 질문/답변을 넣지 않는다. 실행 중 JSONL의 부분 기록을 그대로 복사하는 race를 피한다.
- child는 도구/host tools/extensions/skills/LSP를 사용할 수 없게 시작한다. main의 모델·effort를 명시적으로 반영한다. follow-up은 topic의 private session을 재개한다.
- topic 저장 완료와 요청 수락 후 `submitted {id,ok:true}`를 보낸다. 실패/취소에는 대응하는 응답을 보내고 초안을 보존한다.
- topic별 단일 turn, 전체 child 수/동시성/입력·출력/timeout 한도를 둔다. BTW 취소가 메인 turn을 중지해서는 안 된다.
- 전송 이벤트는 기존 `btw.js`의 `btw {topic,turn}` / `btwList {session,items}` 계약에 맞춘다. 검색·필터·follow-up·복사·삭제·재시작 후 재개를 모두 연결한다.
- 사용량에서 BTW 비용을 누락하거나 메인 비용에 중복 합산하지 않는다. 메인/BTW/전체의 귀속 기준을 정한다.

### 5.3 설정은 원본의 정보 구조를 복원한다

제안: 공통 WebView settings 화면/모듈과 Core의 settings service. 기존 ⚙ 진입점을 사용하며 별도의 기능 버튼 dashboard를 만들지 않는다.

| 설정 영역 | 구현 범위 | 적용 방식 |
| --- | --- | --- |
| 표시 | 진행 표시, thinking/tools/todos/subagents/retry/notice, 언어, 글꼴, 대비, 완료 알림 | 공통 UI preference, 즉시 미리보기, 취소 시 복원, 재시작 후 유지 |
| 계정·모델 | provider 로그인 상태, 모델, effort, 로그인 진입/취소/완료 | OMP 상태 조회 및 지원된 auth flow. 비밀 값을 WebView/로그에 반환하지 않음. 실제 인증 입력은 사용자가 수행 |
| 모델 역할 | RADAgent roles/defaults와 현재 OMP의 역할별 설정 대응 | 지원 필드만 schema 검증, user/project override 표시 |
| MCP/플러그인 | 조회, 항목 관리, on/off, 상태·오류, config 위치/범위 구분 | runtime API/CLI 검증 후 사용, 실패 rollback, 필요 시 안전한 OMP 재시작 |
| 고급·연결 | OMP 경로/버전, 지원 설정, 연결 진단, 재연결, adapter별 추가 도구 | global/project/IDE 설정 범위 구분. 실행 중 적용 가능한 값과 재시작 필요한 값 표시 |

조회·저장·적용·취소를 구분한다. 빠른 연속 변경은 직렬화하고, 저장 실패/재시작 실패 시 성공한 것으로 표시하지 않는다. session/workspace/approval 상태 보존을 acceptance에 포함한다. 단순히 JSON 파일을 여는 것을 모든 설정 UI의 완료로 간주하지 않는다.

### 5.4 나머지 기능 연결

- **파일/URL/복사:** 요청된 파일·행을 해당 IDE 문서 API로 연다. URL은 허용된 scheme만 처리한다. clipboard 성공 후에만 성공 표시, browser 실패 시 adapter fallback. transcript 문자열 자체를 host 명령으로 실행하지 않는다.
- **@파일:** 현재 workspace의 bounded 목록/검색, ignore 규칙, 상대 경로, 프로젝트 변경 시 캐시 무효화, 결과 없음/실패 상태.
- **첨부:** 텍스트/폴더 참조와 이미지 payload를 구분한다. 현재 OMP가 받는 이미지 스키마·용량을 검증하고 타입·크기 제한을 적용한다. 이미지 기능을 구현하지 않은 상태에서는 사진을 지원한다고 표기하지 않는다.
- **폴더:** 일회성 참조인지 추가 workspace root인지 계약을 명확히 한다. RADAgent reference와 대응하고 permission/읽기 범위는 별도 관리한다.
- **내보내기:** adapter 저장 대화상자 → 검증된 Core/OMP export → 실제 HTML 내용·한글·링크 검증. 경로는 임의 WebView 입력으로 받지 않고 사용자 선택 결과를 사용한다.
- **명령:** host 명령과 OMP 명령을 합쳐 catalog를 생성한다. 충돌 우선순위, aliases, busy 지원, UI interaction 필요 여부, plan/restricted 정책을 기록한다. OMP 버전별로 discovery하고 알려지지 않은 응답은 진단 가능한 오류로 처리한다.
- **큐/retry/subagent:** steer/follow_up/취소/상세 cursor API를 UI부터 왕복 연결한다. 동일 문장 2개, chunked 로그, 이미 완료된 작업, session 전환 중 응답의 처리를 검증한다.
- **usage:** 팝업과 전체 보고서를 분리한다. unknown을 0으로 바꾸지 않고 조회 실패·캐시 시각을 표시한다. 진행 중/완료 후/모델 변경/BTW 사용량 정책을 일관되게 한다.
- **rich event/history:** text 외 표시 이벤트의 소유 ID, 순서, 시간, 재생 schema를 정의한다. 중복 tool 카드, 다른 turn의 완료, 로그 truncation, 취소 이후 늦은 이벤트를 테스트한다. 기존 session schema에는 migration을 둔다.
- **계획:** read-only 검토 → 실제 계획 문서 저장 → 계획 카드 → 명시적 실행/수정이라는 흐름을 구현한다. read-only mode에서 계획서 저장을 허용하는 예외가 필요하다면 허용 위치와 전용 승인 경로를 계약으로 정한다. 일반 쓰기 권한을 몰래 열지 않는다.
- **복원:** 파일만 복원하는 현행 API와 메시지 시점으로 파일+대화 복원/분기를 구분한다. Git/non-Git/worktree/dirty buffer, native OMP 변경, designer 변경의 포착 범위를 먼저 설계한다. 안전 snapshot과 미저장 문서 보호 없이 reference의 git 명령을 그대로 복사하지 않는다.

## 6. 구현 순서와 완료 기준

각 단계는 구현·자동 검증·해당 UX 확인 후 다음 단계로 넘어간다. 최종 설치 검증 전까지 “채팅창 전체 기능 완료”라고 보고하지 않는다.

| 단계 | 작업·주요 파일 | 선행 | 단계 완료 기준 |
| --- | --- | --- | --- |
| 0. 계약/회귀 기준 고정 | action inventory, capability/result schema, ui/tests, PROTOCOL | 없음 | 33종 전부가 구현/미지원 사유/계획에 대응. 누락을 실제로 잡는 red test, 실제 composer/bridge DOM test 기반 준비 |
| 1. 오류·상태 통제 | Controller, bridge, interactions, adapter errors | 0 | F06 자동 재승인 제거, 모든 pending 종료, stale reply 무시, busy/disconnect 이중 활성화 제거 |
| 2. 기본 클릭 동작 | openFile/openUrl/copy/listFiles/export, C#/Delphi SDK handler | 1 | 링크·@·복사·내보내기가 양쪽 adapter에서 왕복. 실패/취소도 명시적 결과 |
| 3. BTW 완성 | BTW Core/store/OMP child, Controller, 양 adapter | 1 | idle/busy 중 질문, follow-up, cancel, list/search/filter, copy/delete, 재시작 후 재개. 메인 세션 불변 확인 |
| 4. 실제 설정창 | shared settings UI/service, 계정·모델·roles·표시·확장·고급 | 1 | 조회/적용/취소/영속 저장/재시작, 원본 UX 대응. 로그인은 실제 지원 flow와 사람의 인증 완료로 검증 |
| 5. OMP 명령/실행 중 제어 | command catalog, steer/follow-up/retry/subagent broker | 1, 4 | 실제 OMP discovery와 UI가 일치. busy command/queue 취소/로그/에러가 E2E로 작동 |
| 6. IDE별 첨부·프로젝트·확장·빌드 | RAD workspace binding/SDK handlers, VS picker, extension service | 1, 4 | VS/RAD 프로젝트 전환, 이미지/파일/폴더 계약, MCP/플러그인 실제 항목 on/off 및 실패 rollback, build 결과 |
| 7. 기록·계획·복원·사용량 | session schema, event projection, plan/timeline/checkpoint, usage | 3, 5, 6 | history에서 상태가 답변으로 섞이지 않음. 시간/첨부/모델/도구 재현. 계획 실행 및 각 변경 경로의 복원 범위 입증 |
| 8. 설치본 종합 검증 | signed build/package/installer, 실제 IDE 테스트 | 2–7 | VS2026 + RAD13.2 x64 전수 수동/자동 매트릭스 통과, 설치 파일/로드 파일 해시 확인, 마지막 VS2022 호환성 통과 |

단계 2–7 중 독립 범위는 별도 변경으로 나눌 수 있지만, UI만 먼저 활성화하거나 handler를 비워 두는 중간 상태를 release하지 않는다. 각 단계에서 관련 `ARCHITECTURE.md`, `PROTOCOL.md`, 기능 문서와 지원 매트릭스를 갱신한다.

## 7. 검증 매트릭스

### 공통 자동 테스트

1. **Action contract completeness:** renderer/HTML이 내보내는 이벤트가 union/handler/테스트에 모두 존재. Controller → C#/Delphi action → pipe allowlist → Core dispatch의 누락을 검사한다. 정적 검사만으로 끝내지 않고 실행 테스트도 둔다.
2. **실제 DOM 경로:** chat.html + 원본 renderer + bridge를 WebView 호환 브라우저에서 로드하고 클릭/Enter/Shift+Enter/IME/초안·첨부 ack를 검사한다. mock View만으로 버튼 구현을 보장하지 않는다.
3. **상태 교차:** disconnected/connecting/idle/streaming/approval/retry/switching/reconnecting, 각 profile과 capability 조합. 빠른 이중 클릭, IPC timeout, 오류 응답, 잘못된/지난 request ID.
4. **실제 pipe 양 adapter:** C#와 Delphi 64-bit adapter 요청을 fixture Core/OMP와 연결. 새 메서드 allowlist·deadline·응답 필드와 실패를 검증한다.
5. **OMP fixture + 실제 버전:** fixture는 명령·stream·오류를 결정적으로 재현. 실제 지원 OMP 버전에서는 handshake/catalog/settings/프로세스 종료를 확인하고, BTW 등 모델 실행이 필요한 기능은 별도 실사용 테스트로 증거를 남긴다.
6. **독립성:** main/BTW, IDE 두 인스턴스, workspace A/B, 새 세션/재개 세션 간 상태·입력·응답이 섞이지 않는다. 종료 후 child와 pending이 남지 않는다.
7. **UX 보존:** 원본의 정보 구조, dock/float/pin, 좁은 폭·DPI·키보드 접근, 선택값/초안 복원을 점검한다. 필요한 renderer 변경은 이유와 전후 화면을 기록하고 provenance hash를 무조건 맞추는 테스트와 분리한다.

### 실제 IDE acceptance 체크리스트

VS2026와 RAD13.2 64-bit에서 각각 체크한다. 완료 날짜, 설치 버전/해시, 프로젝트, OMP 버전, 결과, 증거 위치를 기록한다.

- [ ] cold start → Core 자동 시작/연결, dock/float/pin 왕복, workspace badge/실제 cwd 일치.
- [ ] 일반 전송/stream/중지/재전송, 긴 한글·IME·코드 블록·오류 후 초안 보존.
- [ ] `/btw 질문`, `/btw` 단독, BTW 버튼, main busy 중 BTW, topic follow-up/cancel/delete/search/filter/copy.
- [ ] BTW 뒤 main transcript·turn·모델이 보존되고 IDE/Core 재시작 후 topic 재개.
- [ ] 설정 모든 탭의 값 조회·변경·취소·적용·재시작, 실제 미지원 항목 설명.
- [ ] 모델·effort·접근 모드 변경 성공/실패, busy 중 버튼 상태, 실패 후 원래 상태.
- [ ] `/` catalog와 실제 실행 일치, 명령 오류·대화상자 취소·세션 변경 정합성.
- [ ] `+` 파일/폴더/이미지, `@` 검색, 선택 영역, chip 제거, 프로젝트 전환 후 이전 context 제거.
- [ ] 실제 MCP/플러그인 항목 설치 상태 조회·toggle·관리, 실패 rollback 및 프로젝트별 적용 범위.
- [ ] 파일/행 링크, URL, 모든 copy 진입점, HTML export의 실제 내용.
- [ ] steer/follow-up/queue 취소, retry 취소, subagent 상세·진행·취소 후 상태.
- [ ] 세션 목록/재개, rich history·시간·첨부, 계획 저장/수정/실행, 사용량 전체 보고서.
- [ ] 승인을 요구하는 변경·거절·stale revision·dirty buffer, 자동 승인 모드 실패 시 재전송 금지.
- [ ] host 파일 변경, native OMP 변경, designer 변경 각각의 checkpoint 적용 범위와 복원. 지원하지 않는 경우 UI가 복원 가능하다고 표시하지 않음.
- [ ] Git 저장소 없는 프로젝트, worktree, 하위 솔루션, 프로젝트 닫기/재열기·다른 프로젝트 전환.
- [ ] 인터넷/모델 실패, OMP 강제 종료, Core 재시작, IDE 재시작 후 복구.
- [ ] VS2022 최종 설치 호환성. RAD32 실사용 테스트는 이번 acceptance 대상 아님.

## 8. 배포·완료 판정

- 소스 변경, 자동 테스트 통과, 실제 새 package 설치, 실행 IDE에 새 package 로드, UI 동작 검증을 각각 구분해 보고한다.
- VSIX/BPL/Core/UI 버전 또는 build ID와 파일 해시를 진단 화면에서 확인할 수 있게 한다. 기존 VS를 닫지 않고 파일만 복사한 것을 새 코드 실행의 증거로 보지 않는다.
- signed installer가 정확한 UI/Core/adapter 산출물을 담는지 검증한다. Windows ARM64 native Core와 현재 SafeNet용 signing tool architecture를 혼동하지 않는다.
- USB PIN 자동 서명은 별도 미완료 항목이다. `docs/CODE-SIGNING.md`의 실제 token 검증 결과를 확인한 뒤 배포한다. 이번 감사에서는 PIN 등록/서명/설치를 수행하지 않았다.
- 각 33종 action의 성공·실패·취소 결과가 명확하고, visible interactive 요소에 무응답 경로가 없어야 한다. 숨기거나 비활성화한 미구현 기능은 목록에 남기며 전체 완료로 보고하지 않는다.
- `docs/VALIDATION.md`에 실제 확인 사실만 기록한다. fixture 테스트를 실사용 검증으로, 문서의 과거 OMP 버전을 현재 설치 버전으로 바꾸어 표현하지 않는다.

## 9. 다음 구현 담당자에게 전달할 작업 지시

> 이 문서를 기준으로 단계 0부터 구현한다. 현재 기준은 a90806c이며 UI/adapter/Core의 13개 미처리 action과 F01–F12를 우선 대조한다. RADAgent는 수정하지 말고 동작의 reference로만 읽는다. 기존 UI/UX의 배치·메뉴 구조를 임의로 바꾸지 않는다. 먼저 실패를 재현하는 테스트와 action/result/capability 계약을 만들고 F06의 자동 재승인 오류를 제거한다. 이후 BTW와 실제 설정을 포함한 각 단계를 완결한다. UI mock 테스트뿐 아니라 DOM→adapter→Core→OMP 왕복과 설치본 VS2026/RAD13.2 64-bit 검증을 한다. VS2022는 최종 직전에만 검증한다. 구현되지 않은 항목, 자동 테스트 결과, 실제 설치본 확인 결과를 구분하여 보고한다.


## 10. 후속 구현 기록 (2026-10-05)

위 표는 감사 당시 a90806c의 증거로 보존한다. 후속 코드 변경, 새 RPC/설정/BTW 및 regression 검증 결과는
[CHAT-UI-IMPLEMENTATION.md](CHAT-UI-IMPLEMENTATION.md)에 기록했다.
파일-only 복원과 메시지 분기, 자동 테스트와 실제 설치본 acceptance는 계속 구분한다.
