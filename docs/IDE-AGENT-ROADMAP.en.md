# PiAgent development plan for comprehensive IDE integration

Installer hash `8A3A…FD09` identifies the cycle-tested upgrade/rollback/restoration package, not a later repack. Repacked bytes require separate verification; download hashes accompany GitHub release assets (`.exe.sha256`).

[한국어](IDE-AGENT-ROADMAP.md) · **English** · [Documentation](README.md)

Date: 2026-10-09; latest evidence 2026-10-10 KST. Historical baseline: **0.10.0**; current source: **0.11.0 scoped prerelease candidate**. Status: **M0–M6 validation in progress; scoped native recovery and replacement payload checks passed; actual upgrade/rollback/restoration passed; both original soaks strict FAIL.**

Latest full Core run: 212 total, **211 PASS, 0 FAIL, 1 optional native-RAD receipt skip** (159,524.7573 ms); final both-architecture adapter integration passed 18/18. Native WebView passed 91, including 12 transitions and recovery/Stop/draft-preservation checks. Core now drains checkpoint/timeline persistence on Stop; explicit Retry connection uses existing native Connect/resumeLast without prompt replay or policy changes. Independent Stop/composer Escape preserve unsent drafts; focused UI 36/36 passed. Recovery VSIX SHA256 `28904BA981EA0C85C08A5BA1E27042D53760BCB3D7EAB81BDAAB39C286345DEF` retains native DLL (SHA256 begins 6A3141) and RAD BPL bytes; six UI files changed from guidance. Actual native Stop→Retry preserved the draft/saved conversation and a fresh explicitly approved IDE context call passed. The intervening tiny turn's historical-error answer remains a separate content failure. Replacement installer `setup-20261009-154200`, SHA256 `8A3A5FAEC53F607A1B5932BBEB536BB699622C859D13478EE8903FF2468CFD09`, passed signed payload/runtime/policy checks; actual upgrade/rollback/restoration passed with 1,056/1,029/1,056 verified payload files respectively. Original benchmark 01/02 passed and 03 remains an operator-interrupted failure with two web-search scope violations. Formal comparison remains pending. Earlier evidence retains its original identity; no whole-plan completion is claimed.

The original VS soak fails the strict four-hour gate: UTC span 14,399.0635 seconds versus Stopwatch 14,400.176 seconds, with 2,869 samples, 24 builds and no recorded errors. Its unequal timestamp anchors do not justify changing the receipt or verifier; it is near-four-hour evidence, not a four-hour PASS. RAD also fails the unchanged strict gate: UTC 14,399.018 seconds versus monotonic 14,400.203 seconds, 2,871 samples, 24 builds and zero errors. Both receipts retain their original 0.10.0 identities and are not strict four-hour PASS results.

The following reports verified scope, not completion of every original milestone exit criterion.

| Milestone | Scoped implementation/verification | Remaining gate or support boundary |
|---|---|---|
| M0 | Catalog/gating, bound approvals/lifecycle, contracts and fixtures | C1 uniform envelope intentionally deferred; retain adapter result shapes |
| M1 | Actual native context/build in both IDEs; explicit target-bound RAD external diagnostics | Native RAD compiler-message enumeration unsupported; broader workloads unverified |
| M2 | Revision/preview/apply/undo, bounded editor context and saved-session Stop→Retry→fresh IDE roundtrip | Broader dirty/IME/busy-UI/multi-file fault coverage; RAD ghost/Tab unavailable |
| M3 | Supported tests/debugger/profile paths have scoped actual receipts | Test Explorer/MTP, Delphi discovery/locals/frame selection and unsupported runtime cases unavailable; no general repair-rate claim |
| M4 | WPF source, .NET Framework WinForms and direct standard VCL/FMX structural preview/apply/restore | Font mutation/persistence acceptance pending; collections unimplemented; inherited/third-party/modern OOP scopes unsupported |
| M5 | Backend-specific CPU/GC/counters, local publish, protected local Git and bounded-context measurements | Exploratory measurements do not establish causal speed/cost improvement; broader platforms/deployment deferred |
| M6 | Core 211 PASS, adapters 18/18, WebView 91, native recovery, signed replacement payload checks and actual upgrade/rollback/restoration | original strict four-hour gates FAIL; formal matched comparison incomplete |

## 1. Objective and principles

Enable agents to use the actual project, language, editor, designer, build, test, debugger, profiling and execution facilities of Visual Studio 2026 and RAD Studio 13.2. Form design is one domain of this broader objective. Improve task completion, correctness, responsiveness and recovery. Do not claim universal superiority over Copilot or Kai before comparative measurement.

- Reuse the Node/TypeScript Core, OMP, authenticated Named Pipe, C# VSIX, Delphi BPL and shared WebView. SDK calls stay in adapters.
- Verify a public API, demonstrate it in a small real-IDE experiment, then implement the product feature. A menu command does not establish an automation API.
- Report language/framework/version/bitness, workload/edition prerequisites and current execution availability. Do not offer unavailable operations as usable tools.
- Validate in isolated fixtures and IDE profiles, preserving unsaved buffers and user changes.
- Improve tool selection as well as tool coverage. Avoid sending every tool description and the whole project on every request.
- Preserve user model selection. **GPT-6.1 sol** is the model for development subagents; it does not mandate the OMP model used by PiAgent customers.

## 2. Historical starting point and current implementation

The table below records the original 0.10.0 starting point, not current unavailability. Current 0.11.0 adds typed catalog/state gating, expiring state-bound approvals, immutable semantic/designer previews, exact source/form recovery, bounded editor context, native RAD build/debugger, verified external DUnitX, CPU comparison, VS EventPipe GC/local publish and shared reviewed Git. RAD native ghost/Tab, Delphi semantic refactoring, native compiler-message enumeration and publish remain unavailable. Modern out-of-process WinForms is unavailable; WinUI3 is a source backend without visual-designer/runtime-app proof. See the candidate guide for exact language/framework bounds.

C1 preserves existing adapter result shapes, transport/session correlation and explicit provenance/uncertainty. A uniform result envelope is intentionally deferred to a separately negotiated capability and adapter migration; arbitrary reads, acknowledgements, stale diagnostics, `applied:false` or zero tests are never normalized into completed success. RAD nested scalar properties (including bounded Font fields) are implemented with actual Font acceptance pending; the test-only loader attempt established inspection only, not mutation/persistence. Collection authoring is not implemented.

| Domain | VS2026 / 0.10.0 | RAD13.2 / 0.10.0 | Next scope |
|---|---|---|---|
| Project/editor context | Solution, projects, configuration, active unsaved buffer | Workspace binding, selection, designer context | Dependencies, platform, multi-document revisions, availability |
| Diagnostics/symbols | Error List, Roslyn C#/VB definitions/references/callers | No common semantic tool bridge | RAD diagnostics, language API feasibility, provenance/freshness |
| Safe code changes | Suggestion acceptance/undo, approved file changes | Approved files, existing designer properties | Semantic rename/code actions, multi-document preflight/recovery |
| Build | Solution build/rebuild | Existing build-menu path, no structured common tool | Targeted builds, asynchronous progress/completion/cancel/diagnostics |
| Tests | Selected .NET project through dotnet test/TRX | No dedicated tool | VS integration feasibility, RAD runner/result contracts |
| Debugging | Breakpoints, stepping, stack/locals, evaluation | No dedicated tool | State-aware control, threads/frames/exceptions, RAD bridge |
| Profiling | Modern .NET CPU with dotnet-trace | No dedicated tool | .NET memory/allocations, native collection feasibility |
| Inline/next edit | Native suggestions, one edit/current file | Not implemented | RAD editor integration, latency reduction, expanded scope |
| Designers | Existing DesignerTools, framework-dependent | VCL/FMX inspection, scalar properties, limited references/reparenting | Creation/deletion/events, complex properties, recovery |
| Run/deploy | Some debugger launch operations | General OMP/existing IDE paths | Launch configuration, devices, packaging discovery and bounded integration |
| Git/sessions | Shared approvals/checkpoints/save/resume | Same Core/UI | Buffer/disk/Git consistency, conflicts, recovery quality |

Evidence: [VS scope](VS-INTELLIGENCE.en.md), [RAD scope](RAD-DESIGNER-DIAGNOSTICS.en.md), [validation history](VALIDATION.md), [architecture](../ARCHITECTURE.md), [protocol](../PROTOCOL.md). When historical prose conflicts with current code and evidence, use current evidence and correct the stale prose.

Three GPT-6.1 sol subagents identified the following historical prerequisites in the initial read-only audit. Catalog filtering, approval expiry/state revalidation, designer cancellation, new VS documents and RAD Unicode/window conversion are now implemented and regression-tested; broader planned extensions remain subject to the gates below.

- Negotiation currently establishes bridge support, not actual SDK/language/project availability. IDE tools are all registered as `essential`; controls remain listed in plan mode and are rejected at execution. C0 must distinguish usable operations.
- `IdeBridge` approval lacks the expiry timer present in designer approvals and is not bound to target state. Prioritize expiry, state revalidation and designer cancellation propagation.
- Approved disk changes currently cover tracked UTF-8 files and bounded batches. Buffer undo, disk checkpoint restore and conversation restore differ. File creation/deletion/rename require explicit additional recovery semantics.
- Editor requests create an OMP process and pipe connection each time. Brand-new unsaved files are limited by the current disk-file gate. Measure each phase and explicitly address new documents in V4/R3.
- RAD reader/writer offsets use **UTF-8 bytes**, while suggestion offsets use UTF-16. Introduce conversion and Korean/emoji/CRLF tests rather than copying VS offset handling.

## 3. Shared tool contracts — C work packages

Extend rather than indiscriminately replace `ide.tools.v1`, `editor.suggestions.v1` and `ide.designer.v1`. Negotiate additive capabilities; use a separate version when changing existing semantics. Names below describe design work packages, not RPC method names; the implemented wire contract is [IDE-CATALOG-CONTRACT.md](IDE-CATALOG-CONTRACT.md).

| ID | Deliverable | Completion criteria |
|---|---|---|
| C0 | Feature catalog/status: operation ID, implementation version, languages/frameworks, availability/blocking reason, required state | Exclude unsupported languages, missing tools and disconnected services from actionable tools; preserve old adapter connectivity |
| C1 | Original goal: common result IDs, revision, target, time, states and truncation. Current compatibility adjustment: preserve adapter result shapes/correlation/provenance; defer a uniform envelope to separate capability migration | Distinguish acknowledgement from completion; never invent completed success for failed reads, stale diagnostics or zero tests; uniform-schema migration remains uncompleted |
| C2 | Changes: preview, target/revision preflight, existing consent policy, post-validation, undo/compensating recovery outcome | Reject changes after approval when revisions differ; disclose partial failure; do not promise atomicity without recovery proof |
| C3 | Lifecycle: approval expiry, progress/time limits, project switches, disconnect, session ownership, child cleanup | No duplicate execution or cross-project results; distinguish cancellation before execution, stopped execution and already-applied changes; fault-test child trees before adding ownership controls |
| C4 | Context/measurement: relevant tools/symbols, revision cache, size budgets, phase latency/cost | Invalidate stale data; measure bottlenecks without logging secrets or source payloads |

Debugger inspection can execute property getters: separate non-evaluating snapshots from explicit evaluation. Build/test/run can execute project code and are not read-only. Preserve current plan/read-only and approval choices without adding redundant confirmations to every step.

Use preflight → preview → approval → apply → validate for document sets. Distinguish native undo, file checkpoints and compensating restoration. Debugger continuation and external deployment cannot be undone by document undo. A disconnected request must not be automatically replayed when execution may already have happened.

Follow SDK thread rules: capture/apply required state on the UI thread and perform long inference/process waits elsewhere. RAD workers exchange JSON/values rather than retaining live ToolsAPI/component interfaces. Resolve targets again at execution and remove notifiers/callbacks on package unload.

## 4. IDE implementation work packages

### Visual Studio

| ID | Scope | Dependencies and acceptance |
|---|---|---|
| V0 | Connect existing tools to C0/C1; discover solution, languages, SDKs and state | C0/C1; existing C#/VB/build/debug behavior retained |
| V1 | Rich document/symbol context, C#/VB semantic rename and bounded code actions | C2; immutable multi-file preview, path/dirty/revision conflicts, undo and recovery |
| V2 | Project/configuration builds, cancellation, fresh diagnostics; richer test targeting/results | C1/C3; actual success/failure/cancel; verify supported Test Explorer API first |
| V3 | Debugger state machine, threads/frames, exception/evaluation policy, reproduction workflow | C1/C3; running/paused races, evaluation limits, clean session exit |
| V4 | Measure/reduce suggestion latency, select context, new unsaved documents, improve next edits | C4; IME, rapid typing, cancellation, undo, provider coexistence; cross-document edits follow C2 |
| V5 | Before/after CPU analysis, .NET memory/allocations, native C++ collection research | V3/C4; disclose runtime/tool/overhead limits; unsupported backends remain unavailable |
| V6 | WPF/XAML, WinForms, resources, run/publish configuration and Git workflows | C2 and framework-specific API experiments; distinguish text edits from designer control; isolated local deployment |

C++ semantics cannot be assumed to use C#/VB Roslyn. Investigate its public language service separately. Label CLI/document-edit fallbacks honestly where Test Explorer or designer APIs cannot be demonstrated.

Installed SDK metadata confirms Roslyn `Renamer`, `Formatter`, `Simplifier`, `Workspace.TryApplyChanges` and light-bulb enumeration APIs. However, `ISuggestedAction.GetPreviewAsync` may return UI rather than a machine-readable change set. Start with deterministic Roslyn operations whose changes can be previewed. The WinForms Designer SDK does not prove generic automation of the modern .NET out-of-process designer.

### RAD Studio

| ID | Scope | Dependencies and acceptance |
|---|---|---|
| R0 | Common IDE tool bridge; project group, active project, platform/configuration, unsaved buffers | C0/C1; separate connection/workspace, safe project switches |
| R1 | Asynchronous compile/build, progress/result/cancel, proven diagnostic acquisition | R0/C3; `IOTACompileServices` and compile notifiers; distinguish dispatch/completion; identify diagnostic source |
| R2 | Debugger state/breakpoints/stack/locals/step and test runners | R0/C3; verify ToolsAPI debugger; validate each DUnitX/DUnit runner output/exit contract |
| R3 | Inline/next-edit integration, Tab/Esc/Undo/IME | R0/C4; prove public editor integration; use explicit preview/acceptance where native suggestion lifecycle is unavailable |
| R4 | VCL/FMX creation/deletion/event wiring and designer recovery | C2/R0; verify source declarations/resource synchronization and failure recovery beyond API existence |
| R5 | Nested properties/collections, menus/actions, inherited forms, data modules, third-party controls | R4; supported-type adapters, cycles/references/read-only/inheritance constraints |
| R6 | Semantic navigation/refactoring, native profiling, run/devices/deployment/resources | Public API experiments; distinguish Delphi/C++Builder; LSP existence does not prove an extension query interface |

Installed RAD13.2 ToolsAPI confirms `IOTAFormEditor.CreateComponent`, `IOTAComponent.Delete`, `IDesigner.CreateMethod/RenameMethod`, undoable source writers and compile services. This is feasibility evidence, not proof of native multi-operation undo or arbitrary component support.

`IOTAMessageServices` supports message publication/group management; no public enumeration/subscription for existing compiler diagnostics was located. Separate native build success/failure from diagnostic acquisition. If IDE log collection cannot be proved, expose a deliberate external MSBuild/dcc log build with `source=external`, configuration/platform and saved-state restrictions. Do not describe it as direct IDE error-window access.

`ToolsAPI.Editor` exposes notifiers, input and paint hooks, but a native inline-provider lifecycle is unconfirmed. Implement preview/accept/undo first; provide ghost text only after IME/DPI/CodeInsight coexistence tests. Use `IOTADebuggerServices`/`IOTAProcess`/`IOTAThread` with deferred evaluation and 64-bit address checks. DUnitX NUnit XML is an external-runner result, not IDE test-explorer integration.

`DeployManagerProject` returning does not establish deployment completion. Start with manifest/output/platform inspection and prove completion/error reporting before execution. Distinguish Git provider registration from Git command APIs and CodeInsight provider APIs from semantic refactoring services.

## 5. Sequence and parallel work

Reorder tasks within a milestone as evidence develops, while preserving dependencies. Assign release numbers/dates after completion gates, not in advance.

| Milestone | Core/shared | VS | RAD | Exit criteria |
|---|---|---|---|---|
| M0: establish foundation | C0/C1 design, lifecycle and latency baseline | V0/API experiments | R0/R1 experiments | Catalog, contracts, fixtures, baseline agreed |
| M1: actual context→build | C0/C1/C3 implementation | V0/build portion of V2 | R0/R1 | Inspect→change→build→actual result/diagnostics in both IDEs |
| M2: safe changes/editor | C2/C4, latency instrumentation | V1/V4 | R3 | Revision, cancellation, undo, IME and availability gates |
| M3: runtime evidence | Long-running state/results | V2 tests/V3 | R2 | Repair using failing tests or debugger evidence and revalidate |
| M4: designers | Shared preview/recovery | Designer part of V6 | R4 then R5 | UI/source/event consistency, failure recovery, actual execution |
| M5: performance/platforms | Measurement comparison, cost/context tuning | V5/rest of V6 | R6/rest of R5 | Measured improvement and scoped support matrix |
| M6: compare/package | Regression, documentation, compatibility, packaging | VS live/competitive evaluation | RAD live/competitive evaluation | Evidence-backed signed candidate, install/update/restore checks |

Later API experiments and fixtures can proceed in parallel after M0. Do not integrate destructive designer or multi-file mutation features before C2. M6 accumulates verification from earlier milestones rather than postponing all validation.

```mermaid
flowchart TD
    M0["M0 catalog, contracts, baseline"] --> C["Shared capabilities, results, cancellation"]
    C --> V["VS context and build"]
    C --> R["RAD context and build"]
    V --> T["Safe changes, context, measurement"]
    R --> T
    T --> E["VS/RAD editor assistance"]
    T --> D["Tests and debugging"]
    T --> F["Forms, resources, events"]
    E --> P["Profiling, run, deployment"]
    D --> P
    F --> P
    P --> Q["Regression, comparison, signed candidate"]
```

## 6. GPT-6.1 sol subagent execution

Current concurrency is **one coordinator plus three subagents**. Set every implementation subagent to **GPT-6.1 sol**. Reuse or rotate agents by work package; separate user-facing threads are unnecessary.

| Role | Default exclusive ownership | Responsibility |
|---|---|---|
| Coordinator | Integration points, shared UI, docs, build/release wiring | Freeze contracts, assign work, review/integrate, live acceptance, resolve conflicts |
| A: Core/contracts | `packages/piagent-protocol`, `packages/piagent-core`, `packages/piagent-omp`, related Node tests | Negotiation, brokering, state/cancel/context/model execution; rotate to validation after completion |
| B: VS | `adapters/visualstudio`, VS-specific fixtures | VS SDK implementation and tests |
| C: RAD | `adapters/radstudio`, RAD-specific fixtures | ToolsAPI implementation, Delphi fixtures, VCL/FMX verification |

- Each assignment includes the input contract, exact writable/excluded files, dependencies, test commands and required evidence. Never concurrently edit shared files.
- Freeze contracts before A edits `chat.ts`/`index.ts` and the coordinator edits UI integration. B/C develop against approved contract fixtures.
- Prefer explicit ownership in the shared workspace. Use `codex/` branches and isolated worktrees when longer-lived separation is necessary, integrating by milestone.
- Parallelize editing and independent tests. Serialize shared build outputs, version generation, packaging, signing, installation and physical IDE UI operations.
- Subagents do not independently redesign shared contracts, bump versions, install or publish. Report justified scope changes to the coordinator.
- Integrate small work packages and run relevant regressions. Three workers do not imply exactly threefold speedup.

## 7. First implementation handoff — M0/M1

1. **Coordinator:** record 0.10.0 baseline, installed IDE/API versions, C0/C1 definitions and stable feature IDs. Correct stale present-tense protocol/adapter documentation.
2. **A:** design and test capability-based descriptions/approval display in `ide-tools.ts`, preserving compatibility. Implement per-connection availability, reasons, freshness and cancellation/late-reply cases.
3. **B:** connect existing VS tools to feature/state reporting. Add document/project identity and diagnostic revision/provenance/build identity. Verify existing behavior.
4. **C:** implement RAD context/build in separate units such as `PiAgent.IdeHost.pas`, `PiAgent.IdeContext.pas`, `PiAgent.IdeBuild.pas`; prove a diagnostic acquisition path. RAD alone owns PipeClient/ChatForm wiring. Test notifier teardown and project switching.
5. **Coordinator:** expose available tools, blocking reasons and progress/completion in Korean/English shared UI. Verify context→build→diagnostics using real fixtures in both IDEs.

The first batch is complete when **both IDEs provide actual project context and compile outcomes under consistent tool semantics, clearly separating unsupported, cancelled and stale results**. If structured RAD IDE diagnostics remain unproven, retain the explicit limitation and separately identified external build path; do not mark native diagnostic integration complete. Avoid starting with one release containing every planned feature.

## 8. Validation and comparative measurement

### Milestone gates

- Core: negotiation, old adapters, input/output bounds, workspace isolation, approval/decline/plan mode, cancellation, late replies and disconnect.
- Editing: dirty/revision conflicts, rapid typing, UTF-16/Korean IME, Tab/Esc, Undo/Redo, switching documents and partial multi-document failure.
- RAD: real Win64 IDE first. Report Win32 build/transport separately from live UI. Distinguish VCL/FMX and Delphi/C++Builder.
- VS: start with C#/.NET, then VB/C++/WPF/WinForms. Preserve existing VS2022 17.14 compatibility.
- Sessions: plan 10 project/session switches, 30 cancel/resume cycles and 100 consecutive editor requests to detect context mixing, stale application and owned-process leaks. Run a four-hour real-IDE workflow with recorded waiting/model delay/interruption causes. These are planned gates, not current PASS claims.
- Designers: create→properties→events→build→run→restore; separate deletion/failure/inheritance/reference/multi-document fixtures.

Reuse existing validation. Multiple agents must not run these full commands concurrently.

```powershell
npm test
npm run test:adapters
dotnet run --project adapters/visualstudio/PiAgent.Vsix.Tests/PiAgent.Vsix.Tests.csproj -c Release
node scripts/test-docs.mjs
node scripts/test-website.mjs
```

Follow existing arguments/environment requirements for `scripts/build-adapters.ps1`, `scripts/build-installer.ps1`, `scripts/sign-artifacts.ps1` and `scripts/verify-installed-native.mjs`. Extend `scripts/vs-intelligence-acceptance.mjs`, the Delphi harnesses and `scripts/test-gui-harness.ps1`. Distinguish scripted/mock verification from observed real IDE UI outcomes.

Build C#/Delphi harnesses before `npm run test:adapters`. Recorded full Core and adapter checks took approximately 134 and 32 seconds respectively; environment changes affect duration. The existing >10-minute `scripts/test-long-running.mjs` and planned four-hour live run serve different purposes. Persistent inference processes are conditional on proved reset/session isolation.

### Copilot/Kai comparison protocol

Prepare at least 12 tasks per IDE covering code comprehension, small changes, multi-file refactoring, build repair, tests, runtime bugs, performance and form/resource work. Record language/framework scope per task: VS C#/VB/C++ and supported UI frameworks; RAD Delphi/C++Builder and VCL/FMX.

- During development use two representative tasks per IDE. For milestone comparison repeat each task five times, alternate execution order and restore the same fixture each run.
- Use the same PC, IDE, repository, prompt, time budget and permissions. Separate matched-model comparisons from default product-experience comparisons. If completion models cannot be matched, report product experience rather than model-controlled performance.
- Record completion rate, independent hidden functional/regression tests, edits, user intervention, total duration, first useful suggestion, p50/p95 latency, tokens/cost and CPU/memory. Unavailable usage data is unknown, not zero.
- Separate model delay from IDE/transport overhead and cold from warm runs. Compare speed for equivalently successful outcomes and also publish failures/timeouts.
- Five repetitions per task are exploratory, not a stable task-specific p95 estimate. Report p95 only for sufficiently sampled comparable operation/task groups; otherwise publish individual runs, range and sample size. Do not combine unlike tasks into a single latency percentile to claim superiority.
- Separate tuning tasks from final evaluation; publish sample size and uncertainty. Do not reinterpret a single 2.4-second request or internal regression pass rate as comparative performance.
- Scope superiority claims to the measured IDE/language/task/model/conditions. Unsupported tasks cannot count as successes.

## 9. Explicit research gates

| Area | Decision method | Bounded alternative |
|---|---|---|
| RAD ghost text/semantics | Installed ToolsAPI, official docs, real IDE experiment | Explicit preview; label lexical search accurately |
| VS Test Explorer/designer automation | Supported public APIs and workload-specific experiment | dotnet test/TRX, supported document edits |
| RAD/VS native CPU/memory | Tool/API/runtime and symbolization experiment | Supported external collector; unavailable when absent |
| Reusing OMP inference processes | Measure initialization, prove reset/workspace/tool/model isolation | Keep isolated processes; improve connections/context/model choice |
| Designer undo/third-party controls | Restore actual state, resource and source | Limit supported types; explicit compensation or refusal |
| Database/data connections/devices/remote deployment | Inventory APIs, credential boundaries and external effects | Begin with metadata and isolated local targets |

These are assigned research tasks, not silently omitted promises. Do not rely on private APIs for the default release path. UI automation can assist acceptance testing but is distinct from an SDK-backed product tool.

## 10. Deliverables and reporting

Each work package delivers implementation, relevant regression tests, live verification evidence, Korean/English documentation and support-boundary changes. Reports include completed/in-progress/blocked work, changed files or commits, checks performed and next dependencies.

Create integrated signed candidates after milestone review; verify installation/update and prior-version recovery. Publish only verified scope in README, website and release notes. Planning alone does not bump the product version or add unimplemented features to the support list.

## 11. Implementation evidence and references

- Local RAD13.2 public SDK: `ToolsAPI.pas`, `DesignIntf.pas`, `ToolsAPI.Editor.pas` and `DeploymentAPI.pas` under `C:\Program Files (x86)\Embarcadero\Studio\37.0\source\ToolsAPI`. Installed APIs do not certify other versions.
- Current VS adapter targets .NET Framework 4.7.2, VS SDK 17.14.40265 and Roslyn 4.14.0. Preserve this public SDK foundation under [VS2026 extension compatibility](https://learn.microsoft.com/en-us/visualstudio/extensibility/migration/extension-compatibility?view=visualstudio).
- [Roslyn rename](https://learn.microsoft.com/en-us/dotnet/api/microsoft.codeanalysis.rename.renamer.renamesymbolasync?view=roslyn-dotnet-5.0.0), [VS build manager](https://learn.microsoft.com/en-us/dotnet/api/microsoft.visualstudio.shell.interop.ivssolutionbuildmanager2?view=visualstudiosdk-2022), [Debugger2](https://learn.microsoft.com/en-us/dotnet/api/envdte80.debugger2?view=visualstudiosdk-2022). Verify signatures against the actual installed reference version.
- [Light-bulb providers](https://learn.microsoft.com/en-us/visualstudio/extensibility/walkthrough-displaying-light-bulb-suggestions?view=visualstudio), [WinForms designer differences](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls-design/designer-differences-framework), [WinUI runtime UI tools](https://learn.microsoft.com/en-us/windows/apps/develop/ui/xaml-runtime-design-tools). Do not confuse WinUI3 runtime XAML tools with a drag-and-drop designer.
