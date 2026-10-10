# IDE product comparison protocol

Status: **measured competitor comparison is deferred at the user's request; plans only, with no formal runs, results, or ranking.** Four-hour continuous validation is also deferred. This protocol is retained for future use. [한국어](IDE-BENCHMARK.md)

## Plans and scope

| Plan | Products | Tasks/repetitions | Attempts |
|---|---|---:|---:|
| [VS plan](../scripts/ide-benchmark-plan.json) | PiAgent / Copilot in VS2026 | 12 × 5 per product | 120 |
| [RAD plan](../scripts/ide-benchmark-plan-rad.json) | PiAgent / KAI in RAD13.2 | 12 × 5 per product | 120 |

Both plans use `product-default`. This compares each product's actual default experience, with its provider, model, and effort recorded; it does not isolate model quality. Create a separate `matched-model` plan only after the same provider, model, and effort can be configured and verified on both sides. **KAI installation, account, version, and ability to run have not been verified.** Do not begin the RAD comparison until they are checked, and do not invent `unsupported` run records for an unavailable product.

Use the IDs and Korean prompts in the [task specifications](../tests/fixtures/ide-benchmark/tasks.json). These specifications classify tasks; they are not executable fixtures. Before a formal run, create and version an isolated project, locked final prompt, initial IDE state, hidden independent checks, and reset procedure for every task. Never use a user's project. Give both products the same task input, permissions, and per-task time limit. Record an actual `unsupported` outcome if a running product lacks a task capability.

| VS task IDs | Independent acceptance and required artifacts |
|---|---|
| `vs-context`, `vs-symbols` | Identify active configuration and unsaved buffer or correct overloaded symbol; preserve buffer, IDE context/symbol output, and evidence of no edits. |
| `vs-completion`, `vs-next-edit` | Capture proposal location/text before acceptance; build after acceptance; confirm exact Undo or stale proposal rejection after document change; save before/after buffers and UI record. |
| `vs-build-repair`, `vs-refactor` | Confirm actual build completion/diagnostics for the specified configuration and only intended symbol references changed; retain build log, diff, hidden checks. |
| `vs-test-repair`, `vs-debug` | Reproduce original failure, rerun selected tests, use actual breakpoint/stack evidence, and verify repaired behavior; retain test/debugger records. |
| `vs-profile` | Measure before/after on identical input/settings while preserving correctness; retain raw trace, CPU/GC scope, output checks. |
| `vs-designer`, `vs-recovery` | Use supported WPF or .NET Framework WinForms fixture; verify UI/code consistency and running behavior, explicit consent, and restored buffer/file bytes. |
| `vs-deploy` | Verify supported local publish configuration, output files, and completion; retain temporary local output manifest and evidence of no remote effects. |

| RAD task IDs | Independent acceptance and required artifacts |
|---|---|
| `rad-context`, `rad-symbols` | Identify active project/platform and unsaved code. Record unsupported semantic navigation honestly; text matches do not count as semantic results. |
| `rad-completion`, `rad-next-edit` | In the supported preview/accept path, check UTF-8 byte and UTF-16 positions, Korean/emoji/CRLF, and Undo; do not assume native ghost text or Tab support. |
| `rad-build-repair`, `rad-refactor` | Distinguish native build completion from external diagnostic provenance. Record unsupported semantic rename; do not count text replacement as equivalent. |
| `rad-test-repair`, `rad-debug` | Preserve external DUnitX failure/rerun XML and exit status, supported debugger state and stack evidence; do not label it IDE Test Explorer. |
| `rad-profile` | Measure bounded CPU before/after on identical input and check correctness; do not invent call stacks or allocation data. |
| `rad-designer`, `rad-recovery` | Use direct standard VCL/FMX fixtures; verify creation, property, event, save/reopen, run, and exact source/form restoration. Check inherited/third-party support separately. |
| `rad-deploy` | Verify manifest/output/platform inspection. Do not mark deployment successful without a verified completion signal. |

## Lock before each attempt

1. Record product-specific IDE profiles: version, installed features, extensions, account, provider/model/effort. Use the same machine, IDE build, fixture commit, configuration/platform, prompt language, time limit, approval policy, and network conditions. If a running product lacks a feature, record its actual `unsupported` outcome.
2. Lock the **final** Korean prompt and independent acceptance definition for each task in files; record their SHA256 values as `promptHash` and `acceptanceHash`. Specify selected file/caret, unsaved text, debugger state, test filter, and temporary publish target in the fixture manifest. Set `fixtureRevision` to that fixture's commit/hash and `environmentRevision` to the IDE/extensions/settings manifest hash.
3. Restore the fixture before every attempt and check buffers, forms, build output, test results, local publish directory, and session/cache state. Save the reset command, initial file hashes, and IDE-state evidence under a unique `resetEvidence` path for that attempt. Do not start if reset fails. When the task requires an initial failure, include proof that it was reproduced.
4. Alternate product order for every task and repetition (odd: PiAgent first; even: comparator first). Keep `cold` and `warm` in separate plans or clearly separated results. Preserve run order, timestamps, and operator interventions in raw logs.
5. Fix a common per-task time limit before execution. Record every timeout, cancellation, failure, and unsupported attempt. Track approval/denial and edit counts, model latency versus IDE/transport waits, and first useful suggestion latency.

## Run records and interpretation

One JSONL line represents one attempt. Required `scripts/ide-benchmark.mjs` fields are `runId`, `product`, `productVersion`, `ide`, `ideVersion`, `taskId`, `fixtureRevision`, `machine`, `provider`, `model`, `effort`, `permissions`, `cache`, `mode`, `startedAt`, `elapsedMs`, and `outcome`. The comparison plan also needs `suiteId`, `repetition` (1–5), `promptHash`, `acceptanceHash`, `environmentRevision`, and `resetEvidence`. Set `mode` to the plan's `product-default`. Unknown token, cost, memory, or CPU values must be `null` or omitted, never zero.

The actual `outcome` is `passed`, `failed`, `timeout`, `unsupported`, or `cancelled`. A `passed` run requires at least one independently verified `checks` entry with a name and evidence path, and all task-specific hidden checks must pass. An answer or an acknowledged build/publish command alone is not completion. Keep raw logs, traces, diffs, IDE screen records, and test output per attempt for independent review. Out-of-scope web searches and operator stops remain visible failures or cancellations.

Run these examples **only after** real JSONL records and locked fixtures exist:

```powershell
node scripts/ide-benchmark.mjs evidence/vs-runs.jsonl evidence/vs-report.json scripts/ide-benchmark-plan.json
node scripts/ide-benchmark.mjs evidence/rad-runs.jsonl evidence/rad-report.json scripts/ide-benchmark-plan-rad.json
```

The assessor exposes out-of-plan records, duplicate or missing attempts, condition mismatches, and absent evidence fields. Coverage of 12 tasks × 5 repetitions does not itself establish correctness or superiority. Keep failures, timeouts, unsupported attempts, and cancellations in the completion-rate denominator. Compare latency only among attempts that passed the same independent checks; five repetitions per task do not justify a p95 claim. Present raw per-product/task/repetition values, range, interventions, and unknown costs alongside any aggregate.
