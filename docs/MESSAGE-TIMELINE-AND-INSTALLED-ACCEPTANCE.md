# 메시지 분기·복원 및 설치본 검증 (2026-10-05)

서명 설치파일 생성 전 acceptance 기록이다. 전체 설치본 전수 검증을 완료로 판정하지 않는다.
RADAgent reference repository는 변경하지 않았다. VS2022와 RAD32 실사용 검증은 이 범위에서 제외한다.

## 설치 및 자동 검증

- PC Windows ARM64, Node ARM64 24.21, OMP 18.6.0, VS2026 Community, RAD13.2 64-bit.
- 개발 검증용 unsigned VSIX 0.9.8, Core 0.9.0 additive protocol, Win64 PiAgent370.bpl.
- 최신 release: `%LOCALAPPDATA%/Programs/PiAgent/releases/0.9.0-acceptance-20261004202000`.
- package: `artifacts/piagent-2026-10-04T20-17-13-590Z`; manifest hash를 검사해 설치했다.
- 설치 receipt/이전 VSIX/BPL registry backup: `artifacts/installed-acceptance-20261004202000`.
- `npm test`: 89/89, `tests/adapters.integration.mjs`: 15/15.
- 실제 패키지 HTML/ESM WebView2 smoke: JS/CSP 오류 없음, message hover/preview/approve/draft,
  원본 BTW/설정/@, 12회 dock/tab/hide 전환 시 한글 초안·DOM 유지.
- 로그: `artifacts/chat-ui-implementation/timeline-{tests,refresh-adapters,refresh-build,webview-live}.log`.
  계획 실패 카드 추가 검증은 `timeline-plan-{build,webview}.log`.
- 실제 OMP JSONL fork 별도 검증: `message-fork-real.json`. 원본 bytes를 유지하며 새 OMP context를 생성했다.
- 기존 signed setup SHA256 `F97E42076F6896EF4B9083175A650B51BA450BE16A1619CF4A1C5B15D39F5322`는 유지.
  signed installer를 생성하지 않았다.

## 실제 설치 IDE에서 확인한 결과

UI 캡처: `artifacts/installed-acceptance-20261004171220/ui/`.
추가 파일·private session 요약: `artifacts/installed-acceptance-20261004183059/`.
테스트 프로젝트는 `artifacts/ide-acceptance-20261005/{vs,rad-vcl,rad-fmx}`의 별도 Git repository이다.

| 시나리오 | VS2026 | RAD13.2 64-bit |
|---|---|---|
| Core 미실행 상태에서 자동 실행·인증 연결 | PASS, Core 부모가 devenv | PASS, Core 부모가 bds |
| 활성 프로젝트 workspace 인식 | PASS vs 루트 | PASS VCL→FMX 루트 변경 |
| 원본 WebView 채팅 렌더링 | PASS pinned tool pane | PASS 실제 BPL 채팅 창 |
| 실제 모델 BTW 질문·재개 | PASS 7→14, notes 검색/복사 | PASS 2+2→4 |
| settings save | PASS font 13→14 및 재개 대화 제목/연결 유지 | PASS font 13→14 영속 저장, 제목/연결 유지, advanced/native 경로 |
| 파일 첨부 picker | PASS Form1.cs 경로 chip | PASS Main.pas 경로 chip |
| MCP 실제 toggle | PASS off→on→off, project config와 최종 switch 일치 | PASS off→on→off, config와 switch 일치 |
| 플러그인 실제 toggle | PASS local linked fixture off→on, saved session 재개 | PASS 자체 linked fixture off→on, lock 및 switch 일치/재개 |
| native designer | WinForms menu/toolstrip/editor/status 실제 렌더링 PASS | VCL/FMX 실제 ToolsAPI tree PASS |
| native build | PASS + 메뉴→SolutionBuild→빌드 완료 | FMX IDE build PASS, 오류/경고 0 |
| HTML export | PASS native 저장 picker→571190 bytes HTML | PASS native 저장 picker→620514 bytes HTML |
| usage | PASS 실제 토큰·비용 sheet, provider quota popover | PASS quota 및 29,171 tokens/$0.0189 sheet |
| plan | PASS read-only/문서 생성/hash 차단/실패 카드 재시도 복구/정상 실행 시작 | PASS 문서 생성→수정 초안→진행→실제 FMX inspect 승인/완료, 파일 변경 없음 |
| 모델·생각 수준 변경 | PASS opus5.5→opus5→opus5.5, high→medium | PASS opus5.5→opus5, high→medium |
| 접근 모드 변경 | 네 모드 실제 선택 및 ack PASS | 항상 묻기→쓰기 허용→권한 무시→계획→계획 진행으로 항상 묻기 PASS |
| 주 응답/BTW 중지 | PASS 주 응답 중지 후 재사용, BTW만 중지 | PASS 주 응답 중지 후 2+2=4, BTW만 중지 |
| 후속 메시지 대기열 취소 | PASS visible 취소 버튼→취소됨/보내지 않음, 미실행 | PASS visible 취소 버튼→취소됨/보내지 않음 |
| 파일 참조·코드 복사 | PASS Program.cs:1→실제 1행, 코드42 복사, HTTPS 브라우저 열기 | PASS Main.pas:1→실제 1행, 코드42 복사 |
| 편집기 선택 영역 전달 | PASS 실제 선택 namespace 행 캡처·chip 첨부·모델 답변 일치 | PASS 실제 선택 unit Main; 캡처·chip 첨부·모델 답변 일치 |
| @ 파일 자동완성 | PASS Form1.cs 선택 | PASS Main.pas 선택 |
| BTW 메모 검색 | PASS 검색/현재 대화/복사 | PASS 빈 검색/일치 검색/현재 대화 filter |
| 메시지 대화 분기 | PASS 원본 보존, 이전 메시지만 clone | PASS VCL seq2→branch, 원본 보존 |
| 분기에서 다시 복원 | protocol 회귀 PASS | PASS branch seq1→empty restored session |
| 파일+대화 복원 | PASS approved edit→seq2 restore, CRLF byte 일치 | PASS FMX Caption 변경→seq2 restore, fmx byte 일치 |
| 미저장 editor 복원 차단 | PASS, 입력 내용·디스크 보존 | PASS 실제 Main.pas 미저장 주석→복원 차단/버퍼·디스크 보존→원본 다시 저장→동일 요청 복원 완료 |
| 복원 후 열린 디자이너 갱신 | VS text editor reload PASS | stale designer 발견·수정 후 실제 FMX 재검증 PASS |

VS Form1.cs 변경 전/복원 후 SHA256:
`8DA584B6E6F63625249A0607122004B96D0DC12582BAA5166E767E412991A72B`.
원본 session `4cb0cfd3-3b95-4dd3-8998-4f9a5c96a093` seq2는 보존되고,
복원 session `798a35f9-27c6-4c08-8b84-6870667f0d50`에는 seq1만 남는다.
FMX 첫 복원 전/후 SHA256:
`BFE8696E043CCB817FBD94FC9FB3ADAADE601FEB930503F4AB710756E083581B`.
RAD Main.pas 미저장 복원 차단 및 검증 주석 실행 취소/다시 저장 후 SHA256:
`6FC5249C84189B63C432472DE9D86FD765211E2C2564FED43B4C663BDA9DCC90`.
RAD는 실행 취소만으로 Modified flag가 해제되지 않아 원본 내용을 다시 저장했다.
hash가 그대로인 상태에서 같은 승인 요청을 재시도해 empty restored context와 원래 초안 반환을 확인했다.
evidence: `rad-dirty-{restore-blocked,source-preserved,source-resaved,restored-after-save}`.

## 발견 및 수정

1. 최초 시작 Named Pipe 연결을 테스트하려고 연결했다 즉시 끊는 probe가 인증 bootstrap을 방해했다.
   C#/Delphi 모두 WaitNamedPipe로 변경. VS와 RAD 실제 cold start PASS.
2. ARM64 Windows 위 x64 RAD IDE에서 Core runtime 선택은 프로세스 아키텍처가 아니라
   IsWow64Process2 native architecture를 사용한다.
3. MCP slash prompt admission을 완료로 처리해 stale list가 표시됐다. terminal event와 chained snapshot
   저장 완료를 기다리고 요청 상태를 검증한다. 실제 VS toggle 및 지연 handler regression PASS.
4. RAD 파일 복원 뒤 열린 FMX designer가 이전 Caption을 유지했다. 성공 response 처리 시 IDE thread에서
   dirty buffer를 다시 검사하고 연관 IOTAModule.Refresh(True)를 호출하도록 수정했다.
   같은 Caption 변경/복원을 다시 실행해 disk SHA256, native designer 및 Object Inspector의 원래 값 복귀를 확인했다.
   evidence: `rad-fmx-refresh-restored-{chat,designer}`.
5. synthetic fixture의 Delphi ProjectExtensions 누락과 WinForms Designer lambda는 fixture 자체 문제였다.
   native project metadata 및 CodeDOM-compatible field/AddRange 초기화로 수정했다.
6. 변경된 계획 실행은 Core가 정상 차단했으나 원본 카드가 실행 중 표시/disabled로 남았다.
   proceedPlan error ack를 카드에 연결해 실제 오류를 표시하고 수정/재시도 버튼을 복구했다.
   controller 및 실제 WebView2 회귀 PASS (`timeline-plan-webview.log`).
7. OMP가 abort 요청 자체에 응답하지 않으면 기존 cancel RPC가 5초 pipe timeout에 걸렸다.
   abort 응답을 기다리지 않고 요청 ack를 반환하며, abort 전부터 종료 deadline을 시작한다.
   fallback cleanup은 같은 abort를 재요청하지 않는다. 무응답 abort의 실제 pipe 회귀 및
   양 설치 IDE의 중지/후속 대화 재사용 PASS (`vs-abort-fixed`, `rad-abort-fixed`, `rad-abort-reuse`).
8. settings 문자열 재적용이 동적인 제목/연결 상태/disabled 상태를 덮어썼다.
   bridge가 최신 status와 capabilities를 재적용한다. 실제 양 설치 IDE에서 저장 후 제목/연결 유지 PASS.
   실제 WebView2에서 busy controls/한글 draft 유지도 PASS (`timeline-state-webview.log`).
9. RAD MCP 관리는 OpenModule만 호출해 새 파일이 실제 편집기에 표시되지 않았다.
   IOTASourceEditor.Show를 호출하고 실패 ack를 전달한다. 실제 설치 IDE의 mcp.json 탭 PASS.
10. 원본 markdown의 Pascal 한정 file-ref 때문에 C# 파일 참조가 눌리지 않았다.
    renderer의 확장자 인식만 C#/XAML/FMX/프로젝트 파일 등으로 확장했다. 레이아웃/CSS는 유지.
    unit/실제 WebView2 회귀 및 VS Program.cs:1/RAD Main.pas:1 실제 편집기 열기 PASS.
11. RAD의 legacy SelectDirectory에는 채팅 창 소유자가 없어 modal이 뒤로 가려져 입력이 막혔다.
    기본 폴더를 활성 workspace로 설정한 Windows TFileOpenDialog(fdoPickFolders)로 교체하고
    Execute(Handle)로 명시적으로 소유자를 전달했다. 빌드/adapter 회귀 및 설치본
    picker→자체 VS 폴더 추가 ack PASS (`rad-folder-added-fixed`).

## 원본 33 action 전수 목록과 검증 범위

모든 action은 strict controller route 및 pipe/서비스 회귀로 검사한다. 아래 '설치 UI 추가'는
자동 테스트만으로 실제 IDE 클릭 완료를 주장하지 않기 위한 항목이다.

| action | 근거/남은 설치 UI 확인 |
|---|---|
| ready | 양 IDE 자동 연결 PASS |
| submit | 양 IDE 실제 모델/도구 실행 PASS |
| abort | 양 IDE 실제 중지 후 입력/후속 대화 재사용 PASS, 무응답 abort pipe 회귀 |
| newSession | 양 IDE message transition 및 상단 + 직접 클릭 PASS |
| sessions | 양 IDE 실제 목록 원본 재개/기록 재생 PASS |
| settings | 양 IDE sheet/영속 저장/제목·연결 보존 PASS |
| btw | 양 IDE 모델 실행 PASS |
| btwList | VS notes/search/copy, RAD notes/search/current filter PASS |
| btwStop | 양 IDE 실제 중지됨/본 대화 유지 PASS |
| btwDelete | backend 회귀; UI 삭제는 별도 사용자 확인 필요 |
| export | 양 IDE native 저장 picker→실제 HTML 저장 PASS |
| setModel | 양 IDE 실제 모델 변경 ack PASS |
| setThinking | 양 IDE 실제 high→medium ack PASS |
| setApproval | 양 IDE 설치 네 모드 선택/ack PASS |
| approval | 양 IDE 실제 tool/host 승인 PASS |
| attachFiles | 양 IDE native picker 및 원본 attachment chip PASS |
| addFolder | 양 IDE 실제 native picker→자체 테스트 폴더 추가 ack PASS |
| listExtensions | 양 IDE 실제 MCP/plugin 목록 PASS |
| toggleMcpServer | 양 IDE 실제 project config off→on→off PASS |
| togglePlugin | 양 IDE 실제 CLI toggle/reopen PASS. 테스트 junction만 제거하고 원래 lock 설정 복귀 확인 |
| manageExtensions | 양 IDE 실제 native MCP editor PASS (`vs-mcp-editor-final`) |
| compile | 양 IDE 채팅 + 메뉴 실제 IDE build PASS |
| listFiles | 양 IDE 실제 @ autocomplete/파일 선택 PASS |
| openFile | 양 IDE 실제 파일 참조→native editor/1행 PASS |
| openUrl | HTTP(S) allowlist 회귀, 양 IDE 링크 클릭으로 Example Domain 브라우저 열기 확인. RAD 클릭 후 Edge 탭 수 4→5; 최종 browser capture는 도구 URL 판별 제한으로 중단 |
| copy | 양 IDE 실제 코드42 복사 ack, VS BTW copy PASS |
| runCommand | 실제 MCP slash PASS, discovery/거절 회귀 |
| usage | 양 IDE 실제 quota/비용 sheet PASS |
| cancelQueued | 양 IDE 실제 후속 queue 취소/미실행 PASS |
| abortRetry | 서비스 회귀 및 설치된 HTML/ESM 실제 WebView2 controlled retry→버튼→abort_retry host route PASS; 실제 provider retry는 발생하지 않음 |
| subagentLog | bounded cursor 회귀, 양 IDE 실제 OMP task 계산 3+4=7 및 상세 로그 sheet PASS (`rad-subagent-log-final`) |
| proceedPlan | VS hash 거절/카드 회복/정상 실행 시작 PASS; RAD 계획 수정→진행→조회 승인/완료 PASS |
| restore | 양 IDE message branch/restore PASS, RAD native reload PASS |

## 지원 경계 및 출하 gate

메시지 snapshot 최대 50개, OMP JSONL 64 MiB, 파일 capture 500개/8 MiB/파일당32 KiB;
복원 최대8개/양쪽128 KiB. preview5분. 기존 Git 추적 UTF-8 파일만 지원한다.
생성·삭제·바이너리·미추적·non-Git·추가 root·미저장 IDE buffer는 복원했다고 주장하지 않는다.
원본 session은 보존하고 새 private OMP context로 이어간다. Git HEAD/index를 reset하지 않는다.
사용량 unknown은 비용0으로 바꾸지 않는다. 전체 third-party extension UI를 보장하지 않는다.

설치 UI 추가 항목이 남았으므로 signed installer gate는 보류한다.
인증/USB PIN 대화상자는 자동 조작하지 않았으며, DPAPI PIN 등록 여부는 별도 배포 검증 대상이다.

2026-10-05 후속 배포 요청: 사용자가 커밋·푸시·코드서명 빌드·릴리즈를 명시적으로 요청했다.
위 acceptance 제한을 유지한 채 0.9.9 사전 릴리즈로 배포한다. 실사용 전수 검증 완료를 주장하지 않는다.
