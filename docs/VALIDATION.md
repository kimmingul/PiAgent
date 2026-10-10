# PiAgent validation history

## 0.11.2 scoped signed candidate — 2026-10-11 KST

The 0.11.2 source adds distinct multi-target VSTest TRX aggregation with an expected-report-count guard and stricter RAD external-diagnostic invalidation. Current checks are recorded against their actual binaries and receipts:

| Check | Result and identity | Boundary |
|---|---|---|
| Full Core regression | 226 total, **225 PASS, 0 FAIL, 1 optional native RAD skip**; 166,110.8782 ms; local `artifacts/release-0.11.2-core-tests.log` | Does not replace native IDE checks |
| Adapter integration / VS console | Win32 and Win64 adapter integration **18/18 combined**; VS native console **95 PASS** | Source and adapter checks, separate from signed IDE acceptance |
| Signed VSIX, isolated VS2026 WPF and archived UI | **8/8 PASS**, archived UI **104/104 hash match** with no extra/missing files, actual archived WebView **93 PASS**; VSIX SHA-256 `699F7175AF592002FAE7D0E79C2684DC19DD7C825C626D1A68CD17AA65FD31A8`; archived DLL SHA-256 `0BA36CF9D43552F0AFD225CE0EC0D91F013D98BDE6D3248090CD2B527555C4FC`; local `artifacts/release-0.11.2-vs-wpf/piagent-vs-acceptance.receipt.json` and `artifacts/release-0.11.2-vs-webview.log` | Isolated fixture profile; not normal-profile acceptance |
| Signed RAD13.2 Win64 BPL | SHA-256 `F2C94DF2BB55E4366AD23A98471D89A6196F29DBD7CFF361F3EEA64771189F91`; Authenticode Valid; VCL designer **11/11** and native SDK **28/28**; FMX designer **9/9** and native SDK **28/28** | Isolated IDE fixtures; final step invalidates external diagnostics after native build |
| Signed RAD13.2 Win32 BPL | SHA-256 `BC01EADA792BFEA56F27E93ED2B65A37CE411BC79454BFD3939B603A2353E915`; Authenticode Valid; VCL designer **11/11** and native SDK **28/28**; FMX designer **9/9** and native SDK **28/28** | Same scoped isolated IDE fixture; receipts under `adapters/radstudio/bin/Win32/ide-dev-signed0112/` |
| First signed installer stage | `artifacts/setup-20261010-223751`; **1,065 payload hashes**, x64/ARM64 runtime, policy and language checks passed; local `artifacts/release-0.11.2-installer-test.log` | Documentation repack changes installer bytes; final asset must be retested and identified by its own `.exe.sha256` |
| Final signed installer | `artifacts/setup-20261010-224426`; **1,065 payload hashes**, x64/ARM64 authenticated runtime handshakes, policy, language and tampering checks passed; local `artifacts/release-0.11.2-final-installer-test.log`; SHA-256 `F7ECF1CD90FB2957675D89A41013BCB5C1904355DA3CE3AAA3F06D1000404737`; Authenticode Valid, Nanum Space Co,. Ltd, timestamp verified | These post-packaging results are in the repository and documentation ZIP; embedded installer documents retain their packaging-time snapshot. Normal-profile upgrade/recovery was not retested |

The signed 0.11.1 results remain historical. The unsigned automated IDE 240-minute results below have different binary identities and do **not** certify a four-hour run of the signed 0.11.2 VSIX, BPLs or installer. Matched Copilot/KAI measurements have not been performed. Normal-profile install/update/recovery and broad model-driven repair remain unverified.

## New 240-minute isolated IDE runs — 3/3 PASS, 2026-10-11 KST

The user lifted the previous four-hour deferral. Three **unreleased, unsigned
working-tree** automated native IDE observation/build runs completed. Root
independently ran the **unchanged** `scripts/verify-ide-soak.mjs` against each
original receipt and matched its adapter hash to the start manifest and actual
binary. Consolidated results and exact receipt hashes are in
`artifacts/ide-soak-20261010/verified-results.json`; the original failures below
remain unchanged. Each new run recorded **2,867 samples, 24 builds and zero
errors**. Both UTC and monotonic elapsed time cleared 14,400 seconds.

| Isolated run | UTC elapsed / monotonic elapsed | Adapter SHA-256 | Result |
|---|---:|---|---|
| RAD13.2 Win64 FMX | 14,400.202 / 14,400.235 s | `9ACEB23B57CA0E3D9F7A7633799E61A2044053785EABB5F757C778644A039AB5` | PASS |
| RAD13.2 Win64 VCL | 14,400.302 / 14,400.329 s | `9ACEB23B57CA0E3D9F7A7633799E61A2044053785EABB5F757C778644A039AB5` | PASS |
| VS2026 WPF | 14,401.1484258 / 14,401.1423908 s | `27F2A91C477CDC1AD3E6C4E266103D8310ECF19DFA68B43E891B604730F2C088` | PASS |

Private-byte changes were FMX −21,123,072, VCL −14,503,936 and VS +5,189,632;
handle changes were −102, −101 and −87 respectively. These endpoint deltas do
not prove an absence of leaks. The unsigned VS candidate archive SHA-256 is
`5DB5FA0950CD001AA7F35A5451EC956DF0CCF20C810922A85967271B2050DDB2`;
the binaries differ from the signed 0.11.1 assets below. This PASS covers
automated isolated IDE observation and builds, **not** four hours of human use,
model inference, arbitrary project completion or competitor performance. Matched
Copilot/KAI measurements remain deferred.

## 0.11.1 signed scoped prerelease — 2026-10-10 KST

서명된 0.11.1의 별도 IDE 프로필 검증과 설치 패키지 검사를 통과했다. 이 서명
바이너리를 일반 프로필에 설치하거나 4시간/경쟁 제품 실측 비교에 사용한 것은 아니다.
위에서 통과한 후속 4시간 시험은 미배포·미서명 바이너리의 별도 실행이다. 배포 파일은
[0.11.1 릴리즈](https://github.com/kimmingul/PiAgent/releases/tag/v0.11.1)와
동봉 `.exe.sha256`으로 식별한다.

- Final documentation repack SHA-256:
  `3301708DD0E4A2272443ADA62A824ED9C46E19FA80C02BC8A0CB568FA8C7735C`.
  This exact signed setup passed all **1,063 embedded payload file hashes**,
  signature/timestamp, both bundled ARM64/x64 authenticated runtimes and installer
  policy/language checks in `artifacts/release-0.11.1-final-installer-test.log`.
  Its native adapter bytes are unchanged from the signed acceptance below.
  Embedded guides record the pre-publication build snapshot; this final hash and
  receipt are recorded externally to avoid a self-referential installer hash.
- Signed VSIX SHA-256:
  `09DB05A9E02E2ECB8284AE38B4CD481314355E25A0B085C1F21D07FC025976D7`.
  Its archived native DLL is version 0.11.1.0, SHA-256
  `D9B65EC2932837B7FC607E3DF610F2068F7F98AD794B9B02AE4BA1309F8A4EF1`.
  Actual VS2026 WPF **8/8 PASS** used those exact archived DLL bytes in the
  `PiAgentContinue1010` isolated profile; receipt:
  `artifacts/release-0.11.1-vs-wpf/piagent-vs-acceptance.receipt.json`.
  Archive content signatures, signer trust and embedded PE timestamps passed.
  All **104/104 UI files** match final build inputs. Actual archived UI/DLL
  WebView verification passed **93 checks**, including twelve transitions;
  `artifacts/release-0.11.1-webview-smoke/webview.stdout.log`.
- Exact signed RAD BPLs passed actual isolated VCL **11/11** and FMX **9/9**
  direct designer checks on **each** of Win32 and Win64. Win64 SHA-256:
  `287583E15E7E0D331AD57CE37694667C3AE440515136B8CCB8D76C17D8843C8B`;
  Win32: `6EE934ACC7C46C811011A10114CEEAFB51DEA33B735CEC145B9EF6559897842C`.
  Summary: `artifacts/continuation-20261010-rad-signed0111-summary.json`.
  Earlier G-candidate Core-route and stage-build evidence below keeps its own
  binary identity. Test-owned IDE/daemon processes were stopped after acceptance.
- Version 0.11.1 adapter integration **17/17 PASS**, no skips,
  `artifacts/release-0.11.1-adapter-tests.log`. Runtime/offline documentation
  packaging **3/3 PASS**, `artifacts/release-0.11.1-package-tests.log`.
  The final source regression before the version bump was **225 PASS, 0 FAIL,
  1 optional skip**; its source scope and original receipt remain below.
- First signed installer (before final documentation repack), SHA-256
  `9EE74DEFADB0ED6EB9A49063E91875B40DAD9F4BACF6B2C1D7A1C8C1380B8931`, passed
  signature/timestamp, all embedded payload hashes, bundled ARM64 and x64 Node
  authenticated negotiation/ping, language resources, settings-policy preservation,
  tamper/path rejection and IDE availability checks. Log:
  `artifacts/release-0.11.1-installer-test.log`. Later repacks require separate
  exact-byte verification; this hash does not identify a repacked download.

No normal-profile 0.11.1 installation/upgrade/rollback or physical x64 clean
install was performed. The **signed 0.11.1 binaries** were not used for a
four-hour soak or competitor measurement; the new unsigned source runs above
are separate. The bilingual [release notes](RELEASE-0.11.1.en.md) record the
supported scope and the deferrals at publication time.

## Follow-up source validation — 2026-10-10 KST

세션·코드 제안·RAD 디자이너·VS 테스트 실행을 개선한 후속 소스다. 사용자의 요청으로
**당시 4시간 검증과 경쟁 제품 실측 비교는 보류**했다. 이후 4시간 검증은 위의 별도
미서명 시험에서 통과했으며 경쟁 제품 비교는 계속 보류한다. 아래 검증은 공개 0.11.0 설치파일의
새 기능을 의미하지 않으며 일반 IDE 프로필의 설치파일을 교체하지 않았다.

These follow-up changes are separate from the published 0.11.0 prerelease. Three
GPT-6-sol subagents worked on Core, VS and RAD. **Four-hour validation and measured
competitor comparison were deferred at that time.** Later user input led to the
separate passing unsigned four-hour runs above; competitor comparison remains deferred. This
historical source section does not claim a performance ranking, normal-profile
installation or whole-plan completion.

- Final serial Core regression: **226 total, 225 PASS, 0 FAIL, 1 optional native-RAD
  skip**, 152,746.7416 ms, `artifacts/continuation-20261010-final-guard-core-tests.log`.
  It includes the disconnected-language, terminal-card and late idle-event fixes.
  Focused session/UI checks also passed **29/29**; counts are not added.
- Adapter integration: **17/17 PASS, zero skips**, 28,603.8103 ms,
  `artifacts/continuation-20261010-adapters.log`. Short deterministic lifecycle
  checks cover repeated session/access transitions and child cleanup, not a soak.
- Final shared WebView: **93 PASS**, including twelve docking/tab/hide transitions,
  Korean/English preferences while disconnected, reconnection and draft retention,
  `artifacts/continuation-20261010-accepted-guard-webview.log`. It also verifies
  late null-turn editor/URL/confirmation requests cannot alter the draft, reach
  the host or reopen a card. Idle login still works. The preceding failed
  `final-webview.log` is retained: the new disconnected-frame guard initially
  discarded global language preferences. It now accepts global preferences while
  refusing stale session-owned settings callbacks.
  The later `final-guard-webview.log` failure exposed an invalid smoke sequence
  that requested turn-owned confirmations without starting a turn. The fixture
  now starts real turns with ordered IDs; production idle guards remain enabled.
- VS native safety/test-runner console: **91 PASS**,
  `.tools/ide-validation/vs-safety-mtp-tests-20261010.log`. Actual MTP fixture runs
  produced two passing tests/exit 0 and an intentional one-of-two failure/exit 2,
  with parsed TRX reports in `.tools/ide-validation/mtp-{pass,fail}-results/`.
  MTP requires explicit framework and opt-in from the CLI working directory;
  filters/runsettings and IDE Test Explorer control remain unsupported.
- Actual VS2026 isolated WPF fixture: **8/8 PASS** for context/catalog, targeted
  build, two-file rename/native Undo, stale refusal, debugger, and designer
  create/bind/delete with exact restoration. Receipt:
  `artifacts/continuation-20261010-vs-wpf/piagent-vs-acceptance.receipt.json`.
  Native DLL SHA-256:
  `99E3E5ACA700E40DF9F565F9D2982D096217A17C2A4FF570039EFE038273D1FB`.
  Frozen unsigned VSIX SHA-256:
  `8B38B0A2C6DB1C6A4F2880BBD8C41578FD252ABF145AA3088948B1DC80E49566`.
  Only `PiAgentContinue1010` experimental profile was updated. This frozen VSIX
  predates the final shared-UI language fix; its native acceptance does not certify
  that later UI file as part of the archive.
- RAD recovery failures remain preserved: candidate A restored exact disk bytes
  but left the open VCL Font stale; candidate B's in-place compensation accessed
  an invalidated component interface. The implementation now closes/reopens a
  clean saved module through public ToolsAPI, reacquires interfaces and verifies
  both persisted/live values and clean buffers. Partial restoration errors
  distinguish recovered files from failed live reload.
- Review found `Columns[1]` through `Columns[9]` were incorrectly excluded by the
  original allowlist expression. Both native path validators were corrected;
  positive indices 0, 1, 9, 10, 31 and negative 32, 99, 01 have regression checks.
- Final fresh RAD candidate `ide-dev-continue1010g`: **11/11 SDK smoke checks per
  architecture**. Both Win64 and Win32 actual IDE fixtures passed VCL **11/11**
  and FMX **9/9** direct designer steps, plus VCL **5/5** and FMX **4/4** generated
  stage builds. Authenticated Core approval/apply/restore routing was verified on
  Win64: VCL **16/16 scenarios** (24 rows including approvals), FMX **12/12**
  (18 rows). Win32 Core routing was not repeated. These use a deterministic tool
  caller inside real IDE fixtures, not an external-model quality benchmark.
  Win64 BPL SHA-256:
  `5339B7C970ABE444136B1E751C3FFC4402D674F2FEF81C5659334D442CEAD400`;
  Win32:
  `9B50A204C948E6DA3908329FE53EAB359F95E659DDA7B63754DE65A8D51D18C2`.
  Receipts live under `adapters/radstudio/bin/{Win64,Win32}/ide-dev-continue1010g/`;
  aggregate: `artifacts/continuation-20261010-rad-final-summary.json`. Pre-fix F
  receipts remain separate. Test-owned IDE/daemon/pipe-host processes were stopped.
- FMX Font evidence covers stored/reopened `TextSettings.Font.Family`. The default
  `StyledSettings.Family` can override its displayed appearance; manually clearing
  that setting in the IDE is required for the override. No automatic StyledSettings
  mutation or FMX runtime-font visual acceptance is claimed. Native screen capture
  failed in this session; SDK receipts are not reported as visual observation.
- An initial full regression failed on missing offline benchmark documentation.
  Packaging now includes both guides, plans and task specification; the corrected
  full run above passed. Comparison plans/validator are retained for future use,
  with no competitor measurements executed.

Remaining implementation/platform scope is listed in the bilingual
[roadmap](IDE-AGENT-ROADMAP.en.md) and [usage guide](IDE-AGENT-INTEGRATION.en.md).
Local raw evidence is not automatically published as a release asset. Earlier
records below retain their original versions, hashes and failed-soak status.

## Published 0.11.0 scoped prerelease — 2026-10-10 KST

[GitHub release](https://github.com/kimmingul/PiAgent/releases/tag/v0.11.0) was published
as a prerelease. Final setup SHA-256 is
`7af9b27a265a4a7643c108887b66a7d3602928a844924623ff11197b884758c2`.
The final documentation repack passed signature/timestamp, complete payload hash,
ARM64/x64 runtime, policy and language checks, then actual same-version repair in
normal VS2022/2026 and RAD32/64 registrations. All 1,056 payload files and preserved
Core settings passed verification. The earlier full upgrade/rollback/restoration
cycle below retains its own installer identity.

Normal-profile VS2026 startup then displayed PiAgent 0.11.0, automatically connected
to Core from installed release `0.11.0-20261009165859`, rendered Korean with automatic
system language, and retained Opus 5.5/high and Always ask. No inference or settings
change was performed in this startup check. All five GitHub release asset digests
matched their local files. Both strict four-hour failures and the remaining M6
comparison/coverage gates below still apply; publication does not mark them complete.

Installer hash `8A3A…FD09` identifies the cycle-tested upgrade/rollback/restoration package, not a later repack. Repacked bytes require separate verification; download hashes accompany GitHub release assets (`.exe.sha256`).

## 0.11.0 scoped prerelease (latest evidence 2026-10-10 KST)

Source reports 0.11.0 as a scoped prerelease; implementation is recorded at 24c51e7 and recovery at b8f566b. Earlier native/soak receipts retain their actual binary identities. Automated and scoped actual native UI recovery, signed replacement payload and actual upgrade/rollback/restoration checks passed. Availability: [GitHub Releases](https://github.com/kimmingul/PiAgent/releases).

- Latest full TypeScript/serial Node run: **212 total, 211 PASS, 0 FAIL, 1 optional native-RAD receipt skip** (159,524.7573 ms), artifacts/ide-agent-20261009/full-test-recovery-final.log. Final both-architecture adapter integration passed **18/18, zero skips** (32,981.6887 ms), artifacts/ide-agent-20261009/adapter-test-recovery-both.log. Focused Git/workspace checks passed 15/15, including three protected-path regressions.
- VS native contract/unit checks: **75 PASS**. Actual production result payloads passed Core parsing, immutable previews, concrete consent and exact single-use restore routing. Actual RAD wave24 VCL/FMX payloads also passed; focused designer/schema/adapter tests passed **8/8 with zero skips**. These contract replays simulate SDK mutations and do not replace native acceptance.
- Actual VS2026 isolated WPF fixture: **11/11 PASS** covering context/catalog, targeted native build, two-file semantic rename/apply/native Undo with exact byte restoration, stale refusal, VSTest, debugger, create/bind/delete with source checkpoints, isolated local publish and attached CPU/GC/comparison. Generated designer stages compiled separately. The original VS soak fails the strict four-hour gate: UTC span 14,399.0635 seconds versus Stopwatch 14,400.176 seconds, with 2,869 samples, 24 builds and no recorded errors. Its unequal timestamp anchors do not justify changing the receipt or verifier; it is near-four-hour evidence, not a four-hour PASS. RAD also fails the unchanged strict gate: UTC 14,399.018 seconds versus monotonic 14,400.203 seconds, 2,871 samples, 24 builds and zero errors. Both receipts retain their original 0.10.0 identities and are not strict four-hour PASS results. Receipt artifacts/ide-agent-20261009/vs-wpf-final/piagent-vs-soak.receipt.json is unchanged. Windows logs do not prove a clock adjustment explaining the discrepancy.
- Final signed 0.11.0 VS2026 WPF repeated **11/11 PASS** at 12:19:16 UTC, implementation identity 0.11.0.0+f188a0c32256410c9188f71fe57fcf13. Its three generated stages built and actual runtime controls passed. Signed VSIX and diagnostics companion signatures are valid. Final signed VS2022 **WinForms 8/8 and C++ 3/3 PASS** used the same native DLL (SHA256 begins 6A3141). Recovery VSIX SHA256 is `28904BA981EA0C85C08A5BA1E27042D53760BCB3D7EAB81BDAAB39C286345DEF`; native DLL bytes are unchanged. Six UI files changed from guidance. Shared WebView validation passed **91**, including twelve transitions and recovery/Stop/draft-preservation checks; included cases must not be added again. Earlier host receipts retain their identities.
- Actual VS2026 .NET Framework WinForms: **8/8 PASS**, including native build/debugger, two-file rename/native Undo and three public in-process designer operations with exact source/Designer/resx restoration. Generated stages compiled and the created button was seen at runtime. Modern out-of-process WinForms is unavailable.
- Actual VS2022 scoped fixtures: **VB 5/5**, **WinUI3 source 7/7**, and **WinForms wave2 8/8 PASS**. WinUI3 generated C#/XBF stages compiled; this proves the source backend, not a native visual designer or runtime application. Host Newtonsoft compatibility was checked against the installed VS2022 assembly, not only NuGet references.
- RAD Win32/Win64 compiled native smoke: **10 PASS per architecture**, covering Unicode offsets, owned process lifetime, real external compiler diagnostics, source/form recovery/conflicts, typed properties/relations, actual DUnitX XML, CPU counters, cancellation retirement and strict production authoring guards. This does not certify RAD32 live UI operation.
- Post-identity-fix signed RAD `ide-dev-release011b`: VCL/FMX each passed designer **6 strong saved-state steps**, native SDK **26**, authenticated Core **8 scenarios/12 rows** (including four approvals), and all **six generated stage builds**. Declined builds executed no native build; approved builds completed; structural postconditions, exact source/form restoration and consumed-token replay refusal passed. Actual external `Fixture.dpr` alias builds exited 0 and retained original `Fixture.dproj`/`Delphi.Personality` in build/diagnostic receipts. Win64 SHA256 `598202985DF8705A441F4BD694C97B24F89C05A6B830A87D39256CAE359A2275`; Win32 `E099084DDA176B30814FEC9FB38947B4D57E36127AFAABEC62B908BD5E4A9147`; both Authenticode signatures Valid. BPL bytes remain unchanged. Two shared UI JavaScript files were updated after this native capture and verified separately by shared WebView checks; six recovery UI files followed, covered by the latest 91-check run. `adapters/radstudio/bin/Win64/ide-dev-release011b/final-acceptance.receipt.json` records native scope. Target guards require active original `.dpr`/`.dproj` plus Delphi personality and recheck identity/configuration/platform during execution, polling and diagnostic reuse; `.cbproj`, `.dpk` and non-Delphi sidecars are unsupported. Both architectures passed ten smoke cases, including same-basename C++/Delphi sidecar refusal. Earlier native receipts remain historical.
- RAD native debugger, exact-target Windows CPU/comparison and Korean/emoji editor completion/next-edit/Undo/stale refusal passed. Actual DUnitX reported two tests/one failure/exit 1 and a filtered single passing test/exit 0; no discovery or implicit build claim. A VCL runtime window was observed within fixture scope. RAD VCL20 soak completed but fails strict UTC duration (14,399.018s versus monotonic 14,400.203s; 2,871 samples/24 builds/zero errors); it retains SHA256 `cb2428a8e36fdb270535cc2d605186629566c7bc6dbb032ebde3b992edfb64ae` and version 0.10.0.
- Recovery-budget review: VS native previews preflight complete original text <=128 KiB, escaped diff <=192 KiB and full proposal <220 KiB. RAD structural authoring rejects binary/undecodable resources; complete original review rows <=48 KiB and full escaped proposal <=220 KiB are checked before mutation and on emission. Generic byte-journal binary recovery is a separate test. Both actual RAD wave24 restore payloads replayed: VCL 5,280 bytes (diff 2,448), FMX 5,526 bytes (diff 2,572), complete original text/encoding/preamble plus exact current/original hashes and sizes, without growing current text.
- Interruption regressions: abrupt production ChatSession ownership termination preserves saved conversation and resumes without automatic prompt replay; a native turn exceeding the 256 KiB checkpoint budget completes with a warning, preserves file changes, offers no incomplete checkpoint and allows the next turn. Uncertain editor-child shutdown forbids replacement process creation on that connection. Strict tool schemas reject inherited object field names before adapter dispatch.
- Git protected-path fix: a synthetic sentinel demonstrated that the new Git diff/stage preview could expose a tracked `.env` rejected by WorkspaceReader. The fixed service shares the unchanged workspace path exclusions. Relevant tracked excluded endpoints make diff/stage preview fail closed, including rename/deletion endpoints; any excluded staged endpoint blocks commit review. Diff content uses explicit validated literal paths. Status omits excluded names; history messages/branch labels remain metadata, with no whole-history or arbitrary-content secret-redaction claim. Three regressions verify pre-consent refusal, protected staged commits, both rename directions/deletion, shared exclusions and literal pathspec handling. Existing approval, index-lock ownership, interrupted-hook and partial-publication checks remain passing.
- Real-pipe deterministic lifecycle fixture: ten distinct project switches/saved resumes, ten access-mode switches, thirty cancellation/completion cycles and one hundred editor requests passed. All **131 child instances** exited with code 0; instance IDs distinguish reused Windows PIDs. The approximately 27-second synthetic run is not a four-hour live soak.
- Installed OMP 18.6.1, pinned installed default anthropic/claude-opus-5-5, ten cold synthetic editor calls: five whole-buffer and five cursor-window requests produced valid nonempty proposals. Payload fell from 61,440 to 4,096 bytes (93.33%). Observed shutdown-inclusive median was 2,669.6 versus 2,503.2 ms. Fixed whole-then-window pair order, five samples and uncontrolled provider/cache effects do not establish causal speedup, p95 or quality; cost is unknown.
- Offline runtime packaging: all relative packaged Markdown links resolve; linked measurement/benchmark/contract scripts and the single contract helper resolve shipped packages without repository paths. Temporary install/start/authenticated probe/verified uninstall, outside-repository execution and manifest hashes passed **3/3**. This does not constitute the final signed unified installer/update/recovery gate. Actual VSIX/RAD chat.js hashes match ui/src/chat.js; stale ui/dist/chat.js is excluded.
- Replacement signed installer setup-20261009-154200, SHA256 `8A3A5FAEC53F607A1B5932BBEB536BB699622C859D13478EE8903FF2468CFD09`, passed complete payload/runtime/policy checks (test-installer-recovery-stop.log). Actual upgrade to 0.11.0 passed at 16:29:12 UTC (1,056 payload files), rollback to 0.10.0 at 16:30:57 (1,029) and restoration to 0.11.0 at 16:32:13 (1,056), in installed-upgrade-011.json/installed-rollback-010.json/installed-restored-011.json and installed-cycle.log. All stages verified exactly one current product extension per VS2022/2026 installation, RAD32/64 registrations, signatures and preserved settings. This is not a clean-install or physical-x64 claim. Later documentation repacks require their own payload/repair verification. Isolated PipeHost output/intermediates built without replacing the mapped original DLL; earlier package evidence retains its identity.
- Scope clarification: C1 preserves adapter result shapes/correlation/provenance; a universal result envelope is intentionally deferred to separately negotiated migration and does not normalize ACK, stale diagnostics, applied:false or zero tests into completed success. RAD bounded nested scalar properties, including Font fields, are implemented with actual Font acceptance pending; the test-only loader attempt established inspection only, not mutation/persistence. Collection authoring is unimplemented.
- Exploratory Copilot observation used MAI-Code-1.1-Flash in interactive Agent mode for one project-context question. Timing was unreliable and a framework field was omitted; it is not a formal benchmark or superiority result. Kai is not installed locally, so no Kai measurement exists. Unknown availability/license circumstances are not a license-denial finding.
- C++ workload boundary: installed RAD personalities were Delphi only; bcc32c/bcc64/bcc64x were absent. Tiny Win32/Win64/Win64x MSBuild attempts exited 1 with MSB6004 naming missing compiler paths. This is missing-workload evidence, not a C++Builder license-denial or implementation proof. VS2026 C++ workload is also absent. A separate earlier VS2022 C++ fixture passed 3/3 after correcting its fixture project GUID; this does not establish VS2026/RAD C++ acceptance.
- Stop recovery fix: closeSession now waits for both chained file-checkpoint and timeline persistence stages before cancelled/closed and lease release. Focused real-pipe chat/timeline tests passed 12/12. Actual native UI Stop with an unsent draft followed by Retry preserved the draft and saved conversation without automatic replay; model/approval/consent were unchanged. A fresh explicitly requested/approved ide_context snapshot returned PricingBenchmark.sln/Debug/Any CPU at 15:50:22.765 UTC, and the final answer matched at 15:50:25.073. The preceding tiny turn completed without any new tool call but repeated the historical cancellation error instead of RECOVERY_OK; this content failure is preserved separately. Sanitized exact routes are under benchmark-vs/runs/piagent/recovery-native-stop-draft/. Independent Stop/composer Escape draft checks passed 36/36, with shared WebView 91.
- Original v3 understanding attempts 01/02 passed the unchanged exact-answer/source-preservation validator. Attempt 03 was operator-interrupted while an outer OMP approval remained pending and selected two out-of-scope web searches. It remains a failed attempt in the denominator with its original runtime provenance; no final answer or pure-model timeout is inferred. Formal comparative measurement remains incomplete.
- Raw local evidence is under artifacts/ide-agent-20261009/ and adapter bin/Win64/ide-dev-wave*/sdk-fixture-*/ directories. Actual signatures, binary identities, failure receipts and generated stages are preserved. Local artifacts are not automatically public release assets.

At this earlier 0.11.0 checkpoint, remaining M6 gates included strict four-hour soaks, clean-install acceptance, RAD32 UI, physical x64, broader busy-UI fault/IME/nested-property/project acceptance and matched competitor measurements. The separate unsigned-source 240-minute runs above later passed; other coverage and comparison gates remain. Scope-specific passes do not certify all projects or all M0–M6 goals.

Benchmark tasks: tests/fixtures/ide-benchmark/tasks.json. Run node scripts/ide-benchmark.mjs <runs.jsonl> <report.json> on independently evaluated measurements; the script groups matching conditions and does not execute tasks or prove correctness. Unknown costs remain unknown, unsuccessful/unsupported attempts remain in the denominator, and p95 requires at least 20 successful comparable samples. No formal comparative performance result has been published.

[Candidate usage](IDE-AGENT-INTEGRATION.en.md) · [제한적 사전 릴리즈](RELEASE-0.11.0.md) · [Scoped prerelease](RELEASE-0.11.0.en.md).

## 0.10.0 VS IDE intelligence (2026-10-09)

- 전체 Core 회귀: **161/161 PASS**. Named Pipe 기능 협상, IDE 단일 승인·거절·계획 모드·취소·오래된 응답, 도구 없는 편집기 추론, UTF-16/Unicode, 문서 revision, 빠른 요청 교체를 포함한다.
- C# native 도구 콘솔: **17 PASS**. 경로 제한, TRX 실패·건너뛰기 전용 결과·카운터 부재·XXE, Unicode 인자, 출력 제한, 취소와 소유한 하위 프로세스 정리, Roslyn 참조·호출자·미저장 진단.
- C#/Delphi adapter 통합 **17/17 PASS**, 최종 서명 VSIX 내부 채팅 화면 **75 PASS** 및 12회 도킹·탭·숨김 전환 PASS.
- 서명 통합 설치파일과 전체 내장 payload 해시, ARM64/x64 번들 Node 인증 연결·기능 협상·ping, 설치 정책 보존과 VS 버전 경계 검사 PASS. Setup·VSIX·내부 DLL·RAD32/64 BPL·PipeHost의 서명과 타임스탬프를 확인했다.
- 실제 VS2026 18.10.3, 별도 `PiAgentIntelligence` 프로필, 독립 .NET8/xUnit fixture에서 기본 도구 요청→Core→native SDK→결과 흐름을 직접 확인했다. 시험용 OMP 공급자는 결정적으로 도구를 호출하며 실제 VS 결과를 바꾸지 않는다.
- 솔루션의 프로젝트 2개, `Add` 참조 3개, VS build 완료 성공, 미저장 오류 `CS1525`/`CS1002`, 필터 테스트 실패 1개와 원인, 실행 취소 후 통과 1개를 확인했다.
- 인라인 회색 텍스트→Tab 수락→Ctrl+Z, 다음 수정 marker→Tab 위치 이동→Tab 수락→저장 시 `a - b`→실행 취소 후 `a + b`를 확인했다. 포커스와 위치 이동 취소 문제를 이 검증 중 수정했다.
- 디버거 중단점·시작·중단 상태 stack/locals·Step Over·`value` 평가 **5**·계속·종료를 실행했다. VS에 연결된 fixture 프로세스의 CPU **2초** 추적과 상위 **9개** 함수 보고서를 확인했다.
- 실제 설치 OMP와 기본 모델의 별도 도구 없는 추론에서 **2.4초** 만에 유효한 인라인 JSON 제안을 받았다. 이는 deterministic 공급자 검증과 별도로 실행했다.
- 한국어·영어 문서 링크/명령 일치 및 홈페이지 버전·언어 선택·테마 검증 PASS.
- 이 PC의 VS2026/VS2022와 RAD32/64에 서명 0.10.0을 설치하고 등록 버전을 확인했다. 기존 Core 접근 정책·OMP·workspace 설정을 보존했으며 최신 .NET Framework 진단 실행파일로 설치 Core의 새 시작과 재연결을 확인했다.
- VS2022 **17.14.37411.7**에서 실제 메뉴 4개와 `Editor Suggestions` 설정 페이지 로드, 자동 제안 두 항목 `False`, 지연 **1000 ms**, 빈 provider/model 기본값을 추가 확인했다. VS2022 전체 기능 검증 완료를 의미하지 않는다.

실제 UI 검증과 자동 fixture 검증을 구분한다. 새 기능의 VS2022 전체 UI, VB/C++ 전체 언어별 사용과 한글 IME 조합은 추가 수동 검증 대상이다. Native C++/.NET Framework CPU, 메모리 분석, Test Explorer 상태 조작, 다중 문서 next-edit는 지원 범위 밖이다. RAD VCL/FMX 기존 검증 이력은 아래에 유지한다.

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
