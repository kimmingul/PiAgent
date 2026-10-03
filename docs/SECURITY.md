# PiAgent 0.5.0 local connection security

CLI는 기본적으로 secure pipe를 사용한다. 먼저 `npm run build:transport`와 `npm run build`를 실행한다.
배포 ZIP에는 pipe host가 포함되며 Node.js 24 LTS 외에 Windows용 .NET 8 이상 runtime이 필요하다.
Core의 IDE-neutral TypeScript 로직은 유지하고, 작은 C# host가 Windows Named Pipe 생성과 byte relay만 담당한다.
native Node addon이나 localhost TCP listener는 사용하지 않는다.

```powershell
npm start -- --omp C:\Users\kimmi\AppData\Local\omp\omp.exe --cwd D:\source\PiAgent --workspace D:\source\PiAgent
```

- Pipe DACL은 현재 사용자 SID만 허용하고 network logon을 거부한다. PIPE_REJECT_REMOTE_CLIENTS를 생성 시 적용한다.
- 첫 pipe에는 FILE_FLAG_FIRST_PIPE_INSTANCE를 적용한다. 기존 listener가 있으면 startup은 실패하며 insecure fallback을 하지 않는다.
  accept 중 항상 적어도 하나의 handle을 유지한다. 동시에 16개 연결만 허용한다.
- 256-bit key는 `%LOCALAPPDATA%\PiAgent\security\<pipe-name>\token`에 보관한다.
  디렉터리/파일은 현재 사용자만 허용하는 ACL로 생성한다. 기존 파일의 owner/ACL/형식, reparse point, hard link를 검사한다.
  key는 command line, 진단 로그, WebView, Git, release ZIP에 포함하지 않는다.
- VS와 Delphi adapter 및 probe는 pipe별 기본 credential을 자동 발견한다. 다른 위치는 daemon `--auth-file` 및
  adapter/probe `PIAGENT_AUTH_FILE` 환경변수로 지정한다. IDE 환경변수를 변경하면 IDE를 다시 실행해야 한다.
- Core와 adapter는 HMAC-SHA256 challenge로 서로 key 소유를 확인한다. 실제 key를 pipe로 전송하지 않는다.
  인증 전에는 hello/ping/chat/workspace를 사용하지 못한다. 인증과 hello는 연결 후 10초 안에 완료해야 한다.

`--dev-pipe`는 인증이 없는 기존 protocol 개발용이다. CLI에서 OMP/workspace/auth-file과 함께 사용할 수 없다.
프로그래밍 API `startDaemon`의 기본은 기존 test fixture를 위한 development pipe이다.
외부에서 사용하는 daemon에는 `secure: {}`를 지정한다. 이전 adapter 버전은 secure daemon에 연결할 수 없으므로 함께 업데이트한다.
credential이 없거나 인증이 실패하면 일반 hello로 downgrade하지 않는다.
개발 pipe 테스트에 연결하려는 IDE adapter는 `PIAGENT_DEV_PIPE=1`, Node simulator는
`PipeClient.connect(path, {authenticate:false})`로 명시해야 한다. credential이 존재하면 개발 설정으로도 인증을 생략하지 않는다.

## Authentication v1

framing/JSON-RPC protocolVersion 1은 그대로 유지한다. credential은 64 lowercase hex로 저장한다.

1. adapter → `core.auth.challenge {clientNonce}`: 32 random bytes의 lowercase hex.
2. Core → `{scheme:"hmac-sha256.v1", serverNonce, serverProof}`: 새 32-byte nonce와 아래 server HMAC.
3. adapter는 serverProof를 비교한 뒤 `adapter.auth {proof}`를 보낸다.
4. Core → `{authenticated:true}`. 이후 기존 `adapter.hello` capability negotiation을 수행한다.

HMAC key는 credential을 hex decode한 32 bytes이다. 입력은 다음 UTF-8 문자열이며 마지막 newline은 없다.

```text
piagent.<server|client>.v1\n<pipe-name>\n<clientNonce>\n<serverNonce>
```

nonce/proof는 정확히 64 lowercase hex이다. 각 연결에는 한 challenge와 한 proof 시도만 허용한다.
challenge는 30초 후 만료하지만 transport의 10초 인증/hello deadline이 우선한다.
다른 연결의 proof, 이전 연결의 replay, 다른 pipe/domain의 proof는 실패한다.
오류 -32020은 인증 필요/실패를 나타내며 key나 proof를 echo하지 않는다. notification은 인증 상태를 변경하지 않는다.

## Scope

이 기능은 다른 일반 Windows 사용자와 원격 pipe client의 접근을 제한하고 credential 소유를 확인한다.
같은 Windows 사용자로 실행 중인 악성 코드, 관리자/SYSTEM, credential 유출 또는 악의적인 동시 파일 교체를 격리하는 sandbox가 아니다.
adapter.kind/ideVersion은 자기 보고 metadata이며 VS/Delphi executable 서명 attestation을 의미하지 않는다.
IDE와 daemon은 같은 일반 사용자 권한으로 실행한다. credential file 공유와 관리자 실행을 운영 방식으로 사용하지 않는다.
0.6.0 파일 변경은 secure transport, 명시적 --workspace/--allow-writes와 workspace.edit.v1 협상이 모두 필요하다.
OMP에는 제안 도구만 제공하며 소유 adapter의 diff/revision 승인으로만 적용한다.
[승인·checkpoint의 범위와 장애 복구](APPROVED-CHANGES.md)를 참고한다.

API 근거: [Win32 pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights),
[CreateNamedPipe](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipew).
