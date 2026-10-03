# PiAgent 0.2.0 validation

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
Current chat is ephemeral and tool-free. Named Pipe identity/ACL hardening is still required before
exposing privileged IDE/file capabilities.
