# PiAgent 0.9.18 — RAD form designer diagnostics

[한국어](RELEASE-0.9.18.md) · **English** · [Documentation](README.md)

2026-10-08 KST. Distinguishes OMP tool approval from the IDE designer's ability to apply changes.

- OMP approval cards explain scope and denial/cancellation for inspection, property, reference and parent-move tools. Approval policy/options are preserved.
- RAD VCL/FMX snapshots report specific reasons for unsaved edits, read-only source, unsupported frameworks and unavailable modification services.
- Non-writable snapshots no longer advertise scalar properties, references or parent moves as writable.
- Core exposes host read-only/plan state to the model and preserves native restriction reasons in edit errors.

Native designer automation still does not support creating/deleting controls, generating handlers or editing complex
properties/collections. Unsupported operations require approved source edits followed by IDE refresh/reinspection and build/run checks.

## Causes and installation repair

RAD13.2 64-bit had duplicate 0.9.15/0.9.16 BPL registrations and actually loaded 0.9.15.
The signed unified installer updated Core/RAD32/RAD64, registering one 0.9.18 per location;
the actual loaded Win64 BPL path was verified. Settings, OMP 18.6.1 and conversations were preserved.
[Diagnosis and recovery by result](RAD-DESIGNER-DIAGNOSTICS.en.md).

## Validation

- Full regression suite **143/143**, C#/Delphi adapter integration **17/17**.
- VCL: a real model inspected → requested approved Caption change → saved through ToolsAPI → reinspected.
  After initial testing with the old BPL, the flow was repeated with installed 0.9.18, confirming
  `PiAgent VCL 0.9.18 Verified`, `dirty: false` and `applied: true`. Delphi Win64 build and actual running-window title were verified.
- FMX: the same flow passed with installed 0.9.18 and a real model. `applied: true`, saved `dirty: false`
  and the new Caption were verified. The saved project was built with Delphi Win64, and the running window displayed the title.
- Unsaved FMX Caption edits were reproduced directly in the IDE. The model reported `dirty: true`,
  `canSetProperty: false`, `writeBlockCode: unsaved_changes`, Caption `writable: false` and empty supportedOperations.
  It explained that saving/reinspection was required rather than administrator privileges; no file modification occurred.
- Native VCL/FMX hierarchy, menus, shared Actions, Owner preservation, cycle/read-only relationship rejection passed.
  FMX streamed menus/toolbars/status structure, New behavior and UTF-8 file round trip passed.
- Packaged UI WebView checks: **70 PASS**, including 12 docking/tab/hide transitions and preservation of Korean drafts.
- Setup, VSIX, embedded DLLs, Win32/Win64 BPLs and PipeHost passed signature/timestamp checks.
  All embedded file hashes, bundled ARM64/x64 authenticated handshake/ping and installer safety checks passed.

Evidence: `artifacts/designer-0.9.18-{final-regression,adapters,build,harness,installer-test,webview}.log`,
and the separate projects, model session records and running/approval screenshots in `artifacts/designer-validation-20261008/`.
The user's actual project was not used for fixture modifications.
This does not establish exhaustive RAD32 IDE UI, component/serializer, creation or event-automation coverage.
Running windows were observed visually, but the automation tool did not return those windows for button/menu interaction tests.

Final signed setup SHA-256:
`06a7e96cb8ad2cf83de30c453d313b5d19b2bf74c6fe8195a3cde269da97c727`.
Final documentation-inclusive build/payload checks are recorded in
`artifacts/designer-0.9.18-final-installer-{build,test}.log`.
