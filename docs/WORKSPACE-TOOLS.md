# Read-only workspace tools — PiAgent 0.4.0

Core를 다음처럼 실행한다. --workspace는 명시적 선택 사항이며 --omp도 필요하다.
OMP cwd와 읽기 root는 서로 별개다. adapter나 모델이 root를 바꿀 수 없다.

```powershell
npm start -- --omp C:\Users\kimmi\AppData\Local\omp\omp.exe --cwd D:\source\PiAgent --workspace D:\source\PiAgent
```

VS Chat → 연결에서 읽기 전용 workspace URI가 표시된다. 예: "workspace_search로 ChatSession을
찾고 workspace_read_file로 해당 파일을 읽은 뒤 설명해 주세요." 모델이 도구를 선택하며
UI는 파일 조회 시작/완료와 답변을 표시한다. 읽기 내용은 OMP가 사용 중인 모델로 전달된다.
새 대화는 읽은 내용이 포함된 이전 대화를 초기화한다. 도구는 디스크 파일만 읽으며 미저장 IDE 버퍼는
선택 코드 첨부를 사용한다. VS solution을 열어도 daemon의 읽기 root는 자동 변경되지 않는다.

## Capability and host tool contract

`workspace.read.v1`은 `chat.v1`과 함께 협상한다. --workspace가 없으면 제공하지 않는다.
VS는 선택 capability로 요청하므로 기존 daemon에서도 일반 채팅은 동작한다.
협상한 연결의 chat.open은 toolsEnabled:true, readOnly:true, workspaceUri를 반환한다.
OMP ready/new_session 다음 첫 prompt 전에 set_host_tools로 아래 두 도구만 등록한다.
OMP 기본 도구/확장/skills/rules/LSP는 기존 --no-* flags로 계속 비활성화된다.

- workspace_read_file: `{path, startLine?:1, maxLines?:100}`. 상대 경로, 1-based line, 최대 200줄,
  출력 text 최대 32 KiB. 요청한 첫 줄 자체가 한도를 넘으면 오류이다.
- workspace_search: `{query, path?:"", caseSensitive?:true, maxResults?:20}`. 최대 256 UTF-8 bytes의
  한 줄 literal query이다. regex/shell/glob을 실행하지 않는다. 최대 50개 결과, 일치점 주변 약 512 UTF-16
  code units의 snippet, 상대 path와 1-based line을 반환한다. 최대 500파일/5000 filesystem entries를 방문한다.

입력은 unknown fields/null/잘못된 숫자 등을 거부한다. 두 결과 모두 truncated를 제공한다.
읽기는 UTF-8 text 파일 최대 256 KiB만 지원하며 binary/NUL/invalid UTF-8 파일은 거부한다.
검색에서는 읽을 수 없는 파일을 건너뛰므로 결과는 완전한 저장소 색인이 아니다.
검색 순서는 filesystem 순서이며 정렬하지 않는다.

host_tool_call의 id로 host_tool_result를 짝짓고 isError는 result 밖 envelope에 둔다.
host_tool_cancel.targetId 또는 chat.cancel/close/종료가 도구를 취소하면 결과를 보내지 않는다.
10초 deadline은 오류 결과를 보내며, 동시에 최대 4개/턴당 최대 32개의 도구 호출을 허용한다.
중복/잘못된 call ID 또는 budget 초과는 세션을 종료한다. raw OMP 결과를 IDE에 전달하지 않으며
chat.event에 tool_started/tool_completed와 고정 도구 이름만 추가한다.

## Filesystem boundary and exclusions

root는 startup에 realpath로 고정한다. 절대 경로, .., 빈 path component, ADS colon,
Windows device 이름, trailing dot/space, symlink/junction 및 hard-linked files를 거부한다.
읽기 전 canonical containment와 open handle의 file identity/크기, 읽기 후 크기·mtime/path 변경을 검사한다.
항상 read-only handle을 사용하며 파일 쓰기·프로세스 실행 도구는 없다.

`.git/.svn/.hg/.ssh/.aws/.azure`, `node_modules/.tools/artifacts/bin/obj`, `.env`와 `.env.*`,
credentials/secrets 이름 및 pem/key/pfx/p12/kdbx suffix를 제외한다. 이 목록은 모든 비밀을
탐지하는 redaction 체계가 아니다. 읽기 root는 모델에 전달할 수 있는 프로젝트로 지정해야 한다.
경계 검사는 OS sandbox나 악의적인 동시 filesystem 교체에 대한 원자적 방어를 제공하지 않는다.
0.5.0 CLI의 Named Pipe ACL/상호 인증은 [SECURITY.md](SECURITY.md)를 따른다.
권한이 필요한 쓰기 도구를 추가하기 전에 승인·checkpoint를 구현해야 한다.
