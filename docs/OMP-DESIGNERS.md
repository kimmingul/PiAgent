# OMP / IDE designer compatibility

Current update: 2026-10-08, PiAgent 0.9.18. The default RAD13.2 x64 profile now loads the
signed 0.9.18 BPL; duplicate older registrations were removed by the unified installer.
See [RAD diagnostics](RAD-DESIGNER-DIAGNOSTICS.md) and [current validation](RELEASE-0.9.18.md).
The 0.8.1 paths and OMP baseline below are historical, not the current installation.

Implementation and interactive validation, 2026-10-04. This is **not full OMP/designer parity**.
VS2026 now has VSIX 0.8.1; RAD 13.2 has BPL 0.8.1 in the isolated PiAgentValidation08 profile.
RADAgent is reference-only; its files were not edited.
Original UI CSS/layout/renderers remain protected by byte-level regression tests.

## Verified baseline

- [OMP v18.6.0](https://github.com/can1357/oh-my-pi/releases/tag/v18.6.0), official Windows ARM64 binary verified against release SHA-256.
- RPC v1 startup, v2 negotiation/chunk decoding; model/effort get/set on the real executable.
- Native-profile startup, private session persistence, model discovery, and real model turns with approved host tools in VS2026 and RAD 13.2.
- TypeScript strict build, automated protocol/approval regressions, C# VSIX build and Delphi Win32/Win64 builds.
- Building an adapter is not evidence that its designer integration works inside every IDE/framework version.

## Implementation matrix

| Area | Implemented | Remaining validation or functionality |
| --- | --- | --- |
| OMP model/effort | Original model picker and effort selector; RPC discovery/selection; interactive Opus 5.5/high turns | Other provider/plugin combinations |
| OMP UI requests | select/confirm/input/editor/cancel, bounded owner-scoped responses | Startup extension UI, rich widgets, auth/open_url, all plugin workflows |
| OMP events | Bounded text/thinking/tool/queue/retry/compaction/subagent projections | Full original queue, subagent controls, BTW, export, image/attachment UI |
| Native OMP tools | Opt-in native profile retains tools/extensions/skills/rules/LSP; always-ask config | IDE dirty-buffer coordination, checkpoint/restore for native writes, project lifecycle |
| WinForms (.NET Framework) | Discover public IDesignerHost, inspect scalar properties, approved transaction/save | Real VS2022/2026 form tests, designer service availability |
| WinForms (modern .NET) | Explicit unsupported result when public host is unavailable | Supported out-of-process designer bridge; no guessed reflection/private API |
| WPF | Inspect XAML buffer; approved existing-attribute update with revision/dirty check and IDE undo/save; VS2026 refresh/build/running document editor verified | Complex XAML/property elements |
| WinUI 3 | XAML buffer path for UseWinUI projects | Build/running-app Hot Reload and Live Visual Tree verification |
| VCL / FMX | ToolsAPI form discovery, scalar RTTI property inspection, approved edit/save; VCL live editor validation; FMX RAD13.2 x64 inspect, Width80→110 approval/save/reinspect, IDE build and rendered running app verified | FMX runtime button/dialog click verification (automation did not return its window), rollback/undo coverage, complex serializers |
| All designers | IDE-neutral request broker, approval, revision check, cancellation, workspace check | Add/remove controls, event handlers, resources, batch layouts, screenshots, durable checkpoints |

WinUI 3 does not offer a Visual Studio drag/drop XAML designer. Use
[XAML Hot Reload / Live Visual Tree](https://learn.microsoft.com/en-us/windows/apps/develop/ui/xaml-runtime-design-tools)
for runtime visual development. Modern .NET WinForms uses an
[out-of-process designer](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls-design/designer-differences-framework);
it cannot be treated as the old in-process IDesignerHost.

## Reproduce checks

```powershell
npm test
npm run test:adapters
& .\scripts\build-adapters.ps1
node scripts/omp-compat.mjs <absolute-path-to-omp.exe>
node scripts/omp-native-smoke.mjs <absolute-path-to-omp.exe>
```

Compatibility scripts never send model prompts. Native smoke creates a fresh temporary Git
workspace/session store and leaves it available for inspection. Do not use the user's live project
as a fixture. The shared OMP installation is not replaced by these probes.

## Default GUI development workflow

When `ide.designer.v1` is negotiated, Core attaches IDE-neutral designer-first guidance to
ordinary model prompts. GUI tasks start with `ide_designer_inspect` on the open target form;
supported visual property changes use `ide_designer_set_property` and explicit approval.
The existing UI/UX is preserved unless the user requests a change. Read-only connections
receive inspection-only guidance. Native OMP slash commands pass through unchanged.
An explicit user workflow takes precedence, and unrelated tasks do not require inspection.

Adding/removing controls, wiring events and complex property structures are still outside
the current designer tool surface. Necessary approved source edits must be followed by
designer refresh/inspection and build/run verification. Dirty buffers must not be overwritten.
This is model guidance, not a guarantee that every model always follows it; adapter revision,
workspace and approval checks remain enforced independently.

## Activation boundary

Default is restricted. Native opt-in is `--omp-profile native --allow-writes`, with authenticated
transport and an explicit Git workspace. The adapter must negotiate write, session and control
capabilities. Always-ask does not imply a sandbox or automatic checkpoint coverage. OMP native
tools and extensions can act outside the host-tool pathway. Do not present their changes in the
PiAgent checkpoint list as if they were captured.

The daemon workspace must match the project being edited; an active IDE form outside it is rejected.
The designer-first validation Core is installed at designer-validation/runtime/0.8.1, on pipe piagent-validation08, with workspace
D:\\source\\PiAgentValidation08. The older piagent-dev daemon remains unchanged. VS2022 live testing
is deferred until the final release, as requested. See VALIDATION.md for the exact test scope.


## Framework harness 0.9.0

See [GUI-HARNESS.md](GUI-HARNESS.md) for packaged framework skills, automatic OMP delivery, native RAD parent/reference tools and exact limitations. Prior 0.8.1 validation above describes the earlier installed build.
