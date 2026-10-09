# IDE integration: candidate implementation guide

[한국어](IDE-AGENT-INTEGRATION.md) · **English** · [Documentation](README.md)

This guide describes the implementation being validated in the working tree on
2026-10-09. Source now reports 0.11.0 candidate; earlier acceptance receipts retain
their actual 0.10.0 binary identities. This does not announce a signed release or certify every installed IDE
scenario. The [roadmap](IDE-AGENT-ROADMAP.en.md) includes broader goals that remain
subject to SDK experiments and acceptance. Use the live catalog and the recorded
acceptance evidence to determine what the connected installation can actually do.

## Check availability before work

Open the project/solution in the IDE, connect PiAgent, and enter **`/ide`** in
chat or open the IDE feature status in settings. The view shows the latest adapter
snapshot, its capture time, backend and operation availability. It reads the last
published snapshot; it is not a fresh SDK probe on every display. Ask the agent to
inspect `ide_catalog` when fresh discovery is needed. Idle adapter updates and
action preflight also publish snapshots.

`supported` and `partial` operations can be exposed to the model. `partial` means
the described backend has a limited scope, not that a failed action succeeded.
`unavailable` and `blocked` operations include reasons and are excluded from
actionable tools. Plan/read-only mode excludes controls and apply operations.
Actual execution rechecks access and state; catalog availability never grants
write permission. Older adapters retain their original negotiated tools.

With native OMP 18.6.1, an `Allow tool: ide_context` card can appear even for a
read-only request in Always Ask mode. Installed OMP classifies RPC host tools as
execution-tier tools; its registration schema cannot assign them a read tier.
This is OMP's outer tool gate, not administrator elevation or PiAgent change
consent. Cards explain the read-only scope; approving one authorizes that request
only. Declining or cancelling prevents it. PiAgent retains the selected policy and
never answers automatically. Native Approve/Deny labels follow the UI language
while original response values and unknown external options remain unchanged.

Start an overview with one `ide_context` snapshot: both adapters already include
bounded project inventory and the active configuration/platform. Ask for another
operation only when more detail is needed. Snapshot/projects/configurations calls
are distinct requests and can each receive their own OMP card; the snapshot
guidance reduces redundant calls without overriding approval policy. IDE build,
control and apply tools still require PiAgent's separate review and consent.

| Area | Visual Studio candidate | RAD Studio candidate |
|---|---|---|
| Context/build | SDK solution/project/document/configuration context; native build/rebuild/clean, including selected project/configuration | ToolsAPI project/group/items/configuration context; native compile notifier completion; explicit external MSBuild build/rebuild for a saved active Delphi `.dproj` |
| Diagnostics/semantics | Error List/compiler observations; Roslyn C#/VB definitions, references, callers, implementations, overrides, base types and signature | External build log diagnostics report external provenance; native compiler-message enumeration and Delphi/C++Builder semantic refactoring remain unavailable |
| Tests | External `dotnet test` with VSTest/TRX, filters/configuration/framework/runsettings; requires SDK, restored dependencies and test adapter | Explicit active built DUnitX executable with command-line support and NUnit logger proven in project source; real XML report/filter; no discovery or implicit build |
| Debugger | Bounded snapshots, breakpoint controls, threads/frames and guarded execution/evaluation through the VS debugger | Public bounded stack/threads, breakpoints and paused-state controls; guarded evaluation; no locals or frame selection |
| Editor | Native suggestions/next edit with bounded cursor context and full buffer revision, including safe new/unsaved file identities | Explicit Suggest Code/Next Edit preview and acceptance through an undoable writer; large saved buffers up to 1 MiB use a bounded cursor window |
| Profiling | Modern .NET EventPipe via external `dotnet-trace`: CPU, GC observations and prior-trace comparison | Bounded Windows process CPU counters and comparison for the exact active project executable |
| Designer | Standard WPF/WinUI XAML source edits with C# event handlers; public in-process .NET Framework WinForms designer for standard controls and saved source/designer/resource files | Existing VCL/FMX property/reference/reparent bridge; structural create/delete/event/recovery restricted to saved paired Delphi source/form files with directly inherited standard forms/components and verified parent/type guards |
| Run/publish | Configuration inspection and reviewed local `dotnet publish` to fresh isolated output | Native output/deployment metadata inspection; publish execution unavailable |

Only advertised operations are usable. Selected VS project builds exclude project
dependencies; use solution build when that is required. Test results are external
runner evidence, not Test Explorer control. Zero tests, missing reports, stale
diagnostics and an SDK dispatch acknowledgement do not prove success.
RAD `ide_diagnostics` returns the latest completed external build report only for
the exact workspace/project/configuration/platform and labels it `mayBeStale:true`;
it does not enumerate the native IDE error window. The external backend requires
the active original `.dpr`/`.dproj` and `Delphi.Personality` before resolving its
`.dproj`; polling/cache reuse recheck original path, personality, configuration
and platform. `.cbproj`, `.dpk` and non-Delphi sidecars are unsupported.
Supported nested property
schemas are bounded and do not traverse component references; actual live
nested scalar fields, including Font, still need actual scenario acceptance.
Collection authoring is not implemented.

## Review and apply changes

For example, ask “Preview renaming this C# symbol and show all changed files” or
“Inspect this form and preview adding a supported Button.” Inspect first and use
the adapter's advertised types and operations. A refactor or structural designer
preview creates an immutable, bounded token and concrete diff. It does not apply
changes. Ask to apply that preview, review the consent card, and approve or decline.

Consent expires within five minutes and is single-use. Core and the adapter check
workspace/document state around approval and immediately before SDK execution.
Changing the project, configuration, document or relevant state requires a new
preview/approval. Refactor apply requires saved documents; building/testing also
requires the adapter's saved-state conditions. Cancellation before execution
submits no action. Once execution starts, cancellation or disconnect may leave
effects already applied; inspect actual files/IDE state before retrying. Requests
with uncertain outcomes are never automatically replayed.

VS semantic previews are limited to eight files and 128 KiB per before/after side.
Arbitrary Quick Actions, native C++ semantics, modern out-of-process WinForms,
UWP/runtime visual-tree automation and arbitrary third-party designer controls
are outside the verified scope. WPF/WinUI operations are structured document
edits, not native runtime designer-object automation. WinUI does not advertise
WPF-only DockPanel/WrapPanel controls. Catalog and inspect results determine the
specific supported standard types and event properties.
Live fixtures verified C# semantic changes in WPF and .NET Framework WinForms,
including two-file native Undo and designer recovery. Scoped VS2022 VB 5/5 and
WinUI3 source 7/7 passed; three generated WinUI3 stages compiled. This does not
establish a WinUI3 runtime application or native visual-designer backend.

## Recovery uses the matching mechanism

Editor acceptance uses the IDE's native undo. VS semantic changes use its
native undo context; the installed WPF fixture verified a two-file rename and
native Undo restoring the original bytes; the .NET Framework WinForms fixture
also passed. Other frameworks need their own acceptance. A normal user operation
does not execute Undo to prove it, so its `nativeUndoVerified` result may remain false.
Core file checkpoints cover their recorded disk-file scope. Designer structural
recovery uses an owned source/form/resource journal and a separate restore
preview/consent. Conversation restore is another operation and is not a promise
to undo debugger, build, Git or designer side effects.

For a designer checkpoint, inspect the current document, preview restoring the
returned checkpoint ID, review its diff, and separately approve restore. Recovery
requires unchanged owned post-change files and saved IDE state. Intervening user
edits must be preserved. A partial apply or restore must retain its checkpoint
and report the actual outcome; inspect the error and preserved files before
continuing. Do not assume multi-file atomicity. The isolated VCL/FMX fixtures
verified creation, binding, deletion and three reverse source/form restorations.
Production RAD availability requires saved paired Delphi source/form files, direct
standard form inheritance, exact registered standard types and permitted parents;
third-party/inherited owned components are excluded. This does not establish
general-project compatibility. Recovery reviews contain complete original text and
bind the current bytes by hash/size. VS native recovery preflight limits raw review
to 128 KiB, escaped diff to 192 KiB and the full proposal to 220 KiB. RAD structural
authoring requires reversible text source/form resources; it limits original review
rows to 48 KiB and the complete escaped proposal to 220 KiB before mutation. Large
originals are refused; a journal alone does not establish reviewable recovery.

## Local Git work

With `workspace.git.v1` negotiated, ask for local status/diff/history/branches,
then preview staging explicit files or committing the current staged changes.
The agent receives an immutable review token and must request apply separately.
Consent displays the cached diff and commit message. Staging changes the index;
committing honors local Git hooks and signing configuration. No push, checkout,
reset or remote operation is provided by this tool.

Git content tools share the [workspace path exclusions](WORKSPACE-TOOLS.md), including
`.env`, credentials/key files and excluded directories. Diff and stage previews
fail closed when relevant tracked changes contain an excluded endpoint, including
either end of a rename or a deletion. Commit preview refuses any excluded staged
endpoint; resolve those changes manually before reviewing again. Status omits
excluded paths. History messages and branch labels are metadata; this policy does
not redact every secret from history or arbitrary allowed files.

Git reviews expire after five minutes, include at most 64 explicit stage paths,
and are bounded to 256 KiB. Linked paths, binary changes, custom clean filters and
selected files with already staged changes require manual review. Applying checks
HEAD/index/status/file revisions, respects another writer's index lock and uses a
private index. A commit can change HEAD even if later index publication fails:
`partial`, `outcome_unknown` and `applied_verification_failed` mean inspect HEAD
and the index before any retry. Concurrent manual ref moves are not claimed atomic.

## Suggestions and measurements

VS **Tools → PiAgent: Suggest Code / Suggest Next Edit** returns proposals for
the current buffer; acceptance and undo follow the native suggestion UI. Safe
new files require an existing workspace parent directory. Untitled unbound paths
remain unsupported. RAD provides explicit before/after preview and acceptance,
not native ghost text/Tab-provider integration. Its large saved-buffer support
uses a 16,384 UTF-16-character cursor window, bounded to 64 KiB UTF-8, with the
full buffer revision. Both
adapters reject stale buffer/caret/IME state. RAD converts UTF-8 writer positions
and UTF-16 suggestion positions rather than treating them as interchangeable.

Editor inference is a separate isolated OMP process with tools disabled. VS can
send a cursor window at most 64 KiB with full-buffer SHA-256 and UTF-16 offsets.
Next edits stay in that window. Queue/start/configuration/first-token/inference/
shutdown-inclusive total timings identify latency without recording source or
prompts. No process pooling or provider cost reduction is claimed. Compare runs
using the same model, workload, settings, warm/cold conditions and context sizes;
small samples do not establish reliable p95 or product superiority.
An uncertain child-shutdown failure closes that editor connection before another
inference can start; inspect the process outcome before reconnecting.

For VS profiling, attach the modern .NET target in VS and have an available
`dotnet-trace` backend. GC allocation ticks are sampled estimates; GC collection
duration is not a pause-time measurement or heap snapshot. Native C++/.NET
Framework profiling is unavailable. RAD CPU counters measure kernel/user CPU
over wall time, not function stacks, allocations or Delphi GC. Compare only
adapter-issued baseline trace IDs under the same workspace/target conditions.

The 2026-10-09 opt-in experiment used installed OMP 18.6.1's default
`anthropic/claude-opus-5-5`, minimal effort and ten fresh isolated children on
synthetic code. Five whole-buffer and five window requests used a fixed
whole-buffer → window order in each pair, using
the same candidate implementation; this is not an installed 0.10.0 comparison.

| Median measurement | Whole buffer | Cursor window |
|---|---:|---:|
| Source payload | 61,440 bytes | 4,096 bytes |
| OMP ready | 647.5 ms | 660.9 ms |
| First token after submission | 1,861.0 ms | 1,600.0 ms |
| Total including retirement | 2,669.6 ms | 2,503.2 ms |

All ten responses were valid, nonempty proposals. Payload was 93.33% smaller;
the observed median total was 6.23% lower. Five samples do not establish a
statistically reliable speedup or p95. Remote cache/network effects were
uncontrolled and fixed order can introduce bias. The experiment was not randomized
or counterbalanced. Completion quality/IDE acceptance was not evaluated, and cost was
not exposed. Reproduction script: [measure-editor-context.mjs](../scripts/measure-editor-context.mjs) (up to ten
opt-in model calls per run). Local evidence:
`artifacts/ide-agent-20261009/editor-context-experiment.json`.

## Developer validation and evidence

The wire contract is [IDE-CATALOG-CONTRACT.md](IDE-CATALOG-CONTRACT.md). Use
`npm test` for the serial Node/transport suite and `npm run test:adapters` for
adapter integration tests. Targeted regression tests cover catalog ownership and
gating, approval expiry/staleness, immutable refactor/publish/designer/Git review,
editor Unicode/context/new-file checks, partial Git publication and bounded OMP
child-tree retirement. Adapter compilation and pure fixtures do not replace
installed SDK/UI acceptance. Record actual build/test failures, native undo,
designer save/reload/recovery, IME/provider coexistence and cancellation outcomes
against the exact candidate binaries before calling a scenario complete.
Raw adapter previews can be checked with
`node scripts/validate-designer-contract.mjs <raw-json>`. Captures should retain
the unchanged change/restore payloads, matching inspections and per-preview
`changeCapturedAt`/`restoreCapturedAt` evidence timestamps. The replay checks Core
consent/token routing with SDK mutations simulated; it does not replace native
save, build or byte-restoration assertions.
Additional interruption regressions exercise abrupt production ChatSession owner
death with durable OMP context recovery and no automatic prompt replay, and a
native turn exceeding the 256 KiB checkpoint budget that warns while preserving
files/Git state and permitting the next turn. These use deterministic OMP fixtures.
Three Git regressions additionally cover protected contents before consent,
staged protected commits, rename/deletion endpoints and literal pathspec handling.
The focused Git/workspace run passed 15/15. The expanded full run completed:
209 total, 208 PASS, 0 FAIL and one optional native-RAD receipt skip (148,986.8872 ms,
`full-test-0.11.0-guidance.log`). Final both-architecture adapter integration passed
18/18 with zero skips (`adapter-test-0.11.0-final-guidance-both.log`). Signed adapter acceptance
includes VS2022 WinForms 8/8 and C++ 3/3 using the final DLL, VS2026 WPF 11/11 and
three generated WPF stage builds, plus actual runtime controls. The signed installer
containing protected Git, the RAD target-identity fix and approval guidance passed complete
payload hashes, bundled ARM64/x64 runtime and policy checks (`setup-20261009-134700`,
`test-installer-0.11.0-final-guidance.log`); English-to-Korean switching preserved IDE
selection. The RAD Delphi personality/original-project identity fix passed
fresh signed `ide-dev-release011b` acceptance: VCL/FMX each passed designer 6, native
SDK 26 and authenticated Core 8 scenarios (12 rows), plus all six generated stage
builds. Both actual external `Fixture.dpr` alias builds and diagnostics retained the
original `Fixture.dproj`/Delphi identity. Win64 BPL SHA256 is
`598202985DF8705A441F4BD694C97B24F89C05A6B830A87D39256CAE359A2275`;
Win32 is `E099084DDA176B30814FEC9FB38947B4D57E36127AFAABEC62B908BD5E4A9147`.
Both BPL signatures remain valid and unchanged. Two shared UI JavaScript files were
updated after native acceptance; shared WebView validation separately passed 82 checks,
including twelve transitions and three approval-label/raw-value preservation checks.
The UI-only VSIX repack has SHA256
`CADA2441F1DEE303B25DDEE37E9C05A8CB2F949317EDB754911E18B0E2797A7A`;
the native DLL (SHA256 begins 6A3141) is unchanged. Isolated PipeHost output and
intermediate directories (`--artifacts-path`) built successfully while preserving the
loaded original DLL (`isolated-host-build.log`). Implementation commit `24c51e7`
is local, not pushed. Actual installation/update/recovery and four-hour soaks remain
pending; older receipts retain their original identities.
No release or completed soak is claimed.
The deterministic real-pipe lifecycle soak additionally exercises ten distinct
project switches and saved-session resumes, ten mode switches across all four
access modes, thirty cancel/normal-completion cycles and one hundred isolated
editor requests. It verifies project sentinel reads, rejects cross-project paths,
saved sessions and catalogs, and matches
process-instance exit records even when Windows reuses PIDs. This measures test
fixture lifecycle reliability, not real IDE responsiveness or model performance.
