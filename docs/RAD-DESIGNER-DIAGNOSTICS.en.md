# RAD Studio form designer approval and edit restrictions

[한국어](RAD-DESIGNER-DIAGNOSTICS.md) · **English** · [Documentation](README.md)

2026-10-08 KST · PiAgent 0.9.18 · RAD Studio 13.2 64-bit / OMP 18.6.1.

## Confirmed causes

The actual IDE had both PiAgent 0.9.15 and 0.9.16 BPLs registered, but loaded 0.9.15.
The unified installer updated Core and RAD32/64, leaving one 0.9.18 entry in each registration location.
Existing settings, OMP installation and conversations were preserved. If an old BPL remains loaded,
updating Core alone still leaves the old designer-state logic in use.

With OMP `always-ask`, even inspection requires approval for `Allow tool: ide_designer_inspect`.
This is not a Windows administrator-privilege request. Earlier test records also contained denied inspection calls;
that does not establish that every error experienced by the user had this cause.
The official [OMP approval modes](https://github.com/can1357/oh-my-pi/blob/main/docs/approval-mode.md) and
[18.6.1 RPC implementation](https://github.com/can1357/oh-my-pi/blob/v18.6.1/packages/coding-agent/src/modes/rpc/rpc-mode.ts)
were inspected. Current host-tool registration has no field for specifying the inspection tool's approval tier.
PiAgent preserves approval policy and adds operation scope and denial/cancellation explanations to the card.

The RAD adapter blocks writes when the module has unsaved changes. Older Core returned a generic edit-unavailable
error instead of this specific cause, while some properties still appeared writable.
0.9.18 removes the inconsistency and communicates the actual restriction to the model.

## Recovery by result

| State / result | Meaning and action |
|---|---|
| `Allow tool: ide_designer_inspect` | OMP approval to inspect the open form. Approval permits inspection; denial/cancellation prevents execution. |
| `Tool call denied by user` | OMP tool execution was denied. If the operation is wanted, approve that tool in a new request. |
| `writeBlockCode: unsaved_changes` | The target module has unsaved edits. Save in the IDE, then inspect and approve again. |
| `source_read_only` | The IDE designer reports read-only source. Investigate the actual read-only state of the project. |
| `modification_service_unavailable` | The IDE modification service is unavailable. Check that the target form is open in a working designer. |
| `unsupported_framework` | Outside the native tool's supported scope. Check the framework and supported operations. |
| `hostAccess.canWrite: false` | Plan mode, connection capabilities or Core write/Git configuration blocks writes. Follow the accompanying reason. |
| stale revision | The form changed after inspection. Inspect again and reapprove the proposed change. |

Normal workflow: open form → approve inspection tool → check snapshot → approve change tool → review/approve
IDE values → save → reinspect → build/run. IDE approval frequency depends on the selected approval mode.
Under `always-ask`, OMP tool approval and review of actual IDE values are separate steps.
Administrator execution or switching to a permission-bypass mode is unnecessary.

## Validation scope

Separate Git fixtures were used instead of the user's project; model prompts prohibited direct source edits.
With the installed 0.9.18 BPL, VCL and FMX both passed actual inspection, Caption changes, IDE save,
reinspection and running-window checks. Unsaved FMX edits were reproduced directly, with specific restriction
and save/reinspect guidance and no file modification. See the [release record](RELEASE-0.9.18.en.md) for final package/regression results.

Supported tools inspect forms, change scalar properties, connect limited references and move existing component parents.
Native designer tools do not cover all component creation/deletion, handler generation or complex properties/collections.
Those tasks require approved source edits followed by designer reinspection and build/run verification.
RAD32 build/signature/registration checks are distinct from RAD64 live validation.
