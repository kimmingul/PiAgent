# IDE catalog contract v1

`ide.catalog.v1` is additive to pipe protocol v1 and requires `ide.tools.v1` and
`chat.v1` negotiation. Legacy connections retain the existing bridge contract.
Catalog availability is an adapter observation and never grants write access.

## Snapshot

```json
{"schemaVersion":1,"workspaceUri":"file:///D:/example/","revision":"opaque-state-fingerprint","capturedAt":"2026-10-09T00:00:00Z","entries":[{"tool":"ide_context","availability":"supported","backend":"ToolsAPI","languages":["Delphi"]},{"tool":"ide_build","operation":"build","availability":"supported"},{"tool":"ide_diagnostics","availability":"unavailable","reasonCode":"native_diagnostics_unavailable","reason":"No public native diagnostic enumeration was verified."}]}
```

Snapshots are at most 64 KiB, with 0–64 unique `(tool,operation)` entries. `tool`
is an `ide_` identifier, at most 128 UTF-8 bytes. Optional `operation` and
`backend` are bounded to 128 bytes. `revision` is at most 256 bytes and binds
workspace, selected project/configuration, relevant debugger/build state and
dirty-buffer state. Exclude `capturedAt` from this fingerprint.
The snapshot and each entry may include optional `implementationVersion`, a
nonempty string of at most 128 UTF-8 bytes. This identifies the adapter/backend
implementation; it does not replace `schemaVersion` or prove SDK availability.

`availability` is `supported`, `partial`, `unavailable`, or `blocked`.
Unavailable/blocked entries require `reasonCode` (128 bytes) and `reason`
(2048 bytes). Optional `languages` and `frameworks` have at most 32 strings of
128 bytes each. No commands, environment variables or credentials are included.
Only supported/partial entries become actionable tools. More specific operation
entries override a broad tool entry. An empty catalog fails closed.

## Startup, publication, and querying

The adapter supplies `chat.open.ideCatalog` with its bound workspace snapshot.
The response includes `ideCatalogEnabled` and, when supplied, `ideCatalog`.
Without a snapshot a catalog connection exposes only `ide_catalog` initially.
Core does not ask for SDK work while `chat.open` blocks an adapter worker.

When idle, `ide.catalog {sessionId,catalog}` publishes a fresh snapshot and
updates registered OMP tools. `ide.catalog {sessionId}` reads the last snapshot
without SDK work. Publication during a turn is rejected as busy. The Core emits
`chat.event` with `kind:"omp_event"` and `frame:{type:"ide_catalog",catalog}`.

The model may call tool `ide_catalog {}`. The existing adapter request frame is
`{type:"ide_request",id,operation:"ide_catalog",args:{}}`. The adapter responds
with `ide.reply {sessionId,requestId:id,result:SNAPSHOT}`. The same round trip is
used before and after approval for side-effecting operations. Result publication
during that round trip updates the visible catalog but does not change the
registered tool set in the middle of a turn.

## Approval and state binding

Core rejects unavailable operations and controls in plan/read-only mode. IDE
approvals expire after five minutes and remain single-use. A declined, expired
or cancelled consent produces no execution request. Core compares fresh catalog
revisions on either side of approval; a changed state requires a new approval.

Side-effecting execution frames carry top-level
`expectedState:{workspaceUri,revision}`. The adapter must revalidate this state
immediately before invoking SDK operations and reject changed state. Keep this
field out of model arguments. Existing action arguments remain unchanged.
Pure reads omit this revision precondition so a startup snapshot cannot prevent
fresh observations after user edits. Adapters still enforce workspace ownership.
`ide_cancel` retires pending work; cancellation cannot reverse a committed side
effect. Never replay uncertain execution after disconnect.

`designer_cancel` is emitted for catalogue-negotiated connections when designer
work is cancelled/times out or the connection closes. Adapters retire queued
requests, avoid submitting a reply for a retired request, and report already
committed effects accurately. Legacy designer connections retain prior frames.

## Existing tool extensions

`ide_build` accepts optional `operation:build|rebuild|clean`, `project`,
`configuration`, `platform`, `backend:native|external`, retaining `rebuild:boolean`. Advertise only supported
operations. Build and test invocation are side effects even when no source changes.

Catalog connections may expose `ide_refactor` with
`operation:rename|format|simplify|apply`, optional `file`, `line`, `column`,
`newName`, `proposalId`, `revision`. Preview operations require `file` and are
read-only. Apply requires `proposalId` and `revision`, Core approval, and adapter
revalidation of the complete preview. Returning a preview is not permission to
apply it. Native editor undo and file checkpoints have distinct recovery scopes.

Core caches a bounded immutable refactor preview with `proposalId`, `revision`
and `files:[{path,before,after,beforeRevision}]`. Paths must be relative workspace
paths; `beforeRevision` is SHA-256 of UTF-8 `before`. At most eight changed files
and 128 KiB per before/after side are accepted. Apply consent renders these actual
changes from the adapter cache. Model-supplied preview text is never accepted.

`ide_profile` accepts `operation:cpu|gc|compare`, `processId`, optional
`durationSeconds:1..30` and `baselineTrace`. A baseline is an adapter-issued opaque
trace ID bound to the same workspace, never an arbitrary path. Backends report
their actual measurement scope: process CPU counters do not supply call stacks,
allocation estimates or GC measurements. Unsupported operations remain unavailable.

`ide_run` accepts `operation:inspect|publish-preview|publish`, optional `project`,
`configuration`, `framework`, `proposalId`, and `revision`. A publish preview
returns the immutable proposal `{project,backend,arguments,outputDirectory,scope}`.
Core caches and renders that concrete proposal before approved publication. The
adapter revalidates its cached plan and state. Publishing is confined to isolated
local output and executes project build targets; it never grants remote publishing.

## Designer structural changes and recovery

The catalog may expose `ide_designer_preview_change`,
`ide_designer_apply_change`, `ide_designer_preview_restore`, and
`ide_designer_restore_change`. All require the existing designer bridge and
explicit adapter support. Preview operations remain available in plan mode;
apply/restore require writable mode and separate concrete consent.

Change preview arguments are `changeOperation:createComponent|deleteComponent|bindEvent`
plus operation-specific `type`, `name`, `parent`, `x`, `y`, `width`, `height`,
`component`, `property`, `eventMethod`, and `create`. Core derives document identity
and inspected revision from `inspect`; the model cannot replace that binding.
Types must exactly match `inspect.creatableTypes`. Coordinates are integers
-32768..32767, dimensions 1..32767. Existing components and advertised structural
operations are checked before requesting an adapter preview.

Adapter `previewChange` and `previewRestoreChange` return
`{proposalId,document,revision,diff,expiresAt,operation,recovery:{supported:true,scope:"source_and_form"}}`.
Core caches a bounded immutable diff (128 KiB, eight previews, maximum five
minutes), displays it for consent and re-inspects state on either side. Apply
arguments contain only `proposalId` and `revision`; restore preview takes
`checkpointId`. Actual restore submits cached `proposalId`, `checkpointId`,
`document` and `revision`. Tokens are
single-use. An adapter must preserve a recoverable journal before mutation and
refuse restoration over concurrent user edits. Partial application/restoration
must be reported accurately with the retained checkpoint. Deletion must remain
unavailable until byte-preserving recovery and concurrent-edit refusal are tested.

## Local reviewed Git operations

`workspace.git.v1` requires authenticated `workspace.read.v1` and `chat.v1` and is
independent of IDE/designer capabilities. `workspace_git` supports local `status`,
`diff`, `log`, `branches`, `preview-stage`, `preview-commit`, and `apply`. Stage
preview requires 1–64 explicit relative files; commit preview requires a message.
The immutable review contains `previewId`, `revision`, `operation`, `title`,
`diff`, `files`, optional `message`, and `expiresAt`. The service binds HEAD, index,
status and selected file bytes before/after preview and immediately before apply.
Reviews are bounded to 256 KiB, sixteen cached tokens and five minutes.

Apply is excluded in plan/read-only mode and uses the existing owning-adapter
consent card with the actual cached diff. Staging changes the Git index; commits
honor local hooks/signing configuration. The service holds its own native index
lock, executes against an isolated index and publishes the reviewed index after
successful execution. Existing writer locks are respected. Binary changes, custom
clean filters, links and selected files with staged changes require manual review.
There is no push, branch switch, reset or remote action. Concurrent manual ref moves
are not claimed atomic. A completed commit whose index cannot be published reports
`state:"partial"`; interrupted commit execution reports `state:"outcome_unknown"`.
Both require inspection of HEAD/index before retry because hooks or a commit may
already have executed. Post-application verification failure is reported separately.

## Result correlation and provenance

This additive contract preserves existing adapter result shapes rather than
inventing a universal completion state for arbitrary reads. Request frame `id`
and reply `requestId` correlate transport work; the enclosing chat event binds
session/turn ownership. Catalog `capturedAt` describes discovery, not the age of
every diagnostic result. Build/test/debug/profile/design results must report their
actual target, outcome and provenance where the adapter has that evidence. A
request acknowledgement, missing result, observation with `mayBeStale:true`,
`applied:false` or zero tests cannot be normalized into completed success. Errors,
timeouts and cancellation preserve uncertainty and are never replay instructions.
A future uniform result schema needs a separately negotiated capability and
adapter migration; Core will not fabricate SDK completion from unknown payloads.

## Editor context windows

The separate `editor.context.v1` capability requires `editor.suggestions.v1` and
authenticated workspace binding. `editor.suggest` may include
`context:{start,totalLength,revision}`. `start` and `totalLength` are full-document
UTF-16 offsets/length; `revision` is the SHA-256 of the full buffer UTF-8 text.
`text` is a cursor-containing window at most 64 KiB and `position` is local to
that window. The adapter must avoid splitting a Unicode surrogate pair when
selecting the window. Core validates local inference ranges, adds `context.start`
to the returned suggestion start and returns the full-buffer revision. Next edits
are restricted to the supplied window; no cross-document edit is inferred.
`recentEdits.start` is also a local UTF-16 offset; adapters shift/filter history
when selecting a window. At most eight typed `{start,removed,inserted}` records
and 8 KiB of aggregate history are accepted.

Core validates relative document identity through the workspace exclusion/link
policy. The final file may not yet exist, provided its canonical parent directory
exists inside the workspace. No file is created or disk text read for inference.
Untitled documents without a safely bound path remain unsupported.

Suggestion results include payload-free phase `timing`: queue, OMP-ready,
configuration, first token (nullable), inference, total milliseconds and context
byte count. Total includes process retirement; first token is measured from prompt
submission. Lifecycle logs carry only phase/duration, not source text or prompts.
Processes remain isolated and tool-free; no pooling/reset assumption is introduced.
