# PiAgent 0.11.1 — signed scoped prerelease

[한국어](RELEASE-0.11.1.md) · **English** · [usage guide](IDE-AGENT-INTEGRATION.en.md) · [validation history](VALIDATION.md)

As of 2026-10-10 KST, this is a **scoped prerelease with validated source, signed-adapter isolated IDE fixtures and a first signed installer**. Normal-profile 0.11.1 installation/recovery was not performed. The published 0.11.0 installer, its hashes, and its actual upgrade/rollback/restoration evidence remain in the [0.11.0 record](RELEASE-0.11.0.en.md). Validation of those bytes does not certify a new package.

This release guards the stop, reconnect, and conversation-persistence boundaries so delayed events from an old turn cannot change a new session's draft, approval card, URL opening, or settings. Language changes remain available while disconnected; login remains available when connected but idle between turns. VS suggestions recheck document and session state around display and reject stale proposals or cancelled work. VS multi-file changes no longer report partial application or failed recovery as success. RAD designer recovery checks both persisted files and the reopened live form. The component-path `Columns` index validation bug was also fixed.

VS tests gain a runner path for an explicitly opted-in MTP project, with TRX result parsing. A real fixture confirmed two passing tests and an intentional one-of-two failure. MTP requires an explicit framework and opt-in. It does not control IDE Test Explorer and does not support MTP filters or runsettings. Modern out-of-process WinForms designer support is still unavailable.

## Validation scope

| Check | Recorded result | Scope |
|---|---|---|
| Full serial Core regression | **225 PASS, 0 FAIL, 1 optional RAD receipt skip** out of 226 | Includes delayed-event and disconnect boundaries |
| Adapter integration | **17/17 PASS** | Includes short deterministic lifecycle checks, not a long soak |
| Shared WebView | **93 PASS** | Real WebView2 DOM, twelve docking/tab/hide transitions, late null-turn editor/URL/confirmation refusal, and connected idle login |
| VS native console | **91 PASS** | Editor safety and MTP/TRX, plus separate real passing and failing MTP fixture runs |
| Final signed VS2026 VSIX | WPF **8/8 PASS**, archived VSIX UI **104/104**, real shared WebView **93 PASS** | VSIX SHA-256 `09DB05A9E02E2ECB8284AE38B4CD481314355E25A0B085C1F21D07FC025976D7`, native DLL version 0.11.1; isolated-profile validation |
| Final signed RAD13.2 BPLs | Win32 and Win64 each VCL **11/11**, FMX **9/9** | Actual IDE saved/reopened recovery and state checks. BPL hashes and SDK/Core scope are in [validation history](VALIDATION.md) |
| Earlier unsigned baseline | VS2026 WPF **8/8**; Win32 and Win64 RAD SDK **11/11 each**, generated-stage builds VCL **5/5**, FMX **4/4** | Independent evidence predating final signed binaries. Authenticated Core routing ran only on the Win64 baseline: VCL **16/16**, FMX **12/12** |

The [validation history](VALIDATION.md) gives receipt locations and exact binary SHA-256 values. The earlier unsigned VSIX lacks the later shared-UI language fix and remains separate from final signed VSIX evidence. RAD FMX Font appearance may be overridden by `StyledSettings.Family`; visual font acceptance is unverified. RAD32 Core routing and normal-profile installation are separate.

At the user's request, **the strict four-hour test and matched competitor measurements are deferred**. The earlier near-four-hour IDE receipts failed the strict UTC threshold and keep their original binary identities. No clean-install, physical-x64, broader project/IME/busy-UI, or entire M0–M6 completion claim follows.

## Signed package and distribution scope

The first signed 0.11.1 installer passed signatures, complete payload, bundled ARM64/x64 runtimes and policy checks (`artifacts/release-0.11.1-installer-test.log`). Package checks passed **3/3**, and adapter integration passed **17/17**. **Final distribution bytes** repacked with these docs require their own verification; find their hash in the [GitHub release asset](https://github.com/kimmingul/PiAgent/releases/tag/v0.11.1) `.exe.sha256` and [validation history](VALIDATION.md). Package checks are not normal-profile 0.11.1 installation/update/recovery acceptance.
