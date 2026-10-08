# PiAgent 0.9.20 — OMP work state and continuing conversations

[한국어](RELEASE-0.9.20.md) · **English** · [Documentation](README.md)

Prerelease dated 2026-10-09. [Signed installer and SHA-256](https://github.com/kimmingul/PiAgent/releases/tag/v0.9.20).

Fixed an early “Stopped” display when one assistant response was aborted but native OMP continued
working. PiAgent retains ownership until `session_settled` or a `prompt_result` confirms full settlement.
An individual aborted `message_end`, `agent_end`, or unsettled `prompt_result` does not end the whole
operation. Subsequent answer text and tool events remain visible. Explicit user cancellation and
process failure handling remain available.

When asynchronous OMP work rejects a normal prompt as busy, PiAgent queues that confirmed rejection
once as a follow-up without terminating the running process. If queue admission also fails, it displays
guidance and retains the running state and stop control. Timeouts and unclassified rejections are not
automatically resubmitted, preserving the existing protection against duplicate execution.

Removed PiAgent's arbitrary five-minute timer for questions and approvals. OMP owns dialog deadlines
and cancellation; PiAgent follows OMP's `cancel` events. No answer or approval is chosen automatically.
A closed dialog receives guidance explaining that it may have expired or been cancelled.

Prompt rejections show recognized categories: busy execution, context overflow, authentication and
provider limits. Diagnostics store only the category, without exposing raw provider errors, keys or
authentication URLs. Unknown failures retain a generic message; this release cannot recover original
errors discarded by older versions. Failed automatic compaction no longer displays “Compaction complete.”

Also addressed intermittent Windows denial of `session.json` replacement during concurrent session
reads. Only Windows sharing-related errors receive short, bounded retries while retaining the exclusive
lease and existing file. The destination is never deleted as a fallback; persistent failures remain errors.

Restore checkpoint limits remain unchanged: existing Git-tracked UTF-8 files, 32 KiB per file, at most
eight changed files per response and 256 KiB of combined before/after content. Exceeding the limit shows
that a complete restore checkpoint could not be recorded. Actual file changes are preserved; this notice
does not mean work stopped. A partial checkpoint is not presented as a complete restore point. Review
large changes with Git diff and preserve them using Git. New files, deletions, binaries and unsaved IDE
buffers remain outside this checkpoint scope.

Guidance is available in Korean and English. Model answers and external tool results are not translated.
RAD Studio support and form designer scope remain as documented in [0.9.18](RELEASE-0.9.18.en.md),
and language settings remain as documented in [0.9.19](RELEASE-0.9.19.en.md).

Existing conversation JSONL files and message snapshots were preserved. Validation uses isolated
workspaces and substitute OMP processes without interrupting the user's development run or changing
their project. Download the new installer, close all selected IDEs, install and reconnect PiAgent.
Publishing an update does not replace an already running Core or IDE.

Passed the complete regression suite **155/155** and C#/Delphi adapter integration **17/17**.
Concurrent session recovery stress checks passed **20/20** isolated runs. Coverage includes continuing
after assistant abort, busy rejection and queue failure, dialog waiting/cancellation, file/byte checkpoint
limits, and preservation of files and Git state. Signature and setup payload checks are added to the
release's Validation section. This release does not claim new
long-running acceptance with every provider account or completion of outstanding VS2022/RAD32 live tests.
