# PiAgent 0.7.0 validation

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
