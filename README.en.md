# PiAgent

[한국어](README.md) · **English** · [Documentation / 문서](docs/README.md)

Current version **0.9.19** · signed prerelease **0.9.19** · documentation updated **2026-10-08 KST**.
Developer: **Min-Gul Kim (김민걸)** · [mgkim@jbnu.ac.kr](mailto:mgkim@jbnu.ac.kr).

[Product website](https://kimmingul.github.io/PiAgent/?lang=en) ·
[0.9.19 prerelease](https://github.com/kimmingul/PiAgent/releases/tag/v0.9.19).
Source code and signed installers are available in the public `kimmingul/PiAgent` repository.

PiAgent has an IDE-neutral Core built with Node.js 24 LTS and TypeScript strict/ESM.
C# VSIX and Delphi BPL adapters connect through authenticated Named Pipe JSON-RPC;
Core communicates with OMP through `--mode rpc-ui` JSONL.
It preserves RADAgent's WebView UI/UX; the RADAgent repository is not modified.

## Current use and installation

The signed installer is `dist/PiAgent-Setup-0.9.19.exe`. On the validation PC, Core and RAD32/64
were updated and duplicate RAD BPL registrations were removed. Building or publishing a release
does not automatically replace an installation in a running IDE. Close the target IDEs before installing.
Select Core, RAD13.2 32/64-bit, VS2022/2026, and optional OMP installation if OMP is absent.
[Installation guide](docs/INSTALLATION.en.md) · [Unified installer](docs/UNIFIED-INSTALLER.md).

- VS: **Tools → PiAgent: Open Chat**.
- RAD: **View → PiAgent** or **Tools → PiAgent**.
- Adapters installed through the unified setup start Core automatically or reuse the existing Core.
- Per-user installation root: `%LOCALAPPDATA%\Programs\PiAgent`, with a runtime for each release.
  On Windows ARM64, Node/.NET/OMP use ARM64; the setup runs through x64 compatibility.

The earlier 0.9.18 RAD validation receipt points to `0.9.18-20261007162727` and records VS2022/2026 and RAD32/64
registrations. Installation records do not prove live testing. Current live validation prioritizes
**VS2026 and RAD13.2 64-bit**. Final VS2022 validation and RAD32 UI validation are not claimed as complete.

## Language selection

Choose `Automatic`, `한국어` or `English` under **Settings → Display → Language**. The default `Automatic` uses Korean on Korean systems and English otherwise. An explicit choice is saved in private settings for the current project and reused on the next launch. Settings, accounts, model roles, execution controls, Git and approval guidance switch together. Model replies, code and external tool text are not automatically translated.
The installer also offers Korean/English selection at the top right. The website remembers your selection and supports direct [Korean](https://kimmingul.github.io/PiAgent/?lang=ko) / [English](https://kimmingul.github.io/PiAgent/?lang=en) links.
[0.9.19 changes and validation](docs/RELEASE-0.9.19.en.md).

## Current features and validation

0.9.18 distinguishes OMP tool approval from the IDE designer's edit restrictions. Approval cards explain
the operation's scope; unsaved edits, read-only source and unavailable modification services have specific
recovery guidance. [0.9.18 changes and validation](docs/RELEASE-0.9.18.en.md) ·
[RAD diagnosis and usage](docs/RAD-DESIGNER-DIAGNOSTICS.en.md).
The full regression suite passed **143/143**; C#/Delphi adapter integration passed **17/17**.
In RAD13.2 64-bit, real model turns inspected, changed, saved and reinspected existing VCL/FMX form properties;
builds and running application windows were also checked.
Creating/deleting controls and generating event handlers remain outside the native designer tool surface
and require approved source edits.

0.9.17 fixes leftover saved-session locks that prevented reopening the last conversation.
It rejects actual duplicate connections and safely recovers sessions whose owning Core/OMP has exited.
It also improves cleanup after session startup failure or disconnection during startup.
An existing VS2026/NanumPDF conversation was reopened with its history and data preserved.
[0.9.17 changes and validation (Korean)](docs/RELEASE-0.9.17.md) · [Session recovery diagnosis](docs/SESSION-RECOVERY-FIX.md).

0.9.17 passed the full regression suite **140/140**, adapter integration **17/17**, and packaged WebView checks.
Setup/adapter signatures and timestamps, embedded file hashes, and ARM64/x64 runtimes were verified.

The release also includes 0.9.16's 60-second VS/RAD transport preparation limit, batched Git snapshot reads
and VS reconnection after sleep. Messages are not automatically resent.
[0.9.16 history (Korean)](docs/RELEASE-0.9.16.md).

Features include streaming chat, cancellation, BTW side questions, settings/UI login, model/effort selection,
OMP roles/presets, attachments/selected code, workspace autocomplete, MCP/plugins, export, saved-session
resume, message branching/restore, multi-file approval/checkpoint restore, usage, execution controls,
subagent management and the GUI harness.
Unused empty sessions can be deleted after confirmation. Sessions containing chat, BTW, branch/restore
data or active ownership are protected. Features depend on OMP profile, negotiated capabilities and IDE support.
[UI implementation (Korean)](docs/CHAT-UI-IMPLEMENTATION.md) · [GUI harness](docs/GUI-HARNESS.md).

Remaining work such as Goal, the full session tree/handoff, worktree integration, SSH/background management
and extension custom UI is tracked in the [OMP progress document (Korean)](docs/OMP-FEATURE-IMPLEMENTATION.md).
PiAgent checkpoints do not necessarily restore every change made by native tools or in additional folders.

Forced idle disconnection after authentication and the fixed ten-minute turn limit were removed.
Handshake/frame/ACK deadlines and explicit cancellation remain; interrupted prompts are not automatically resent.
At that stage, the full regression suite passed **118/118**, a Named Pipe fixture ran for **631 seconds**,
and WebView2 smoke produced **57 PASS** checks.
An installed VS2026/NanumPDF task ran on 2026-10-05 from 18:58:30 to 21:35:54 KST, about 2 hours 37 minutes,
and reached a real final response and Core `completed` record. This validates long-running execution,
not every feature's live behavior. [Long-running task record (Korean)](docs/LONG-RUNNING-TURN-FIX.md).
PARTIAL/MANUAL items in the earlier [acceptance record (Korean)](docs/INSTALLED-ACCEPTANCE-0.9.14.md) remain.

0.9.15 fixes premature termination when a native OMP provider reports an individual error during retries.
Tool output, final answers and the saved transcript survive automatic retry; termination occurs at final settlement.
[Retry diagnosis (Korean)](docs/PROVIDER-RETRY-DIAGNOSIS-20261006.md) ·
[Local installation validation at that time (Korean)](docs/LOCAL-PREVIEW-0.9.15.md).

The 0.9.15 development build also introduced a collapsible task list, local Git preview/confirmed first commit,
and automatic resumption of the last conversation per project.
[Local Git and session resume (Korean)](docs/LOCAL-GIT-AND-RESUME.md).

## Current development commands

```powershell
npm ci --ignore-scripts
npm run build
npm run build:transport
npm test
npm run test:adapters
# The default RAD build is Win64; the unified installer includes both IDE bitnesses.
& .\scripts\build-adapters.ps1 -RadPlatforms Win32,Win64
& .\scripts\build-installer.ps1
```

Requires Node 24.21.0 or later in the 24 LTS line, .NET SDK, and VS MSBuild/RAD compiler for adapter builds.
Core uses shared x64/ARM64 JavaScript without Rust or native npm addons. `package.json` is the single source
for generated package versions. Signing uses a USB certificate and Windows encrypted storage;
PINs are never recorded in documentation or the repository. [Code signing](docs/CODE-SIGNING.md).

The CLI defaults to the `restricted` profile. Native development runs explicitly use
`--omp-profile native --allow-writes`; IDE binding uses the open project.
Distinguish installed execution from older manual launch instructions.

## Early history and manual development examples

The 0.2–0.7 descriptions and test counts below are historical. Use the current instructions and linked
documents above for installation, features and validation.

0.7.0 provides **VS 2022/2026 and RAD Studio WebView chat, approval and restore**, **automatic session save/resume**,
**session tokens/costs and account limits**, and **multi-file approval/restore**.
[Installation](docs/INSTALLATION.en.md) · [Sessions/usage (Korean)](docs/SESSIONS-USAGE.md) ·
[Validation history](docs/VALIDATION.md).

0.6.0 adds **diff preview → individual approval → file apply → Git checkpoint restore**.
It is available from VS Chat in a secure workspace with explicit `--allow-writes`.
[Approved changes: usage and limitations (Korean)](docs/APPROVED-CHANGES.md).

0.5.0 adds **current-user-only Named Pipes and mutual authentication**.
The CLI uses the secure Windows pipe host by default; VS/Delphi adapters discover credentials per pipe.
[Settings and security (Korean)](docs/SECURITY.md). A .NET 8+ runtime is required in addition to Node.js.

0.4.0 adds **workspace file reads and search**. Specifying `--workspace` lets VS Chat find, read and explain project files.
[Execution and limitations (Korean)](docs/WORKSPACE-TOOLS.md).

In 0.3.0, **selected-code capture** in VS Chat previews code before attaching it to a question.
[Selection context: usage and contract (Korean)](docs/SELECTION-CONTEXT.md).

Core uses Node.js 24 LTS with TypeScript strict/ESM. RAD Studio Delphi BPL and Visual Studio 2022/2026 C# VSIX
adapters connect through Named Pipe JSON-RPC; Core communicates with a separate OMP child over
`omp --mode rpc-ui` JSONL.
The initial implementation included daemon, adapter handshake/version/capability negotiation/ping,
simulator, OMP process manager, C# VSIX/Delphi BPL connection menus, transport and tests.
0.2.0 provides OMP text sessions, streaming, cancellation and a VS WebView chat UI.
Standalone archives contain shared x64/ARM64 Core, VSIX, Win32/Win64 BPLs and install/start/uninstall scripts.

- [Architecture](ARCHITECTURE.md): Rust removal/retention history, workspace, reference mapping and extension boundaries.
- [Protocol](PROTOCOL.md): binary framing, capabilities, errors and the OMP JSONL contract.

## Preparation and build

The early setup used Node.js 24.21.0/npm, the latest LTS at the recorded date of 2026-10-03.
`.nvmrc` and engines pin the 24 LTS line; `package-lock.json` pins development dependencies and workspace links.
Windows x64/ARM64 runs the same JavaScript output without native addons or an MSVC/Rust toolchain.

```powershell
npm ci --ignore-scripts
npm run build
npm run build:transport
npm run typecheck
npm test
```

`packages/piagent-{protocol,core,daemon,omp}` are npm workspaces. They use TypeScript project references,
NodeNext ESM, strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes.
The original dependency description at this stage listed only TypeScript/@types/node development dependencies
and no external runtime dependencies; consult current package manifests for the current dependency set.

## Daemon and adapter probe

Terminal 1:

```powershell
npm start -- --pipe piagent-dev
```

Terminal 2:

```powershell
npm run probe -- piagent-dev rad-studio 13.2
npm run probe -- piagent-dev visual-studio 2022
npm run probe -- piagent-dev visual-studio 2026
```

The probe requests `core.ping` as a required hello capability and verifies the result and Unicode nonce pong.
Mismatches/RPC errors result in a nonzero exit. Daemon logs go to stderr; the pipe carries only JSON-RPC.
Stop with Ctrl+C. Authenticated connections do not close merely because they are idle;
incomplete frames and other bounded operations retain deadlines.

## Optional OMP connection

OMP uses a separately installed executable. The default daemon does not automatically start OMP.
On Windows, specify `omp.exe`, rather than a `.cmd`/`.bat` shell wrapper.

```powershell
npm start -- --pipe piagent-dev --omp "$env:LOCALAPPDATA\omp\omp.exe" --cwd D:\source\PiAgent
```

In this historical restricted example, `chat.v1` is offered; `chat.open` starts an OMP child per connection,
and chat is accepted after JSONL v1 ready/new_session. OMP tools are disabled.
Run a read-only connection smoke in a separate temporary workspace:

```powershell
npm run omp:smoke -- "$env:LOCALAPPDATA\omp\omp.exe" C:\path\to\scratch-workspace
```

Smoke checks only ready/get_state and exits OMP without an LLM call.
The process manager provides a ready gate, ID/command correlation, frame limits, timeouts, stderr draining,
normal EOF shutdown and forced termination fallback. The early implementation did not yet support v2 chunking
or full subprocess-tree cleanup; this statement describes that historical stage.

## Validation and support boundaries

`npm test` uses node:test to validate protocol, actual Windows Named Pipes, standalone CLI and fake OMP.
Real pipe tests are skipped on other operating systems; the production daemon also rejects non-Windows execution.
All tests should run on Windows. Live OMP smoke depends on the installed environment and is opt-in.

On the recorded Windows ARM64 PC, 2026-10-04 checks passed 43 Core/UI tests for 0.7.0 under both
Node 24.21.0 ARM64 and x64 Windows emulation, plus 13 adapter tests.
Live IDE evidence is recorded in [VALIDATION.md](docs/VALIDATION.md).
The x64 test runtime was verified against official SHA-256; emulated x64 results are distinct from native x64-PC results.
The installed OMP also passed ready/get_state smoke. To verify with a chosen runtime:

```powershell
& .\scripts\test-windows.ps1 -NodeExecutable C:\path\to\node.exe
```

The x86/Win64 Delphi transport harness and BPL builds were verified.
x86 Core runtime distribution remains future scope. See [SECURITY.md](docs/SECURITY.md) for pipe authentication/ACL boundaries.
Enable approved edits/checkpoints with `--allow-writes`. Large numeric RPC IDs must be sent as strings.

`D:\source\RADAgent` is a read-only reference. Session/approval/checkpoint/usage/WebView planning is recorded
in [ARCHITECTURE.md](ARCHITECTURE.md) and [ui/README.md](ui/README.md).
Rust source/Cargo files were removed; Git-excluded `target/.tools` caches and the global Rust installation
are not referenced by the active project.

## IDE adapter builds and validation

```powershell
& .\scripts\build-adapters.ps1
npm run test:adapters
```

Requires Visual Studio MSBuild, .NET 10 SDK for the smoke harness, and the RAD Studio compiler.
The script discovers the latest installed Visual Studio/RAD Studio or accepts `-MsBuildPath` / `-BdsRoot`.
The earlier script built both Delphi bitnesses without installing IDE packages or modifying the registry;
the current script defaults to Win64, with both bitnesses explicitly selected for unified installer builds.
VS2022/2026 MSBuild and RAD Studio 13.2 Win32/Win64 builds were verified on 2026-10-03.
Eight adapter tests at that stage checked actual Core connections, Unicode nonce, cancellation,
oversized responses, C# chat streams, selected code and workspace tools.

Installation/menu procedures: [Visual Studio adapter (Korean)](adapters/visualstudio/README.md) ·
[RAD Studio adapter (Korean)](adapters/radstudio/README.md).
VSIX was installed in separate `PiAgentTest` profiles for VS2022/2026. After VS2026 18.10.3 update,
package loading, Tools menu execution and hello/capability/ping OK in PiAgent Output were checked.
The 0.2.0 UI was tested with actual question/answer streaming, cancellation, new conversation and OMP cleanup on IDE exit.
VS2022 PiAgentTest also passed actual menu hello/ping, chat streaming/completion, new conversation and OMP cleanup on exit.
The RAD adapter README records its live host results. [Detailed validation history](docs/VALIDATION.md).

## VS chat use in 0.2.0

```powershell
npm run build
npm start -- --pipe piagent-dev --omp "$env:LOCALAPPDATA\omp\omp.exe" --cwd C:\path\to\workspace
```

In the profile with the new VSIX, open Tools → PiAgent: Open Chat and connect.
Enter sends; Shift+Enter inserts a newline. Cancel while a response is running.
New conversation closes the old OMP session and starts another. Hiding/reopening the window preserves the conversation.
Disconnection/IDE exit cleans up the session. Set `PIAGENT_PIPE_NAME` before starting the IDE to change the endpoint.
WebView2 Runtime is required; its SDK DLLs/loader are included in the VSIX. Node Core needs no native npm dependency.
The minimal TypeScript UI referenced RADAgent's composer/bridge pattern without changing the source repository.
0.2.0 supported only plain text. See current features above for slash commands, attachments and file edits.

Actual model-call smoke uses installed OMP credentials and incurs model usage:

```powershell
node scripts/chat-smoke.mjs "$env:LOCALAPPDATA\omp\omp.exe" C:\path\to\scratch-workspace
```

Automated tests use deterministic fake OMP; this command is opt-in.
The real OMP 18.5.0 returned `PiAgent chat verified` through ready/new_session/prompt/text delta/agent_end.

## Standalone archives

```powershell
npm run package
# Include VSIX and Win32/Win64 BPLs after building the adapters.
npm run package:adapters
```

Packaging creates a fresh `artifacts/piagent-<UTC timestamp>` directory with actual ESM package files
and a SHA-256 `release-manifest.json`, rather than workspace junctions.
It runs on Windows x64/ARM64 with Node 24 LTS, without the repository, npm install or TypeScript compiler.
Node/OMP/IDE runtimes are installed separately in this older archive workflow.

```powershell
node core.mjs --pipe piagent-dev
# In another terminal:
node probe.mjs piagent-dev test-adapter release
```

Release tests run daemon/probe from a temporary archive folder and check hello/pong and all file hashes.
Adapter archives retain the compiler version used to build their BPLs. Rebuild with the target SDK for a different RAD Studio version.
