# Approved file changes — 0.6.0

VS Chat에서 변경안을 검토하고 개별 승인한 뒤 적용하거나, checkpoint의 역방향 diff를 검토하고 복원한다.
기본 실행은 계속 읽기 전용이다. Node.js 24 LTS, .NET 8+ 및 PATH의 Git이 필요하다.

```powershell
npm start -- --omp C:\path\omp.exe --cwd D:\project --workspace D:\project --allow-writes
```

`D:\project`는 HEAD commit이 있고 `.git` 디렉터리가 있는 standalone Git 저장소 루트여야 한다.
Git worktree의 `.git` 파일이나 submodule 루트는 이번 버전에서 지원하지 않는다.
Secure transport와 `chat.v1`, `workspace.read.v1`, `workspace.edit.v1` capability가 필요하다.
VSIX와 Delphi BPL은 선택 capability를 요청하고 같은 WebView 승인 UI를 사용한다.

## 사용 순서

1. VS에서 Tools → PiAgent: Open Chat을 열고 자동 연결을 기다린다.
2. 기존 파일 변경을 요청한다. OMP의 `workspace_propose_edit`가 대상·이유·전체 diff를 표시한다.
3. diff를 검토하고 승인 또는 거절한다. 각 제안은 5분 후 만료되며 취소/연결 종료도 대기를 해제한다.
4. 완료 후 /restore 또는 설정의 파일 변경 기록에서 항목의 복원 미리보기를 연다. 역방향 diff를 확인하고 복원을 적용한다.
5. 복원 후에는 새 대화를 시작해 모델의 이전 파일 내용과 실제 파일 내용이 혼동되지 않게 한다.

대상은 Git에 추적 중인 기존 UTF-8 일반 파일이며 변경 전/후 각각 최대 32 KiB이다.
0.7.0의 workspace.edit.batch.v1은 1–8개 파일을 한 번에 검토·승인하며 각 side 총 128 KiB 이하다.
생성·삭제·이름 변경·binary·충돌 파일은 지원하지 않는다. 기존 workspace 제외 규칙도 적용된다.
미저장 VS/RAD 문서는 adapter가 모든 대상에 대해 적용/복원을 거절한다. 먼저 저장하고 새 변경안을 요청한다.
다른 IDE/프로세스의 버퍼 상태는 Core에서 알 수 없으므로 승인 시점의 파일 hash를 다시 확인한다.

Diff는 최소 변경 줄만 추리는 방식이 아닌 전체 파일 비교다. CR은 `␍`, BOM은 `⟨BOM⟩`으로 표시하며
마지막 newline 유무도 표시한다. 원본 및 제안 bytes를 그대로 보관하므로 BOM/CRLF를 자동 정규화하지 않는다.
제안 후 파일이 달라지면 승인이 실패하고, 적용 후 다른 변경이 생기면 복원이 실패한다.
승인은 연결 소유 session과 proposal ID/revision에 묶인다. OMP에는 승인/복원 실행 도구를 제공하지 않는다.

## Checkpoint와 장애 복구

변경 전에 raw Git blobs를 저장하고 `refs/piagent/checkpoints/<UUID>/before` 및 `/after`로 보존한다.
사용자 index, HEAD, branch는 변경하지 않는다. 미커밋 파일 내용도 before에 포함된다.
Git hooks와 content filters를 실행하지 않는다. 전체 저장소 또는 OMP session checkpoint는 아니다.
메타데이터는 `.git/piagent/checkpoints/<UUID>.json`에 저장한다. 최근 50개를 표시하고 1,000개에서 새 변경을 중단한다.
자동 정리/삭제는 하지 않는다. metadata와 refs를 함께 보존해야 복원할 수 있다.
Batch metadata에는 files 배열이 있고 refs는 /<file index>/before 및 /after로 보관한다.
모든 파일을 적용 직전에 재검증한다. 일부 적용 오류 시 이미 시도한 파일을 역순으로 복원한다.
그 사이 사용자가 바꾼 파일은 덮어쓰지 않고 recoveryRequired 오류를 반환한다. 전체 batch의 OS 원자성을 보장하지 않는다.

쓰기 전에 `prepared`, 복원 전에 `restoring`을 기록하고 fsync한다. 기존 파일 handle로 내용만 변경하여
파일 identity/ACL/별도 streams를 유지한다. 이 쓰기는 OS의 원자적 파일 교환이 아니다.
오류 시 같은 handle로 원본 복원을 시도하며, 실제 쓰기가 시작되면 취소 요청 후에도 완료 또는 rollback한다.
프로세스 강제 종료/전원 중단은 부분 내용을 남길 수 있다. 악의적인 동시 writer를 격리하는 sandbox도 아니다.

재시작 후 목록은 중단된 metadata와 실제 hash를 비교해 `applied`, `notApplied`, `restored`,
`recoveryRequired`를 표시한다. 불확실한 파일은 자동 덮어쓰지 않는다.
`.git/piagent/checkpoints/write.lock`은 동시 쓰기를 막고, 중단 후 남은 lock은 자동 삭제하지 않는다.
모든 PiAgent writer가 종료됐는지 확인한 뒤 파일/metadata/두 blob을 별도로 백업하고 조사해야 한다.
lock 해제는 이러한 조사 후 수동으로 수행한다. 부분 내용은 보관한 before blob을 이용한 수동 복구가 필요하다.
적용/복원 후 metadata 저장이 실패하면 성공 결과와 warning을 함께 반환하므로 파일 상태를 먼저 확인한다.

Git API: [hash-object](https://git-scm.com/docs/git-hash-object),
[update-ref](https://git-scm.com/docs/git-update-ref), [hooks](https://git-scm.com/docs/githooks).
