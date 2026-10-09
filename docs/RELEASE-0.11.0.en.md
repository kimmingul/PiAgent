# PiAgent 0.11.0 — UNRELEASED CANDIDATE

[한국어](RELEASE-0.11.0.md) · **English** · [Candidate guide](IDE-AGENT-INTEGRATION.en.md)

Status as of 2026-10-09: **development candidate; not a published 0.11.0 distribution**.
Source now reports 0.11.0 candidate. Earlier live acceptance and running-soak
receipts retain their actual 0.10.0 binary identities; final 0.11.0 acceptance is
separate. This document records the proposed release's implementation and evidence.
The M0–M6 plan is not complete. The four-hour soak, final regression/package gates
and formal comparative evaluation remain separate requirements.

The candidate expands the existing Core/OMP/Named Pipe architecture with actual
IDE context, reviewed changes, runtime evidence and recovery. SDK calls remain in
the VS and RAD adapters. Availability follows the connected installation rather
than a fixed list of tools.

## Improvements and milestone status

| Milestone | Implemented candidate behavior | Evidence and remaining scope |
|---|---|---|
| M0: foundation | Additive `ide.catalog.v1`, typed operation availability/reasons, implementation versions and workspace/revision binding; `/ide` and settings show the last published snapshot | Catalog ownership, malformed payloads, legacy compatibility and operation gating tested. Existing adapter result shapes are preserved; no invented universal completion state |
| M1: context and build | Rich project/document/configuration/dependency context; VS native targeted build/rebuild/clean; RAD native completion notifier and deliberate external MSBuild backend | VS native fixture builds passed. RAD external diagnostics are provenance-labeled and may be stale; native compiler-message enumeration is unavailable |
| M2: changes and editor | Immutable semantic/designer proposals, concrete consent, five-minute expiry, single-use tokens and revision revalidation; bounded Unicode cursor context and safe new-file identities | WPF/WinForms C# two-file rename/apply/native Undo and stale-preview refusal passed. RAD explicit editor acceptance uses its undoable writer; broader IME/provider coexistence remains an acceptance gate |
| M3: tests and debugger | VS external VSTest/TRX targeting, richer native debugger controls; RAD explicit DUnitX/NUnit XML runner and bounded ToolsAPI debugger operations | VS live test/debug scenarios passed. RAD runner/parser/CPU/process fixtures passed; broader live debugger/test workflows remain to be accepted |
| M4: designers | Reviewed creation/deletion/event binding and separately reviewed source/form/resource checkpoint restoration; bounded typed nested RAD properties | WPF and .NET Framework WinForms native fixtures passed. RAD VCL/FMX strong saved-state assertions and generated-stage builds passed; production structural tools require strict saved standard-form/type/parent guards |
| M5: performance and local workflow | Modern .NET CPU/GC/prior-trace comparison; RAD Windows CPU counters; reviewed local publish; local Git status/diff/history/branches and stage/commit | WPF profiling/comparison and isolated local publish receipt passed. Context-size experiment is limited evidence, not a proven speedup; no remote deployment or OMP process pooling |
| M6: validation and package | Deterministic lifecycle soak, comparative benchmark task/report format, bilingual guides and diagnostics companion packaging/signing support | Automated and scoped live checks passed. Four-hour live soak, final signed installation/update/recovery and formal matched competitor runs remain pending |

Plan/read-only mode filters mutation operations before tool registration, and
execution checks access again. Actions recheck adapter state around consent.
Cancellation/disconnect does not invite automatic replay: once SDK or process
execution begins, effects may already have occurred. Native undo, Core file
checkpoints, designer restoration and conversation restore retain distinct scopes.
Partial or unknown outcomes are reported instead of being turned into success.

## Current support map

| Area | Visual Studio 2026 candidate | RAD Studio 13.2 candidate |
|---|---|---|
| Language/context | Public VS solution/project/editor APIs; Roslyn C#/VB navigation and rename/format/simplify | Public project/group/items/dependency/configuration APIs; no Delphi/C++Builder semantic refactoring bridge |
| Build/diagnostics | Native solution/selected-project build; Error List/compiler observations | Native compile notifier completion; explicit saved active `.dproj` external build/log diagnostics; exact target/configuration/platform restrictions |
| Tests | External `dotnet test`, VSTest/TRX, filters/configuration/framework/runsettings | Built active DUnitX console runner with command-line and NUnit logger proof in source; filtered runs and actual XML; no discovery or implicit build |
| Debugging | Guarded breakpoint/state/execution/evaluation, threads and frames | Paused-state controls, source breakpoints, bounded stack/threads and guarded evaluation; locals/frame selection unavailable |
| Suggestions | Native VS suggestion/next-edit UI; bounded UTF-16 context with full-buffer revision; safe bound new/unsaved documents | Explicit before/after preview and acceptance; UTF-8 writer/UTF-16 range conversion; saved buffers up to 1 MiB use a bounded cursor window |
| Designers | WPF/WinUI structured XAML/C# source backend; standard controls through public in-process .NET Framework WinForms `IDesignerHost` | Existing VCL/FMX property/reference/parent edits; guarded saved directly inherited standard Delphi forms/components, creation/deletion/event binding and durable source/form restoration |
| Profiling/run | Modern .NET EventPipe through available `dotnet-trace`; inspected configuration and immutable approved local publish into fresh output | Exact active executable Windows CPU counters/comparison; output/deployment metadata inspection; publish unavailable |
| Git | Shared authenticated local status/diff/log/branches and reviewed stage/commit | Same Core workflow |

Selected VS project builds exclude project dependencies. Use solution build when
dependencies are required. Test results are external runner evidence, not IDE Test
Explorer control. Zero tests, missing reports, stale diagnostics and dispatch
acknowledgements do not establish successful completion.

Live semantic acceptance covered C# and scoped VS2022 VB (5/5); WinUI3 source
acceptance passed 7/7 and three generated stages built. WinUI3 runtime-app/native
visual-designer acceptance is not claimed. Modern out-of-process WinForms, arbitrary Quick
Actions, native C++ semantics, UWP/Live Visual Tree automation, arbitrary third-party
designer controls and general inherited-form/collection authoring are not claimed.
Native compiler-message enumeration, Delphi semantic tools, RAD ghost-text/Tab
provider integration and remote/device/cloud deployment remain unavailable.

GC allocation ticks are sampled estimates; collection duration is not measured GC
pause time or a heap snapshot. EventPipe does not cover native C++/.NET Framework
profiling. RAD CPU counters report process CPU over wall time, not call stacks,
allocation analysis or Delphi GC. Each catalog/inspection states the usable backend.

RAD bounded nested scalar properties, including Font fields, are implemented;
actual Font acceptance remains pending. Collection authoring is not implemented.

Local Git consent displays the cached diff/message. Stage changes the index;
commit honors local hooks and signing configuration. Reviews reject stale state,
linked paths, binary changes, custom clean filters and selected partially staged
files. Another writer's index lock is respected. A commit can change HEAD before
later index publication fails; `partial`, `outcome_unknown` or
`applied_verification_failed` requires inspection before retry. No push, checkout,
reset or atomicity against concurrent manual ref moves is promised.

Git content reads and reviews now share the existing workspace protected-path
policy. Diff/stage review refuses relevant tracked excluded endpoints, including
rename/deletion paths; commit review refuses any excluded staged endpoint. Status
omits excluded names. History messages/branch labels remain metadata; whole-history
secret redaction is not claimed. Protected changes require manual resolution.

## Recorded validation

- Latest full TypeScript/serial Node run after three protected-path Git regressions: **205 PASS, 0 FAIL, 1 optional native-RAD receipt skip** (206 total; 147,544.6771 ms). The focused Git/workspace run passed **15/15, zero skips**. Final adapter integration passed **18/18, zero skips** after fixture-only compatibility fixes.
- Actual payload/Core replay: **2 PASS, 0 skips** with the production C# result emitter and both captured native RAD VCL/FMX change/restore receipts. Replay verifies concrete consent, exact proposal/checkpoint forwarding and single-use routing; SDK mutations are simulated in this test.
- Actual VS2026 isolated profiles: **WPF 11/11 PASS** and **.NET Framework WinForms 8/8 PASS**, covering context/build, two-file rename/native Undo, stale refusal, debugger and three designer operations with exact restoration. WPF also passed actual VSTest, isolated local publish and attached CPU/GC/comparison.
- Actual RAD13.2 Win64: VCL and FMX each passed **six strong creation/binding/deletion/reverse-restoration steps**. All six generated project stages built; saved source/resource assertions replaced earlier insufficient returned-success checks. A VCL runtime window was observed. This does not certify general-project compatibility or RAD32 UI operation.
- Final RAD wave24 VCL and FMX each passed **eight actual authenticated Core→ChatWorker→SDK scenarios** (12 receipt rows including four approval events), including declined build with zero native execution, approved native build, concrete structural consent, exact source/form restoration and consumed-token replay refusal. Native debugger, Windows CPU/comparison and Korean/emoji editor completion/next-edit/Undo/stale scenarios passed. Actual DUnitX returned two tests/one failure with exit 1, and a filtered single passing test with exit 0.
- Real-pipe deterministic lifecycle run: ten distinct project switches/resumes, ten mode switches, thirty cancellation/normal-completion cycles and one hundred editor requests passed. All **131 process instances** exited; instance IDs handle Windows PID reuse. This roughly 27-second fixture run is not the four-hour live soak.
- Current VSIX contains the diagnostics EXE/config and its complete runtime dependency set, with package/license inventory. Signing/verification scripts parse cleanly and include exact packaged first-party EXE verification. Signed 0.11.0 VSIX/companion signatures are valid, and its final WebView check passed 79 (including transitions). Signed 0.11.0 VS2026 WPF passed 11/11. Signed RAD VCL/FMX each passed designer 6/native SDK 26/Core 8 scenarios and all six generated stages built. This is not final unified-installer publication or four-hour soak completion.
- Final signed VS2022 acceptance passed **WinForms 8/8 and C++ 3/3** with the final DLL (SHA256 begins 6A3141); signed VS2026 WPF also passed three generated stage builds and actual runtime controls. The signed installer rebuilt with protected Git passed complete payload hashes, ARM64/x64 bundled-runtime and policy checks (`setup-20261009-125725`, `test-installer-0.11.0-protected-git.log`); English-to-Korean switching preserved IDE selection. The subsequent RAD Delphi personality/original-project identity fix passed fresh signed release011b acceptance (details below); replacement-package verification remains pending. Prior RAD/installer evidence retains its original identity.

New focused regressions cover abrupt ChatSession interruption/resume without prompt
replay, nonfatal 256 KiB checkpoint-budget overflow, editor refusal to spawn a
replacement after uncertain child shutdown, and strict schema rejection of inherited
object field names before adapter dispatch. RAD production standard-form guards and
request retirement passed ten SDK smoke cases on each architecture; compilation and
smoke coverage still do not certify RAD32 UI operation.

The installed OMP 18.6.1 default model (`anthropic/claude-opus-5-5`, minimal effort)
produced ten valid nonempty synthetic editor proposals: five fresh whole-buffer
requests and five fresh cursor-window requests. Source payload fell from 61,440 to
4,096 bytes; median shutdown-inclusive time was 2,669.6 versus 2,503.2 ms. Fixed
whole-buffer → window pair order, five samples and uncontrolled provider/cache
effects prevent a reliable causal speedup, p95, quality or cost claim. It compares
context sizes in this candidate, not installed 0.10.0 versus 0.11.0.

## Pending release gates

VS and RAD 240-minute native context/catalog/build soaks are underway; completion is
not recorded here. Remaining M6 work includes final full Core/adapter/UI checks
against frozen binaries, busy-UI cancellation/disconnect fault acceptance, broader
RAD runtime/editor/nested-property scenarios and broader VS project/IME scenarios. Scoped VS2022 fixtures passed;
RAD32 and physical x64 coverage must be stated separately from the primary
VS2026/RAD13.2 Win64 acceptance environment.
VS and RAD native structural previews now preflight complete-original recovery
reviews and the escaped full proposal envelope before mutation. RAD structural
authoring excludes binary/undecodable source/form resources. Final wave24 VCL/FMX
raw restore payloads both passed Core replay with these guards; this establishes
the verified fixture scope, not arbitrary-project compatibility.

The protected-Git installer passed payload/runtime/policy checks, but is superseded
pending a replacement package. The signed RAD identity fix passed fresh
`ide-dev-release011b` VCL/FMX designer 6/native SDK 26/Core 8 scenarios each and
all six generated stage builds. Actual external `.dpr` alias builds/diagnostics
preserved original `.dproj`/Delphi identity. Both BPL signatures are valid:
Win64 SHA256 `598202985DF8705A441F4BD694C97B24F89C05A6B830A87D39256CAE359A2275`,
Win32 `E099084DDA176B30814FEC9FB38947B4D57E36127AFAABEC62B908BD5E4A9147`.
External builds require active original `.dpr`/`.dproj` plus `Delphi.Personality`;
`.cbproj`, `.dpk` and non-Delphi sidecars are unsupported. Final
package verification, clean installation,
update and prior-version recovery are pending. The repository version must not be
treated as a released distribution until that release is prepared. No formal Copilot/Kai superiority
claim is made. Matched model/settings/tasks, independently evaluated correctness,
retained unsuccessful/unsupported attempts and enough comparable latency samples
are required before publishing a comparison.

See the [candidate guide](IDE-AGENT-INTEGRATION.en.md),
[contract](IDE-CATALOG-CONTRACT.md), [development plan](IDE-AGENT-ROADMAP.en.md)
and [validation history](VALIDATION.md). Reproduction tools include
[raw adapter replay](../scripts/validate-designer-contract.mjs),
[editor context measurement](../scripts/measure-editor-context.mjs) and
[benchmark report validation](../scripts/ide-benchmark.mjs). Local receipts/logs
under `artifacts/ide-agent-20261009/` and adapter fixture directories are evidence
files, not automatically public release assets.
