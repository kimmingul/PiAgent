# PiAgent validation history

## 최신 상태 (2026-10-08)

제품 버전 0.9.19. 언어 지원 검증은 [한국어](LOCALIZATION.md) / [English](LOCALIZATION.en.md)에 정리한다.
전체 회귀 **148/148**, adapter 통합 **17/17**, 서명 설치 패키지 WebView **75 PASS**를 확인했다.
RAD13.2 64-bit에서 시스템 기본 한국어, 영어 저장과 화면 전환, IDE 재실행 후 선택 유지를 직접 확인했다.
설치 창의 한국어/영어 배치와 IDE 선택 보존도 직접 확인했다.

아래는 이전 0.9.18 검증이다. 당시 로컬 RAD 검증 receipt는 `0.9.18-20261007162727`이다.
VS2022/2026와 RAD32/64 등록이 기록되어 있으나 최신 실사용 검증은 VS2026/RAD13.2 64-bit를 우선한다.
설치 등록, 자동 회귀, fixture/mock bridge, 실제 모델·IDE 결과를 서로 구분한다.

- 0.9.18 전체 자동 회귀 **143/143**, C#/Delphi adapter 통합 **17/17**, 설치 패키지 WebView **70 PASS**.
- RAD13.2 64-bit에서 구버전 BPL 중복 등록을 정리하고 실제 로드된 0.9.18 경로를 확인했다.
- VCL/FMX 별도 Git 프로젝트에서 실제 모델의 조회·Caption 변경·ToolsAPI 저장·재조회를 확인했다.
  두 프레임워크 모두 새 0.9.18 BPL에서 확인하고 빌드·실행 창 제목까지 검증했다.
  FMX 미저장 상태를 재현하여 권한 문제와 구분하는 안내 및 파일 보존도 확인했다.
  [0.9.18 기록](RELEASE-0.9.18.md)을 따른다.
- 네이티브 VCL/FMX 부모·메뉴·공유 Action·순환 차단과 FMX 스트림/UTF-8 round trip 검사 통과.
- [RAD 디자이너 원인과 복구](RAD-DESIGNER-DIAGNOSTICS.md). 컴포넌트 생성·삭제·이벤트 처리기 자동화는 미지원이다.
- 세션 복구 수정 자동 회귀 140/140, 강제 종료 후 재개와 여섯 프로세스의 복구 경쟁 보호 확인.
- 실제 VS2026/NanumPDF 저장 대화 재개, 연결 상태 및 OMP JSONL 해시 보존 확인.
- [0.9.17 배포 검증](RELEASE-0.9.17.md)과 [원인·복구 기록](SESSION-RECOVERY-FIX.md).
- 0.9.17 전체 자동 회귀 140/140, C#/Delphi adapter 통합 17/17, 패키지 WebView 검증 통과.
- 통합 설치파일과 VSIX/내부 DLL, RAD32/64 BPL, PipeHost 서명·타임스탬프 검증 통과.
  내장 payload 전체 해시, ARM64/x64 번들 인증 연결·ping, 설치 안전성 검사 통과.
- 이전 장시간 수정 자동 회귀 118/118, 실제 Named Pipe fixture 631초와 WebView2 PASS 57개.
- 설치 VS2026의 NanumPDF 개발 턴: 2026-10-05 18:58:30–21:35:54 KST,
  약 2시간 37분 후 UI 최종 응답 및 Core `completed` 기록으로 종료 확인.
- RAD13.2 64-bit 서명 UI의 로드/연결과 프로젝트 바인딩 확인은 장시간 NanumPDF 검증과 별개다.
- VS2022 최신 전수 검증, RAD32 UI, 물리 x64와 기존 PARTIAL/MANUAL 항목은 남아 있다.
  모든 기능 실사용 승인으로 승격하지 않는다.

[장시간 수정 및 실제 관찰](LONG-RUNNING-TURN-FIX.md) ·
[설치 acceptance](INSTALLED-ACCEPTANCE-0.9.14.md) · [결함 수정](ACCEPTANCE-FIXES-0.9.14.md).

아래 테스트 수치와 FAIL은 해당 시점의 이력이며 후속 수정으로 원본 기록을 덮어쓰지 않는다.

2026-10-05 설치 0.9.14 전수 기능 점검 및 실제 VS2026/RAD13.2 64-bit 검증: [설치본 acceptance 결과](INSTALLED-ACCEPTANCE-0.9.14.md). 자동 회귀 105/105, 설치 Core + native OMP 25/25 통과. 실제 IDE 결과와 mock WebView harness, 미검증·수동 항목을 구분했다. 전체 실사용 승인은 보류한다.

## RADAgent UI restoration / VSIX 0.7.3 (2026-10-04)

- Reused the local RADAgent HTML structure, six CSS files, renderer modules, translations and provider icons.
  No reference files were modified. Source SHA-256 inventory and licenses are in ui/.
  Only the host hook, capability guard, page title/CSP and TypeScript bridge change the original UI sources.
- Replaced the feature-button dashboard with the original conversation/composer, title-based sessions,
  context-ring usage and inline diff approval. Unsupported Core operations remain disabled in their original places.
  File restore explicitly describes its file-only semantics; it does not claim RADAgent conversation rollback.
- npm test: 46 passed before the source-preservation assertion was added. Final UI suite: 5 passed,
  including byte-exact CSS/renderer/icon preservation. Adapter integration: 13 passed.
- VSIX and Delphi Win32/Win64 BPL builds succeeded; both ship all source assets and compiled bridge/controller.
- Real WebView2 test of the extracted final VSIX: history/Markdown, safe labels, inline approval, session overlay,
  zero JavaScript/CSP errors, and 12 reparent/tab/hide transitions preserving Korean draft and browser PID passed.
- Installed final VSIX 0.7.3 into default VS 2026 instance 4dee894c, reopened NanumPDF, verified the pinned UI,
  automatic Core connection, actual model display, session list and replay of the user's pre-update conversation.
  Core workspace remains D:\source\PiAgent. VS 2022 and the running RADAgent IDE were not changed.
- UI scope and deliberately unavailable Core commands: ui/README.md. Original CSS must not be redesigned.
## VSIX 0.7.1 docking fix (2026-10-04)

- Reproduced the blank view in VS 2026 18.10.3, including a diagnostic PiAgentTest profile.
  The SDK WPF WebView2Base caches the initial Window and subscribes to its Closed event;
  that event calls Uninitialize after VS docks the control and closes the former floating window.
  PiAgent's tool window and OMP connection remained alive, but the WebView controller was gone.
- ChatWebView now owns the public WebView2 controller through HwndHost, updates ParentWindow
  when the WPF presentation source changes, and closes it only when the host is disposed.
  The same browser document survives reparenting; no transcript/approval/draft replay is involved.
- Added PiAgent.WebView.Smoke (x64 .NET Framework, emulated on this ARM64 PC).
  `--baseline` with SDK WPF WebView2 fails at the first reparent/old-window-close transition.
  The fixed host passes 12 real-WebView checks: four reparent/close, four tab switches and four
  hide/show cycles, retaining browser PID, an in-page marker and a Korean draft.
- VSIX Release rebuild: zero warnings/errors. Release/UI tests: 3 passed.
  Full adapter packaging succeeds with VSIX 0.7.1 and compatible Core/RAD 0.7.0.
- Installed 0.7.1 into the default VS 2026 profile (instance 4dee894c), reopened the user's existing
  NanumPDF solution, and verified the right-hand PiAgent tab, Solution Explorer tab switching,
  float → dock and unpin → auto-hide → pin. The Korean draft, WebView PID 9516 and OMP PID 14684
  survived all transitions. Core remains configured for D:\source\PiAgent.
- The diagnostic test-profile DLL was restored to its original 0.7.0 after investigation.
  VS 2022 was not upgraded or manually retested for this adapter-only patch.

## Final seven-stage validation (2026-10-04)

Windows ARM64 PC, Node 24.21.0; existing RADAgent source and the user's default IDE profiles were not changed.

| Requested stage | Implementation / evidence |
| --- | --- |
| VS 2026 approval/restore | Community 18.10.3, instance 4dee894c, PiAgentTest: actual WebView full-file diff → approval → disk change → reverse diff → explicit restore. 0.7.0 also approved/restored Example.cs and Second.cs together. |
| VS 2022 approval/restore | Community 17.14.35, instance 8967bed4, PiAgentTest: same single-file flow, then final 0.7.0 two-file approval/restore and empty Git diff. |
| RAD WebView chat/approval | RAD Studio 13.2 Win64, isolated PiAgentValidation07 profile: BPL load and Open Chat, secure connection, two-file diff approval/apply/restore, saved conversation reopen, token/USD cost/provider-limit UI. Normal IDE exit joined its worker. |
| Durable sessions | Secure private workspace store, exclusive lease and OMP JSONL resume. Tests close/restart the daemon and recover model conversation, reject another owner and linked files. Installed OMP 18.5.0 also reopened a real saved session successfully. |
| Usage/cost | Normalized get_session_stats/get_state and provider usage CLI. Real OMP returned token/cost fields and Anthropic account limits. Fixture UI displayed 30 tokens, USD 0.004 and 25% plan usage. Missing values remain unknown. |
| Multi-file changes | 1–8 tracked files per approval/revision/checkpoint. Tests verify whole-batch staleness checks, failed-second-write rollback, raw BOM/CRLF restore after restart, capability/owner restrictions and unchanged Git index/HEAD. |
| Windows distribution/install | Same ESM/AnyCPU artifact for x64/ARM64; versioned PowerShell install/start/uninstall, SHA-256 manifest, VSIX and Win32/Win64 BPL plus UI/loaders. Tests run PowerShell 5.1 install/start with default source/settings from another cwd, authenticate/ping the installed daemon, reject corruption/duplicate installs and uninstall the verified version. |

- Final Core/UI suite: **43 passed / 0 skipped** on native ARM64 and **43 passed / 0 skipped** on x64 Node under Windows emulation.
- Adapter suite: **13 passed / 0 skipped**, including secure C# changes and Delphi Win32/Win64 chat-worker batch approval/restore, saved resume and usage.
- VS 2022 and VS 2026 MSBuild, Delphi Win32/Win64 BPL and both harness builds succeeded.
- UI tests additionally cover duplicate session-switch suppression, the intermediate closed event, safe stored-text
  rendering, background persistence warnings without clearing an active turn, approval/restore retry and all-file labels.
- PowerShell default script-relative paths are resolved in the script body, after PSScriptRoot is available.
  The regression test exercises both defaults with ARM64/x64 Node and cleans only its spawned launcher process tree.
- Approval UI uses deterministic fixture OMP, not live-model edit proposals. Actual IDE hosts, authenticated pipe,
  Core writes and Git checkpoints are real. Actual OMP process/session/usage checks are recorded separately.
- Scratch checkpoint journals are restored: VS 2026 single ea69640a-cbb3-40ba-90ba-b6de1d37e779,
  VS 2022 single 926c9db5-104a-48d0-aaef-c472fca5367b, VS 2026 batch da5908ab-ac80-441e-b7c2-70ce339b1870,
  RAD batch 048227d8-419c-42cc-9011-313f764ddc9e, VS 2022 batch df9082fe-525f-40d7-88b9-7cf8c02a8065.
  Example.cs retained its original CRLF bytes, Second.cs its LF bytes, and the final scratch Git diff was empty.
- Diagnostic logs remain in ignored .tools/ide-validation and Windows TEMP dd_VSIXInstaller logs.

Physical x64 hardware and the final Win32 RAD WebView UI were not exercised; x64 Node and Win32 worker were
tested under Windows ARM64 emulation. Other Delphi SDK versions need rebuilding. The IDE unsaved-buffer guards
compile, but a modified-editor UI scenario is not claimed here. No power-loss, remote/second-user or malicious
concurrent-writer test is claimed. Batch writes are conditional rollback operations, not atomic filesystem transactions.
Interrupted session locks/checkpoint journals require inspection; see SESSIONS-USAGE.md and APPROVED-CHANGES.md.

## Approved changes (0.6.0)

- 39 Core/UI tests passed on native ARM64 and emulated x64 Node 24.21.0 (38 Core plus one WebView controller test).
- 11 adapter integration tests passed, including actual secure Named Pipe C# approval/apply/restore round trip.
- Tests cover pending/rejected/cancelled/stale/foreign approvals, capability gating, raw BOM/CRLF and dirty
  content preservation, unchanged Git index/HEAD, disabled Git hooks, locks, hard links and restart recovery.
- WebView controller test exercises explicit approval, duplicate-click suppression, rejection, reverse-diff preview,
  restore confirmation, operation failure retry, warnings and disconnect cleanup using a minimal DOM fixture.
- VS 2022/2026 MSBuild and Delphi Win32/Win64 BPL builds succeeded. On 2026-10-04 both actual VS hosts
  completed the 0.6.0 approval/apply/reverse-diff/restore flow; fixture OMP drives change proposals.
  A live-model edit proposal was not manually exercised.
- Release test runs the standalone secure daemon/probe outside the workspace and verifies packaged file hashes.
- This release does not claim atomic disk writes, malicious concurrent-writer isolation or power-loss recovery tests.
  Interrupted metadata recovery is tested by prepared/restoring state simulation; see APPROVED-CHANGES.md.

## Secure transport (0.5.0)

- Core: 33 tests passed with native ARM64 and emulated x64 Node. Adapter: 10 tests passed.
- New tests verify actual protected pipe DACL (one user allow + network deny), private token ACL,
  concurrent authenticated peers, duplicate listener rejection, reconnect, malformed/expired/replayed
  proof rejection, credential junction/hard-link rejection, and a non-extendable 10-second auth deadline.
- C# VS and Delphi Win32/Win64 harnesses authenticate and ping; wrong credentials fail without downgrade.
  Secure C# workspace chat also verifies exact Unicode file results, concurrent ping and cancellation.
- Default secure CLI runs from the standalone release outside the npm workspace and authenticates its probe.
- Actual OMP 18.5.0 over the secure pipe invoked workspace_search and workspace_read_file and completed
  an explanation of SelectionExample.cs. No model calls run in automated tests.
- Current-user ACL and PIPE_REJECT_REMOTE_CLIENTS are configured at pipe creation. An actual second-user
  account or remote-machine connection has not been exercised; this is not executable attestation or a sandbox.
- VS 2022/2026 MSBuild and Win32/Win64 BPL builds succeeded. New BPLs use version directories so the user's
  currently loaded older BPL is not overwritten. Actual 0.5.0 IDE UI has not yet been exercised.

## Read-only workspace tools (0.4.0)

- Core: 27 tests passed with ARM64 and x64 Node (x64 under Windows emulation). Adapter: 8 tests passed.
- Actual OMP 18.5.0: set_host_tools registered only workspace_search/workspace_read_file while built-in
  tools remained disabled. A live scratch-workspace prompt invoked both tools, found/read SelectionExample.cs
  and returned a completed explanation of Double. The smoke command asserts at least one tool invocation.
- Tests verify UTF-8/Unicode, range/output limits, literal search, traversal/ADS/device paths, secret exclusions,
  binary/oversized files, junctions/hard links, capability gating, cancelled-call suppression and duplicate-ID retirement.
- VS 2022 and VS 2026 MSBuild succeeded; VS 2022 0.4.0 host UI has not been exercised.
- VS 2026 18.10.3 PiAgentTest: installed 0.4.0, connected to the configured scratch workspace,
  confirmed its read-only URI and file-read/search scope in Chat, then asked to find Double and read
  SelectionExample.cs. The UI completed a Korean explanation of the function.
  Normal test IDE exit removed its owned OMP child (PID 22536); the user's default IDE stayed open.

## Selection context (0.3.0)

- Core: 23 tests passed with ARM64 Node and x64 Node under Windows emulation. Adapter: 7 tests passed.
- VS 2026 18.10.3 PiAgentTest: installed 0.3.0, opened a local scratch C# file, selected the `Double`
  function, captured its file URI/language/1–2 line range and exact code into the attachment preview.
  Sending the default Korean explanation question produced a completed explanation containing the function
  and its expression-bodied equivalent. The attachment was cleared after the turn was accepted.
  Normal test IDE exit also removed its owned OMP process (PID 29904); the user's default IDE stayed open.
- C# transport test verifies the exact Unicode context reaches OMP; Core tests verify negotiation,
  malformed/oversized ranges and snapshots, and that the next plain turn has no implicit attachment.
- VS 2022 selection capture has not been exercised in the actual host for 0.3.0; its build is checked.
  The previously completed 0.2.0 host checks below remain recorded separately.

## Previous chat validation (0.2.0)

2026-10-03, Windows ARM64 PC, Node 24.21.0. Existing RADAgent source/settings were not changed.

## Actual integrations

- OMP 18.5.0: fresh tool-free session, prompt acknowledgement, text deltas, terminal agent_end;
  scripts/chat-smoke.mjs received `PiAgent chat verified` using the installed OMP credentials.
- VS 2026 Community 18.10.3 (18.10.12224.181), instance 4dee894c, isolated PiAgentTest profile:
  VSIX 0.2.0 loads, Tools → PiAgent: Open Chat creates the WPF/WebView2 tool window.
  Connect → prompt → streaming text → `PiAgent VS Chat verified` → completed succeeded.
  A second counting response was cancelled before completion; UI showed cancelled and enabled input.
  New conversation cleared the transcript and started a fresh OMP session.
  Normal IDE exit removed the owned OMP child (PID 24752 in this run).
  WebView inputs were exercised using keyboard navigation because the automation helper rejects
  clicks into the separate msedgewebview2 process. No alternative UI automation APIs were used.
- RAD Studio 13.2: previous Win32/Win64 BPL handshake/ping host verification remains valid;
  the Delphi transport is unchanged and the current Core remains backward compatible.
- VS 2022 Community 17.14.35, instance 8967bed4, isolated PiAgentTest profile:
  after user login, VSIX 0.2.0 builds without warnings/errors, loads its package and exposes both Tools commands.
  Check Core Connection reported `PiAgent: handshake/capability/ping OK`.
  Open Chat connected, streamed `PiAgent VS 2022 verified` and showed completed.
  New conversation cleared the transcript and created a fresh session.
  Normal test IDE exit removed both owned OMP children (PIDs 30920 and 18284 in this run).
  VS 2022 initially failed because its Newtonsoft.Json binding lacks JToken.ToString(Formatting).
  Both transport and WebView bridge now use the compatible overload with an explicit converter array;
  the six adapter tests and actual VS 2022 flow passed after rebuilding/reinstalling.
  The default VS 2022 profile and the user's open IDE were not changed.

Local diagnostic files are in .tools/ide-validation (ignored by Git). Model responses and keys are
not committed. No LLM calls are performed by the automated test suite.

## Automated checks

22 Core tests passed on both ARM64 and x64 Node; 6 adapter tests passed (28 distinct tests).
Core tests cover framing, negotiation, Windows Named Pipes, CLI, OMP lifecycle, session ownership,
streaming, overlapping turns, cancellation, acknowledgement timeout, provider errors, child exit,
Unicode chunk boundaries, shutdown during process retirement, and standalone release execution.
Adapter tests cover C# duplex chat/ping/cancel and C#/Delphi framing/cancellation failures.
ARM64 Node is native. x64 Node runs under Windows emulation on this ARM64 PC; a native x64 PC
and VS ARM64-on-native-x64 cross-architecture combinations have not been tested here.

Build scripts rebuild VSIX to avoid stale VSSDK-generated manifests. After replacing an installed
test extension, this PC needed `devenv.exe /RootSuffix PiAgentTest /UpdateConfiguration` while
the test IDE was closed, because its cached CodeBase still pointed at the previous extension folder.
The default VS profile was not changed. WebView2 runtime is installed separately; SDK managed DLLs
and loader DLLs are included with their license, while VS IDE SDK assemblies are not redistributed.

## Remaining scope

File/IDE-changing tools, approval UI, Git checkpoints/restore, usage aggregation, RAD WebView host,
persistent session restoration and OMP protocol v2 chunk reassembly remain future capabilities.
Chat is ephemeral; 0.4.0 optionally enables bounded read-only workspace tools. 0.5.0 provides current-user pipe ACL and mutual
credential authentication. Approval/checkpoint and additional authorization remain required for future file-changing tools.


## 2026-10-04 OMP 18.6 / designer development branch

- npm test: 54 tests passed (strict TypeScript + secure transport build included).
- Adapter integration: 13 tests passed using C# and Delphi Win32/Win64 clients.
- VSIX / Delphi Win32 / Win64 builds passed; no VS main-thread analyzer warnings after fixes.
- Real OMP 18.6.0 ARM64: v2 negotiation, 121-model discovery, current model/effort round-trip.
- Native smoke: fresh temporary Git workspace, private session, host tools, event delta filter,
  subagent progress subscription; rejects opening native with read-only negotiation. No model prompt sent.
- Actual WebView2 harness: model/effort controls enabled, safe confirmation card, disconnect cleanup,
  original Markdown/approval/session views and 12 docking transitions passed without CSP/JS errors.
- Designer broker: read-only denial, explicit approval, revision propagation, stale adapter rejection,
  cancellation and forged/duplicate response rejection covered by automated tests.
- The development checks above preceded the interactive installation below.

## 2026-10-04 installed document-editor validation (0.8.0 / 0.8.1)

- Installed VSIX 0.8.0, then 0.8.1, into the default VS2026 Community instance 4dee894c.
  VSIXInstaller exited 0 and installed manifest reports 0.8.1. VS2022 was not used;
  the user requested its live test only immediately before final completion.
- Installed Core 0.8.1 in `%LOCALAPPDATA%/PiAgent/runtime/0.8.1`, pipe `piagent-validation08`,
  standalone fixture repository `D:/source/PiAgentValidation08`, native OMP 18.6.0 ARM64.
  Original `piagent-dev` Core and RADAgent reference checkout were not changed.
- RAD13.2 Delphi37.0.60952.8797 uses the separate `PiAgentValidation08` registry profile.
  Its x64 IDE reads `Known Packages x64`; updating `Known Packages` alone initially left the
  previous development BPL loaded. Corrected the x64 entry and verified the actual loaded module
  is runtime/0.8.1/adapters/radstudio/Win64/PiAgent370.bpl. Its SHA-256 matches the build output.
- Both original WebView chat hosts ran real Anthropic Opus5.5/high turns. Approved WPF XAML
  SaveButton Width80→110 through IDE buffer/undo/save and VCL Width80→110 through ToolsAPI/RTTI.
  Real designers displayed the new sizes. WPF/VCL event handlers were generated by OMP and
  explicitly approved through `workspace_propose_edit`; their Git checkpoints were created.
- Built and launched both standalone document editors. Tested New, native Save dialog, UTF-8
  Korean text and Korean filenames, cleared the document, and reopened the saved file.
  WPF status reported58characters; VCL61characters. Strict UTF-8 file decoding passed.
  WPF build had zero warnings/errors; Delphi Win64 compiled successfully.
- Final IDE builds also passed: VS2026 Ctrl+Shift+B reported1success/0failures;
  RAD13.2 Ctrl+F9 reported Windows64Debug Success,0errors/0warnings/0hints.
  Latest VCL IDE executable is VclEditor/VclEditor.exe; the earlier CLI-built copy is in Win64/.
- VS0.8.1 approved a temporary trailing comment, opened `/restore`, reviewed the latest checkpoint,
  approved its inverse diff, and restored the exact original SHA-256 of MainWindow.xaml.cs.
- RAD0.8.1 performed the same explicit comment approval, checkpoint preview and restore sequence;
  Main.pas returned to its exact original SHA-256. Both document editor implementations remain intact.
- Repeated VCL designer inspect/approved Width110→120 on the confirmed installed0.8.1BPL:
  live form resized, Main.dfm saved120, Main.pas hash stayed unchanged.
- Fixed RAD draft retention/missing user bubble: selection-free adapter must not receive unsupported
  clearSelection actions. Core/UI regression suite now55passed; adapter integration13passed;
  VSIX and Delphi Win32/Win64 rebuilds passed. Actual RAD0.8.1 now displays the user message and
  clears the composer after the started acknowledgement.
- Host tools use OMP's supported essential loadMode, avoiding opaque xd:// write proxy calls.
  Always-ask OMP still prompts for direct host tools, followed by PiAgent's reviewed mutation card.

Scope: WPF and VCL on this ARM64 Windows machine (x64 RAD IDE through Windows compatibility).
WinForms, WinUI, FMX and native x64 hardware live tests remain separate work; this is not a claim
of full OMP feature parity or durable checkpoint coverage for native OMP/designer writes.

## 2026-10-04 RAD Studio 13.2 64-bit-only live repeat (0.8.1)

- Tested the separate PiAgentValidation08 profile in `Studio/37.0/bin64/bds.exe`.
  Verified IDE PE machine 0x8664 (AMD64) and its actual loaded package at
  `%LOCALAPPDATA%/PiAgent/runtime/0.8.1/adapters/radstudio/Win64/PiAgent370.bpl`.
  The host is Windows ARM64 running the x64 IDE through Windows compatibility.
- Sent a fresh real OMP chat turn through the installed BPL. User message appeared and
  the composer cleared. Approved `ide_designer_inspect` and `workspace_read_file`;
  the live VCL form inspection reported the existing SaveButton Width120.
- Reviewed and approved `workspace_propose_edit` for a single trailing validation comment
  in VclEditor/Main.pas (the proposed replacement also normalized line endings).
  Checkpoint `7158fe4f-1412-479b-a727-5362b0bf4511` was created. Opened `/restore`,
  selected that checkpoint and approved the inverse diff through the chat UI.
  Restored bytes exactly matched the pre-turn SHA-256:
  `91E1F24739F208DA8042EC1EA03D6F52C22445E55B4201F73CFE851807CB0656`.
- Launched VclEditor/VclEditor.exe and verified its PE machine 0x8664.
  Tested New, entered Korean text, saved `D:/source/PiAgentValidation08/rad64-실사용.txt`,
  cleared with New and reopened through the native file dialog. The same two lines and
  47-character count were displayed; strict UTF-8 decoding and exact content comparison passed.
- Repeated Ctrl+F9 in the actual IDE with Windows64Debug selected: Success,
  0errors/0warnings/0hints. This was an incremental IDE compile.
- No Win32 IDE, Win32 adapter build or Win32 executable test was run in this repeat.
  Current requested RAD live validation scope is 64-bit only. RADAgent was not modified.

This repeat validates VCL; it does not add FMX live coverage or native AMD64 hardware coverage.

## 2026-10-04 FMX / default designer workflow validation

- Added capability-selected GUI workflow guidance to Core: inspect the open form first,
  prefer supported designer operations with approval, preserve existing UI/UX, explain unsupported
  operations, and verify necessary source edits in the designer/build/run. Read-only mode remains
  inspection-only; native slash commands pass through unchanged. No chat UI layout was changed.
- Strict TypeScript build and regression suite: 57 passed, 0 failed. A real Named Pipe/OMP fixture
  test confirms guidance and selection context reach OMP with the read-only boundary intact.
- Packaged this development revision at artifacts/piagent-2026-10-04T06-48-35-151Z and installed
  it separately at `%LOCALAPPDATA%/PiAgent/designer-validation/runtime/0.8.1`. Restarted only the
  validation Core on piagent-validation08; the older production piagent-dev daemon was retained.
  The installed RAD Win64 BPL remains0.8.1; no adapter rebuild or Win32 test was needed.
- Created `D:/source/PiAgentValidation08/FmxEditor` with a real editable Main.fmx and basic
  New/Open/Save document editor. Fixed fixture-only integer ClientHeight/ClientWidth serialization
  and FMX Memo.Lines.Clear differences discovered during initial IDE loading.
- In RAD13.2 bin64/bds.exe, the actual FMX designer displayed the form and controls.
  A fresh real OMP turn requested SaveButton Width80→110 without naming designer tools.
  The recorded OMP prompt contained the default workflow guidance, and the model chose
  ide_designer_inspect, then ide_designer_set_property. Approved the OMP tool and PiAgent mutation
  card. ToolsAPI saved Main.fmx; a subsequent approved inspect reported framework=fmx, Width110,
  Height32 and Text=Save. The designer visibly widened the button. Main.pas SHA-256 was unchanged
  by that designer turn (later fixture-only IO refactoring is separate).
- Actual Windows64Debug IDE compiles succeeded with0errors/0warnings/0hints, including after
  the property edit. F9 launched the x64 application; its buttons, memo and Ready status rendered.
- Computer Use list_windows/list_apps did not expose the FMX application window despite its
  rendered appearance in the IDE screenshot. Runtime button clicks and native file-dialog flows
  therefore remain unverified; they are not reported as completed live interaction tests.
- Added FmxSmoke.dpr using the real FMX form resource and the same LoadDocument/SaveDocument
  methods as the button handlers. Win64 compilation and execution passed: serialized Width110,
  New, UTF-8 save, clear, reopen, text equality and Opened status. Independently decoded
  `D:/source/PiAgentValidation08/fmx-한글.txt` with strict UTF-8 and confirmed exact two-line contents.
  This is an in-process functional smoke test, distinct from runtime GUI clicks.
- Windows host remains ARM64 with x64 RAD/FMX compatibility execution. No Win32 or VS2022 test
  was run, and RADAgent reference files were not modified. Designer-native edits still have no
  Core Git checkpoint restore coverage.

## 2026-10-04 GUI harness 0.9.0

- Five packaged framework skills pass skill-creator validation. All 63 Node/Core tests pass,
  including release resource loading outside the checkout, invalid targets, approval denial,
  cancellation, read-only gating and old-adapter rejection. VSIX and RAD Win64 builds pass.
- `scripts/test-gui-harness.ps1` compiles/runs only Win64. Actual VCL/FMX objects verify control
  parentage, menu ancestry, common Action references, unchanged Owner, cycle/root rejection and
  read-only relationships. The streamed FMX example verifies native menu/toolbar/status composition,
  common New command execution and Unicode file save/load.
- Installed Core 0.9.0 at `%LOCALAPPDATA%/PiAgent/harness-validation/runtime/0.9.0`, native OMP 18.6.0,
  pipe `piagent-harness09`, workspace `D:/source/PiAgentValidation08`. RAD13.2 x64 validation profile
  `PiAgentValidation08` loads the BPL from that runtime (loaded module path verified).
- Live OMP tool results include schemaVersion 2, 19 FMX components, selected FMX skill and catalog.
  SaveButton.Action was deliberately empty in the isolated NativeEditor fixture. The real chat showed
  the OMP tool permission and concrete Core approval, then ToolsAPI saved Action=SaveAction.
  Reinspection confirmed SaveMenu and SaveButton share SaveAction. The .pas bytes stayed unchanged.
- Two separately approved reparent operations moved StatusLabel from StatusBar to EditorForm and back.
  OMP reinspection recorded each actual parentId and ownerId=EditorForm throughout. Final parent=StatusBar.
  Compiling/running the smoke against these IDE-saved resources passed. RAD's actual Win64 IDE build
  succeeded with 0 errors, 0 warnings and 0 hints. Desktop menu/dialog clicks and DPI behavior are not
  inferred from these functional checks.
- Existing RADAgent sources and PiAgent chat UI assets were not changed in this harness step.
  No RAD Win32 or VS2022 build/live test was performed in this cycle. Earlier validation sections
  describe historical releases and must not be read as current test coverage.
- Updated only VS2026 Community instance 4dee894c to VSIX 0.9.0 (installed manifest verified),
  reopened the same PiAgentEditors solution with pipe piagent-harness09. A real OMP inspect returned
  framework=wpf-xaml, schemaVersion=2, hierarchyKind=xaml-syntax-tree, harness.catalog.framework=wpf
  and eight XML nodes. The WPF source hash was unchanged by this read-only validation.
- WinForms/WinUI 3 guidance selection is covered by automated routing tests, not newly completed live
  framework tests. Modern .NET WinForms native bridge, component creation/deletion, batch structural
  transactions and a separately exposed MCP server are not implemented by this release.

## 2026-10-04 RAD Studio View / Tools menu patch

- Built the Win64 BPL with Delphi 37.0. Replaced IOTAMenuWizard's Help Wizards entry
  with owned View > PiAgent and Tools > PiAgent menu items using INTAServices.MainMenu.
- Tools rebuilds its submenu on opening. The adapter chains the original OnClick handler,
  then restores its owned item; unload restores the original handler and frees the items.
- Installed only this RAD adapter patch at
  `%LOCALAPPDATA%/PiAgent/adapters/radstudio/0.9.0-menu1/Win64`, preserving the Core 0.9.0
  runtime manifest and the RADAgent package registration. Verified loaded BPL path and SHA-256
  `8B9AC8D9AF68929DAA404F852DD2D33F786F7EDF1573CB0C1AE1FE5554E71BEE`.
- Live default RAD13.2 64-bit IDE showed one PiAgent entry in each menu. Tools opened the
  connected WebView chat; closing and reopening through View reused the same window handle
  (1705658) and connection. No chat HTML/CSS, RADAgent files, VSIX, or RAD Win32 build changed.
- Updated installation instructions and generated release README menu paths.
  `node --check scripts/package-core.mjs` passed. Earlier unsuccessful menu builds were
  replaced before this verification; their artifacts are not the installed patch.

## 2026-10-04 original icons and signing integration (authentication pending)

- Copied original RADAgent menu PNGs, ICO and VSIX extension PNG without changing the reference.
  Verified menu PNG and ICO hashes match the reference. Compiled SDK icon resources and Win64 BPL,
  transport/chat harnesses, Core/UI and VSIX. VSCT embeds the chat command menu icon; VSIX includes
  Resources/PiAgent.png. No RAD Win32 or VS2022 tests were run.
- Added default signed adapter builds, pre-container VSIX assembly signing, signed PipeHost and
  Sign CLI container signing, with expected-signer and signature validation. Negative test confirms
  verify-vsix.ps1 rejects an unsigned VSIX. PowerShell parser validation passed for signing scripts.
- USB certificate 3CE49DE1124F325082FA90BDE4944756D1626251 is present with private-key association,
  expires 2027-06-05. The SafeNet Token Logon prompt requires the user's PIN. An initial x64
  SignTool attempt found no usable certificate; native ARM64 signing is pending token authentication.
  Actual signing, signed release verification and installation of this icon build are not yet complete.
  Previously installed menu patch remains running. Do not treat integration as validated signing.

## 2026-10-04 signed unified setup and VSIX error 2004 repair

- Created `dist/PiAgent-Setup-0.9.0.exe` (210,278,024 bytes), SHA-256
  `846506283714C5C2ABFF65A1585F8639C7E1ACE6C7056349C9D2B1C7BD528394`.
  Setup, Win32/Win64 BPLs, PipeHost, VSIX and its first-party DLLs are signed with
  Nanum Space certificate `3CE49DE1124F325082FA90BDE4944756D1626251`.
  PE signature/timestamp checks, OPC content checks and independent Microsoft
  VSIXSignTool validation passed. Earlier authentication-pending notes above are historical.
- SafeNet on this ARM64 PC exposes the private key to x86 processes. SDK x86 SignTool
  and the pinned official Sign CLI source compatibility build completed signing.
  No PIN or private key was exported or stored. See CODE-SIGNING.md for build details.
- This PC detected ARM64, RAD13.2 Win32/Win64, VS2026 instance 4dee894c,
  VS2022 instance 8967bed4 and existing OMP under LocalAppData/omp.
  The user selected all four IDE components in the preview setup. A leftover
  VS2022 ServiceHub controller caused VSIXInstaller error 2004.
  Added `/shutdownprocesses`, resumable installation records, same-version repair,
  component-specific logs and explicit unattended component selection.
- Repaired this installation using the final signed setup. Final process exit code 0,
  completion at 20:18:20 KST. Both installed VSIX manifests report 0.9.1 and both
  installed first-party DLLs have valid expected-signer signatures. RAD 32/64
  registrations point to the signed setup-owned release. Previous PiAgent entries
  are backed up; the RADAgent reference and registrations were not modified.
  The original frozen VS2022 ServiceHub PID 17772 was stopped only after confirming
  no IDE processes were running. No running IDE was forcibly stopped.
- `scripts/test-installer.ps1` passed full embedded payload extraction/hash checks,
  and authenticated handshake/capability negotiation/Unicode ping using private
  Node 24.21.0 and .NET runtimes under both ARM64 and x64 emulation on this ARM64 PC.
  Native x64 hardware was not tested. Installer tests reject tampering, path traversal,
  existing extraction directories and unavailable IDE selection before registry writes.
  A signed VSIX container with unsigned embedded first-party DLLs is now rejected.
- Start Menu shortcuts and Windows Installed Apps entry were verified. Existing OMP
  is reused. The absent-OMP network download and uninstall flows were not executed
  against this PC. VS2022 and RAD Win32 installation were checked; this does not
  represent new live editor/designer functional tests in those IDEs.

## 2026-10-04 VS2026 authentication connection patch (VSIX 0.9.2)

- Reproduced `Cannot read authentication credential` in the live VS2026 App1
  solution at `D:/source/test/App1/App1.slnx`; retrying in the old VSIX failed.
  The existing secure Core, private token ACL and separate Node/C# handshake probes
  worked. VS ran as the same user and had the expected LOCALAPPDATA with no explicit
  PIAGENT_AUTH_FILE override. No credentials or token bytes were logged.
- Changed C# credential resolution to match Core's LOCALAPPDATA-first rule, retaining
  the explicit PIAGENT_AUTH_FILE override and Shell folder fallback only when the
  environment value is absent. Read failures now include path, error type and HRESULT
  for diagnosis; authentication, HMAC proof checks and token ACL were not weakened.
  The former in-process Shell folder result was not captured before the restart.
- Built/signed VSIX 0.9.2 and installed it only in VS2026. Saved/reopened the same
  App1 solution; the real pinned chat connected, showed the current model/effort
  and green connection state, with no credential error. A separate authenticated
  Core → OMP → live model test returned `연결 확인`; it requested no tool/file work.
- C# credential-location regression (LOCALAPPDATA and explicit override), eight UI
  tests and signed setup/payload/runtime tests passed. The disconnected unsupported
  action notice now points to connection recovery; original UI placement/assets
  were retained. VS2022 and RAD adapters were not newly installed or live-tested.
- Refreshed signed `dist/PiAgent-Setup-0.9.0.exe` to include VSIX 0.9.2;
  SHA-256 `010B898C584B35BB4A24751A95E15BB663B38D367CF8D9E76A051E3397D7DD2D`.
  The installed Core workspace configuration was retained; this authentication patch
  does not implement automatic workspace switching between Visual Studio solutions.

## 2026-10-04: shell-launched VS2026 authentication and Core bootstrap (VSIX 0.9.3)

- Corrected the earlier 0.9.2 conclusion: the successful IDE had inherited the
  Codex launch environment. GetFinalPathNameByHandleW showed the old logical AppData
  token actually resided under OpenAI.Codex's package LocalCache. A user-launched
  IDE could not access that token at the logical path.
- Core, C# transport and Delphi transport now share
  `%USERPROFILE%/.piagent/security/<pipe>/token`; explicit PIAGENT_AUTH_FILE still
  overrides it. The private user-only ACL and HMAC authentication remain enabled.
  VSIX starts the installed bundled Core when absent and reuses an existing Core.
- Signed VSIX 0.9.3, RAD Win32/Win64 adapters and unified setup were built and
  installed. Setup returned 0. Existing workspace/native OMP/write settings were
  preserved and 12 previous saved sessions were copied without copying the old key.
- Cold test: stopped the previous Core, opened App1 using an Explorer shortcut
  targeting VS2026. Explorer PID 20820 launched devenv PID 21348, which started
  bundled ARM64 Node/Core PID 31496. The pinned original chat showed its model,
  effort and green connected indicator with no credential error.
- Warm restart: closed VS normally and reopened from Explorer. New devenv PID 5008
  connected successfully while Core PID 31496 remained unchanged. A separate
  authenticated Core -> OMP -> live model test returned `연결 확인` with no file/tool work.
- Strict TypeScript build, 15 security/UI tests, .NET Framework cold startup/reuse,
  signed setup payload checks and both bundled ARM64/x64 authenticated runtime
  probes passed. VS2022 and RAD were updated for the shared credential path but
  were not live-tested in this authentication task.
- Setup SHA-256: `781FC950536EA053A74605E049CFFE34D69F8EAACF8716DA22E0C23C03ED2197`.
  GetFinalPathNameByHandleW confirmed the new key's physical location is
  `C:/Users/kimmi/.piagent/security/piagent-dev/token`, outside the Codex cache.
  Adapter integration tests now use the package's current build version rather
  than stale 0.7.0 harnesses; the batch OMP fixture recognizes the real designer
  workflow prefix. All 14 C#/Delphi transport/chat integration tests passed.
  Core remains scoped to the previously configured PiAgent workspace; automatic
  switching to App1 is outside this authentication fix.

## 2026-10-04: access modes, solution binding and original + menu (0.9.4 candidate)

- Root causes: bridge.ts disabled approval-select and plus-btn unconditionally;
  Controller always emitted always-ask and did not handle setApproval/plus actions.
  ChatControl never sent an IDE workspace; Core reused its configured PiAgent cwd.
- Implemented authenticated per-connection workspace binding, solution open/close
  lifecycle, per-workspace private sessions, persistent per-chat access modes and
  restart/resume of OMP with its explicit native approval-mode flag. No automatic
  Git init is performed. Non-Git native projects are usable without checkpoint tools.
- The original + menu now routes attachments, folder references, extension metadata,
  MCP toggles/config editing, plugin toggles and IDE compilation. Reference renderer,
  CSS and icons remain unchanged. No tool secrets are included in extension metadata.
- Full Core suite: 66 passed. Additional UI/mode/plus/scope tests: 11 passed.
  Actual OMP 18.6 native startup on a no-Git solution tested all four mode changes,
  retained one savedSessionId and matched each runtime config, without model prompts.
  Strict TS and VSIX/RAD Win32/Win64 development builds succeeded.
- DPAPI SecureString storage round-tripped from Windows PowerShell to x86 Windows
  PowerShell. CSP helper compiled on x86; no PIN was submitted by this test.
- Candidate is not yet installed or represented as a completed signed release:
  USB SignTool requested Token Logon, with no encrypted PIN registered. That blocked
  signing process was stopped without typing into the authentication dialog.
  User must run set-signing-pin.ps1 once locally; actual encrypted-PIN token unlock,
  final signed setup and live VS2026 verification remain pending.

## 2026-10-04: signed VS2026 deployment and transport control regression (0.9.5)

- The actual VS2026 instance still contained VSIX 0.9.3 and an older Core while
  the access-mode/workspace/+ changes existed only in source. The running NanumPDF
  solution therefore used the PiAgent workspace and disabled both composer controls.
- Live testing of the 0.9.4 installation exposed another cause: C# RequestAsync
  did not allow chat.setApproval or chat.extensions. Added both methods and a
  60-second deadline for OMP restart/extension operations to C# and Delphi transport.
- A C# integration regression now authenticates over the real pipe, binds a
  different IDE workspace, cycles write/yolo/plan/always-ask, preserves the saved
  conversation and workspace, and lists a fixture plugin. All 15 adapter integration
  tests and 19 affected chat/UI/workspace tests passed.
- Installer upgrades now preserve owner pipe, OMP executable, workspace, write
  setting and OMP profile, while changing the bundled Node path to the new release.
  Malformed settings fail instead of resetting the access policy. Installer tests passed.
- Signed first-party DLLs/BPLs, VSIX container and unified setup verified with the
  expected Nanum Space signer and timestamps. Setup embedded hashes and actual
  bundled ARM64/x64 authenticated handshake/capability/ping probes passed.
  Setup SHA-256: F97E42076F6896EF4B9083175A650B51BA450BE16A1619CF4A1C5B15D39F5322.
- Installed core,vs26 with the unified setup and reopened NanumPDF. VS2026 reports
  VSIX 0.9.5; receipt release is 0.9.0-20261004131345. Core bootstrapped automatically
  with its bundled native ARM64 Node. The installed signed Transport DLL also passed
  all four mode changes and extension listing against this running production Core
  in a separate probe workspace, preserving its savedSessionId.
- Live WebView verification: NanumPDF workspace badge/path; enabled access selector
  and all four options; file selection starting at the solution directory; actual
  NanumPDF.sln and NanumPDF folder attachment chips; MCP/plugin submenus without
  transport errors. No MCP servers or plugins are installed, so lists are empty;
  live toggling of installed extensions was not exercised.
- A real OMP chat answered NanumPDF and C:/Users/kimmi/source/repos/NanumPDF from
  the attached references. No project edits or commands were requested by that probe.
  The IDE remains open on the user's solution, with the chat response displayed.
- Only VS2026 and Core were selected for this installation; VS2022 and RAD live
  validation were not performed in this pass. Encrypted-PIN provider caching remains
  a separate unverified feature; authentication dialogs were not automated.

## 2026-10-05 chat UI implementation (development build)

- Core strict TypeScript build and `npm test`: 83/83 passed. New regression tests include BTW process isolation,
  preferences acknowledgement/schema/concurrent writes, immutable plan execution, image payload/bounds,
  native/designer observed file checkpoint restoration, schema migration, old-owner replies, all 33 renderer actions,
  tool argument ownership and actual secure Named Pipe services.
- `tests/adapters.integration.mjs`: 15/15 passed, including C# preferences/files/export/BTW and Delphi Win64 chat
  worker new UI services plus approval/restore/resume. Transport-only fixtures for VS2022/Win32 are metadata tests;
  no VS2022 or RAD32 IDE runtime acceptance was performed.
- VSIX 0.9.6 and RAD Studio Win64 BPL compiled with `-SkipCodeSign`. Native RAD selection snapshot uses
  IOTAEditorServices.TopView.Block; actual IDE selection/dirty document acceptance remains pending.
- Actual bundled page in WebView2: BTW composer and notes failures preserve drafts, successful composer ack clears
  the draft, folded answer cards/notes render, five settings areas and save failure work, @ files autocomplete,
  no JS/CSP errors. Twelve docking/tab/hide transitions preserve browser/DOM/Korean draft.
- Actual OMP 18.5.0 and separately downloaded 18.6.0 executables passed discovery/private session/export/add-dir
  with a space-containing folder, BTW model answer 4 and resumed follow-up 8, and byte-unchanged main session.
  These are isolated tool-free model probes, not production IDE project validation. Installed OMP was not upgraded.
- Evidence: artifacts/chat-ui-implementation/{tests.log,adapters.log,build.log,webview.log,real-omp-18.6.log}.
- Installed signed VSIX 0.9.5 / setup F97E42076F6896EF4B9083175A650B51BA450BE16A1619CF4A1C5B15D39F5322
  remain unchanged. USB signing credential DPAPI file is absent; no PIN dialogs were automated.
- Message-level conversation/file branching restore, complete native checkpoint coverage and installed VS2026 +
  RAD13.2 Win64 feature acceptance remain pending. See CHAT-UI-IMPLEMENTATION.md for exact support boundaries.

## 2026-10-05 message timeline and installed acceptance update

- Current unsigned dev VSIX 0.9.8 and RAD13.2 Win64 BPL are installed on this ARM64 PC.
- Full regression 89/89; authenticated C#/Delphi adapter integration 15/15; shipped WebView2 UI passed
  message branch/restore, failed plan ack recovery, CSP checks and twelve docking transitions.
- Actual VS2026 and RAD64 cold bootstrap, own project binding, actual OMP model/approval, conversation branch,
  message restore and source-session preservation verified. VS CRLF bytes restored and dirty editor blocked.
- Actual FMX ToolsAPI Caption changed under approval, then original fmx bytes restored. Found and fixed stale
  designer state via IOTAModule.Refresh; repeated live test restored Object Inspector/loaded form values.
- Actual VS pinned tab return, + IDE build, MCP off/on/off, linked local plugin off/on, plan/hash rejection,
  usage and both IDE native HTML export verified. Test plugin was removed; unrelated global settings preserved.
- Evidence and remaining per-action installed UI cases are in MESSAGE-TIMELINE-AND-INSTALLED-ACCEPTANCE.md.
  This is not a claim that every installed UI scenario passed. Signed installer creation remains on hold.
- Latest acceptance release: `0.9.0-acceptance-20261004202000`, package `piagent-2026-10-04T20-17-13-590Z`.
- Both IDEs passed live cancellation/reuse, independent BTW stop, queued follow-up cancellation, model/thinking
  and four access modes, native source-reference opening, copy, settings title/state preservation, selection
  round-trip, @ completion, MCP/plugin off/on and private folder addition. RAD plan/revise/proceed completed a
  real FMX inspection without writes. VS actual OMP subagent 3+4=7 and detailed log sheet passed.
- Found and fixed unanswered abort RPC timeout, preferences resetting dynamic header/busy state, RAD MCP
  editor not showing, Pascal-only file references and unowned legacy RAD folder-picker modality.
- `timeline-conditional-webview.log` validates the **installed** UI assets in real WebView2, including a
  controlled provider-retry cancellation and twelve dock/tab/hide transitions. Actual provider failure was
  not induced. Test plugin removed; original global plugin settings restored.

## 2026-10-05 version 0.9.9 release preparation

- Root/workspaces/VSIX/setup versions aligned to 0.9.9.
- Fresh regression 89/89, adapter integration 15/15, VSIX and RAD Win32/Win64 builds passed.
- Unified installer payload hashes and bundled ARM64/x64 authenticated runtime probes passed;
  setup diagnostics detected both RAD architectures and VS2022/2026. Installer safety tests passed.
- Final installed acceptance additionally verified VS native MCP editor and RAD actual subagent log
  (3+4=7 / Result submitted). RAD HTTPS click opened another Edge Example Domain tab; final
  browser capture stopped because Computer Use could not enforce URL policy with confidence.
- User explicitly requested signing and release and registered the DPAPI PIN locally.
  Actual USB CNG signing of DLLs, Win32/Win64 BPLs and VSIX passed with expected certificate,
  trusted chain and timestamps. No PIN dialog automation or plaintext credential is used.
- Signing regressions passed: silent CNG signing/tamper rejection/no private export, DPAPI x86/native,
  malformed credential/DTD rejection, no-prompt failure, PE timestamps and VSIX signatures.
- See RELEASE-0.9.9.md and MESSAGE-TIMELINE-AND-INSTALLED-ACCEPTANCE.md for remaining limitations.
- Signed setup passed expected Authenticode certificate and RFC3161 timestamp validation,
  complete embedded payload verification, ARM64/x64 runtime handshake/ping and installer safety tests.

## 2026-10-05 settings layout correction (0.9.10)

- Dedicated settings CSS preserves the reference chat styles. Horizontal keyboard-accessible tabs,
  theme-aware controls, scrollable content and footer actions replace unstyled popup rows.
- Core reports its package version. Developer identity: 김민걸 (Min-Gul Kim), mgkim@jbnu.ac.kr.
  On compact views the footer retains the version; Advanced contains the full developer information.
- Full regression 89/89, including the version returned over the authenticated preferences RPC.
- Real WebView2 passed 100/150/200% zoom with wide/narrow viewports, footer containment and usable
  scrollable content; save-success acknowledgement, save failure and cancel-without-saving passed.
- Screenshot inspection: `artifacts/settings-ui-preview/settings-{0,1,2}.png`; runtime log in the same folder.
- This verification uses an isolated WebView harness, not a claim that the running IDE has been upgraded.

## 2026-10-05 OMP management expansion (development working tree)

105/105 automated tests passed, including project role/preset scope, YAML preservation/link rejection,
schema allowlisting, private-path filtering, and authenticated pipe compaction admission/lifecycle.
The final bounded snapshot/disconnection adjustment passed all 7 new targeted tests again.
WebView2 validated the new Advanced management UI without replacing settings tabs; 100/150/200% layout,
12 docking/tab/hide transitions and JavaScript/CSP checks passed.
VSIX and RAD Win64 builds passed without code signing; both contain the compiled execution UI.
Installed OMP 18.6.1 version/settings discovery passed without changing user settings.
Installed IDE upgrades and native feature acceptance remain pending. Full scope/status:
[OMP implementation](OMP-FEATURE-IMPLEMENTATION.md).

## 2026-10-05 installed acceptance defect corrections

Six defects from INSTALLED-ACCEPTANCE-0.9.14.md were corrected in source. Regression 111/111,
real Delphi Win64 worker/pipe integration 1/1, and real WebView2 58 PASS outputs completed.
Signed VSIX/RAD Win64 adapter builds and packaged Core handshake/version/capability/ping under
Node 24.21.0 ARM64 passed. The WebView harness uses a mock host; it is not installed IDE acceptance.
Signed candidate installed as `0.9.14-acceptance-20261005025432` after the user closed both IDEs.
Live RAD FMX/VCL switching rebound before the first prompt; VCL first response returned 42.
Both IDE settings layouts and VS branch preview passed. Running installed Core version/preferences/ping
and safe native compaction failure reason passed. Other PARTIAL/MANUAL cases remain separate.
An additional native `/compact` composer path correction passed regression 112/112 and WebView2 58 PASS
outputs. After the user reconnected the USB certificate, re-signing and installation completed as
`0.9.14-acceptance-20261005051004`. Live VS2026 and RAD13.2 Win64 chat both displayed the safe Korean
short-session compaction reason and recovered to an idle, usable composer. Installed adapter hashes and
signatures passed; ARM64 Node authentication/handshake/ping and running installed Core probes passed.
See [acceptance fixes](ACCEPTANCE-FIXES-0.9.14.md) for evidence, candidate and remaining checks.
