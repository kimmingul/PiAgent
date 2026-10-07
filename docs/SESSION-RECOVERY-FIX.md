# NanumPDF saved-session recovery

Verified 2026-10-07 KST on Windows ARM64, Visual Studio 2026, PiAgent 0.9.16.

## Cause and evidence

The VS chat displayed `RPC -32010: Saved session is already active or needs interrupted-session inspection`.
NanumPDF's `last-session` selected a conversation with an empty `active.lock` created on October 6.
The installed Core was newly started on October 7 and no OMP process was running at inspection.
The old store treated every existing lock as an active owner and removed it only during successful
normal cleanup. Automatic last-session resume repeatedly selected that same blocked conversation.
The evidence establishes an abandoned lock, but does not establish whether the previous process
was forcibly terminated, the PC restarted, or cleanup failed.

Two additional startup cleanup gaps were found: preferences and OMP construction were outside
the startup cleanup handler; disconnect could finish cleanup before asynchronous acquisition
completed. Both could strand session ownership even without a machine restart.

## Changes

- Windows leases hold a session-specific OS named pipe guard throughout acquisition, recovery,
  ownership and release. Competing reclaimers cannot remove each other's lock.
- The durable lock records Core PID, OMP PID, a unique owner token and incomplete-spawn state.
  A complete initial record is published exclusively; subsequent state transitions are flushed,
  newline-terminated journal entries. This avoids observed Windows EPERM replacement failures.
- A stale marker is reclaimed only while holding the guard and after both recorded processes
  have exited. Live children remain protected even if their Core died.
- Legacy, malformed, linked, oversized and incomplete-spawn markers remain inspection-required.
  Uncertain process liveness, including PID reuse, is conservatively treated as active.
- Session contents are reloaded after ownership is obtained. Startup errors share cleanup,
  disconnect waits for startup cleanup, and concurrent release callers join the same operation.
- Error messages distinguish a live owner from an inspection-required marker.

No prompt replay or automatic repair of OMP conversation data was added. Automatic reclamation
uses the Windows guard; non-Windows test stores retain conservative exclusive-file behavior.

## Validation and installed recovery

- TypeScript build and full regression: **140 passed, 0 failed, 0 skipped**.
- New process-level tests cover abrupt termination, six competing reclaimers, surviving OMP
  children, unsafe/partial markers, preference failures and disconnect during acquisition.
- NanumPDF's session directory (201 files, 248,377,068 bytes) was copied into the existing private
  security directory's recovery area, and each copied file's SHA-256 was verified.
- Its main JSONL parsed successfully: 1,791 records, 6,359,065 bytes. The before/after SHA-256
  remained `aaae03d18a146d4136d83f6dee38de0f51ce618871c86e8e0917d4d0a4f4261d`.
- The old empty lock was moved into the private recovery backup after verifying no OMP was active
  and stopping only the installed Core. The unrelated workspace's legacy lock was left alone.
- Core/OMP JavaScript was updated in a separate private hotfix release, preserving the original
  release, receipt, signed IDE adapters, transport, runtime, authentication and OMP installation.
  Release-manifest hashes were updated and verified before activation.
- VS2026 stayed open. PiAgent's reconnect restored the same saved conversation, the NanumPDF
  workspace, displayed history and selected model; the UI reported `연결됨`.
- An authenticated second connection was correctly rejected as a duplicate active owner.
  No model prompt was sent and NanumPDF project files were not edited by this repair.

Installed release: `%LOCALAPPDATA%/Programs/PiAgent/releases/0.9.16-session-recovery-20261007125243`.
Private backup: `%USERPROFILE%/.piagent/security/piagent-dev/recovery/session-lock-20261007125243`.
Evidence: `artifacts/session-recovery-regression.log` and
`artifacts/session-recovery-20261007125243/{deployment,installed-verification,session-integrity-after}.json`.
The October 7 repair was a local Core hotfix. On October 8, the same fix was included in the
signed [0.9.17 release](RELEASE-0.9.17.md), with refreshed installation and product-site documentation.
Release publication does not automatically replace the running IDE installation.
