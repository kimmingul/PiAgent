# PiAgent pipe protocol v1

문서 상태: 2026-10-09, 구현 0.11.1 후보. pipe protocol은 v1 및 additive capability 협상을 유지한다.
제품 버전과 protocol 버전은 별개이며 CORE_VERSION은 package 버전에서 생성한다.
현재 구현의 인증 후 idle 정책과 turn activity/종료 계약은 아래 해당 절을 따른다.
새 기능을 제공했다고 해서 wire version을 임의로 올리거나 미협상 기능을 활성화하지 않는다.

### IDE workspace and access modes (VSIX 0.9.4)

`workspace.bind.v1` is available only on an authenticated Core with OMP configured.
After negotiation, `chat.open` accepts `workspaceUri`, an existing local directory's
file URI selected by the adapter from its IDE solution. Binding occurs only while
opening a closed session. OMP cwd, workspace tools and the private session namespace
all use its canonical directory. Each connection binds independently; another IDE
never inherits this workspace. No URI is accepted through model tools. Omitting the
field preserves legacy daemon workspace behavior. VSIX supplies it and never falls
back to the Core source repository when no solution is open.

`chat.approval.v1` permits `chat.open.approvalMode` and
`chat.setApproval {sessionId,mode}`. Modes: `always-ask`, `write`, `yolo`, `plan`.
An idle change retires OMP, saves/releases the private conversation, then reopens
the same savedSessionId with a new runtime config and current mode; its result is
the ordinary `chat.open` result. Changes during a turn are rejected. Mode state is
saved with the private session and returned as `approvalMode` and `approvalModes`.
Native OMP uses its official approval-mode CLI setting. IDE changes keep their
revision/dirty-buffer validation: always-ask confirms each, write confirms once
per turn, yolo submits the owning adapter decision automatically. Restore always
requires its own explicit preview/confirmation. Plan starts OMP without native
tools/extensions and registers only read-only host tools; slash commands are rejected.
Plan currently returns its plan as chat text, without creating a plan document.

`chat.prompt.attachments` is an optional array of at most 16 selected file/folder
paths, each at most 4096 characters without newline/NUL. References are labeled as
user-selected data in the prompt; arbitrary binary data are never interpreted as
protocol. Native OMP can inspect these paths using its ordinary tools and policy.
`chat.extensions` is an idle native-profile adapter request for metadata listing,
project MCP configuration editing, plugin toggles and MCP toggles. Responses omit
server command/environment/secrets. Plugin changes restart the same saved chat.

## 두 transport

IDE adapter ↔ Node.js/TypeScript Core: Windows duplex byte-mode Named Pipe / JSON-RPC 2.0.
Core ↔ OMP: `omp --mode rpc-ui` stdin/stdout UTF-8 JSONL / type 기반 OMP protocol.
이 문서의 PiAgent version과 OMP protocolVersion은 독립적이다. wire format을 섞지 않는다.

## Named Pipe framing

기본 endpoint: `\\.\pipe\piagent-dev`. CLI는 짧은 이름을 받는다.
이름은 ASCII 영숫자, -, _만 1~128자다. remote UNC endpoint를 CLI에 받지 않는다.
0.5.0 CLI는 current-user ACL과 remote-client 차단을 적용한 Windows pipe host를 기본 사용한다.
연결별 HMAC 인증이 먼저 필요하다. 전체 nonce/proof 계약은 [SECURITY.md](docs/SECURITY.md)를 따른다.

Frame = `uint32 little-endian bodyLength` 4 bytes + UTF-8 JSON body.
bodyLength는 문자 수가 아닌 byte 수로 1~1,048,576이다. BOM, trailing NUL과 줄 구분자는 없다.
Pipe read/write와 frame 경계는 다르며 부분 header/body 및 여러 frame의 coalescing을 처리한다.
0/초과 길이, header/body 중간 EOF는 응답 없이 해당 연결을 닫는다. frame 사이 EOF는 정상
disconnect다. 초기 handshake 대기와 불완전한 frame의 read deadline은 30초,
write deadline도 30초다. 인증·handshake를 마친 연결은 frame 사이 idle 시간이
길어도 닫지 않는다. IDE UI 스레드가 빌드·디자이너 작업으로 지연되거나 OMP가
오래 실행 중이어도 heartbeat 지연만으로 대화를 취소하지 않는다.
partial bytes는 deadline을 연장하지 않는다. output queue는 2 MiB, 기본 최대 16 connection이다.

## JSON-RPC profile와 ID migration

단일 request object만 받는다. Batch는 -32600. jsonrpc='2.0', method=string이며
params가 있으면 object/array여야 한다. 현재 제공하는 method는 object params만 지원한다.
ID는 string 또는 `Number.isSafeInteger` 범위의 integer(-9007199254740991~9007199254740991).
null, boolean, 실수, 범위를 벗어난 숫자는 거절한다. 문자열 ID를 권장하며 응답에 그대로 반환한다.
이전 Rust skeleton의 signed i64 숫자 ID는 JS 정확도 범위로 좁혔다. 기존 큰 숫자 ID는 string으로
보내야 한다. 배포된 실제 adapter는 없으므로 초기 v1 profile을 이 규칙으로 확정한다.

result/error가 들어 있는 client request는 거절한다. core→adapter request는 아직 없다.
유효한 notification(id 없음)은 응답 없이 무시하며 handshake 상태를 변경하지 않는다.
호출할 method에는 ID를 넣는다. invalid JSON/UTF-8/BOM은 -32700, invalid request envelope는
-32600. 해석 가능한 유효 ID가 있으면 오류에 반환하고 없으면 id:null이다.
Unknown envelope/hello 필드는 확장을 위해 무시하며 ping의 unknown params key는 거절한다.

## State / version / capability negotiation

secure: `Connected → core.auth.challenge → adapter.auth → adapter.hello 성공 → Ready → disconnect`.
development pipe: `Connected → adapter.hello 성공 → Ready → disconnect`.
hello 실패는 Connected를 유지한다. 성공 후 재호출은 -32003. reconnect는 새 Session이다.
PiAgent supported versions는 [1]이다. offered protocolVersions에 1이 있어야 선택한다.
제품 version은 wire protocolVersion과 별개이며 향후 incompatible contract는 새 version으로 올린다.

hello params:

| Field | 타입 / 제한 |
| --- | --- |
| protocolVersions | 1~16개 unsigned u32 integer array |
| adapter.kind | 1~256 UTF-8 bytes, regex `[a-z][a-z0-9-]*`; opaque IDE identifier |
| adapter.version / ideVersion / instanceId | 공백뿐이 아닌 string, 각각 UTF-8 256 bytes 이하 |
| capabilities | 선택적 array: adapter가 요청하는 Core capability; 생략 시 [core.ping] |
| requiredCapabilities | 선택적 array: capabilities에 포함된 필수 capability; 생략 시 [] |
| adapter.capabilities | 선택적 array: adapter가 제공한다고 선언한 capability; 생략 시 [] |

Capability array는 최대 64개, 중복 금지, 각 이름은 1~128 UTF-8 bytes이며 regex
`[a-zA-Z][a-zA-Z0-9._-]*`를 따른다. null은 생략과 다르며 거절한다.
Core는 core.ping 및 설정에 따라 chat.v1/context.selection.v1/workspace.read.v1을 지원한다.
capabilities 응답은 요청과 지원의 교집합이다. secure transport 인증은 선택 capability가 아닌 선행 조건이다.
Unknown optional capability는 제외하고, required 미지원은 -32004이며 missingCapabilities를
반환한다. capability 미협상 상태에서 core.ping 호출은 -32005이다.
adapterCapabilities 응답은 선언 metadata 확인일 뿐, Core의 호출 지원/인증을 뜻하지 않는다.
IDE별 capability 호출은 후속 구현이다. kind가 rad-studio/visual-studio인지에 따른 core 분기는 없다.

```json
{"jsonrpc":"2.0","id":"hello-1","method":"adapter.hello","params":{"protocolVersions":[1],"capabilities":["core.ping","future.method"],"requiredCapabilities":["core.ping"],"adapter":{"kind":"rad-studio","version":"0.1.0","ideVersion":"13.2","instanceId":"rad-1234","capabilities":[]}}}
```

```json
{"jsonrpc":"2.0","id":"hello-1","result":{"protocolVersion":1,"core":{"name":"PiAgent","version":"0.1.0"},"capabilities":["core.ping"],"adapterCapabilities":[]}}
```

Legacy hello의 새 capability field 생략은 허용한다. Visual Studio adapter는 kind를
visual-studio로 보내고 실제 IDE 제품 version을 metadata로 전달한다.
instanceId는 adapter instance 식별 정보이며 인증 token이나 durable session ID가 아니다.

## core.ping

Ready와 core.ping 협상 후 허용한다. params는 {} 또는 {nonce:string}.
nonce는 선택적 UTF-8 1,024 bytes 이하 문자열(빈 문자열 허용), 추가 key는 거절한다.
응답은 pong:true와 같은 nonce, 생략 시 nonce:null이다.

```json
{"jsonrpc":"2.0","id":2,"method":"core.ping","params":{"nonce":"PiAgent 안녕"}}
```

```json
{"jsonrpc":"2.0","id":2,"result":{"pong":true,"nonce":"PiAgent 안녕"}}
```

## 오류와 disconnect

| code | message | 의미 |
| --- | --- | --- |
| -32700 | Parse error | JSON/UTF-8/BOM 오류 |
| -32600 | Invalid Request | envelope / ID / batch 오류 |
| -32601 | Method not found | unknown method |
| -32602 | Invalid params | 지원 method params 오류 |
| -32001 | Unsupported protocol version | 공통 wire version 없음; supportedProtocolVersions 반환 |
| -32002 | Handshake required | hello 전 ping |
| -32003 | Already initialized | 성공 후 hello 재호출 |
| -32004 | Required capability unavailable | missingCapabilities 반환 |
| -32005 | Capability not negotiated | 협상하지 않은 core.ping 호출 |
| -32020 | Authentication required/failed | secure pipe에서 인증 전 요청·잘못된 proof·만료·재시도 |

secure pipe는 인증 전 모든 유효 request를 -32020으로 거부한다. 인증 후 또는 development pipe에서는
unknown method는 hello 전에도 -32601이다. ping은 handshake → capability → params 순서로
검사한다. RPC 오류 후 연결은 유지하지만 framing/I/O/deadline 오류는 peer를 닫는다.
disconnect 시 미완료 request는 client에서 실패 처리하고 자동 replay하지 않는다.
현재 event subscription, IDE calls, OMP passthrough, chunking, compression과 세션 복원은 없다.

## OMP JSONL bridge skeleton

실행은 shell 없이 executable argument array `--mode rpc-ui`, cwd=선택 workspace로 한다.
stdout JSON object 하나가 한 physical line이며 CRLF/LF와 split UTF-8를 처리한다.
빈 줄은 무시한다. physical line은 1 MiB 제한이고 stderr는 RPC가 아닌 별도 stream이다.
잘못된 JSON/UTF-8/envelope 한 줄은 diagnostic으로 버리고, 초과 길이/중간 EOF는 child를 종료한다.

```json
{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2]}
```

ready 전 어떤 명령도 보내지 않는다. skeleton은 v1만 사용하며 v2를 협상하지 않는다.
protocolVersion 생략은 legacy v1로 간주하며 current version이 1이 아니거나 offered list에
1이 없으면 실패한다. rpc_chunk도 실패다. v2 negotiation/reassembly는 아직 구현하지 않는다.

```json
{"id":"piagent-1","type":"get_state"}
```

```json
{"id":"piagent-1","type":"response","command":"get_state","success":true,"data":{}}
```

manager의 request(command, fields)는 get_state, get_available_commands, get_session_stats,
new_session, prompt, abort, set_host_tools를 허용한다. 고유 string ID로 pending 요청을 관리하고 response.id와 command를 함께
검사한다. 최대 64개 pending, 기본 request timeout 5초, ready timeout 10초다.
실패 응답·timeout·child exit·stop은 pending Promise를 reject한다.
response 성공은 명령 응답이며 agent 턴 완료가 아니다. 그 외 event는 raw frame으로 전달한다.
stdin EOF로 종료를 요청하고 기본 2초 deadline 후 직접 자식을 kill한다. 자동 restart는 없다.

chat session은 아래 정규화 계약으로 OMP prompt/event를 연결한다. 0.4.0은 읽기 전용 host_tool_call/result를
구현한다. 0.6.0은 아래 승인 변경 계약을 추가한다. usage 집계는 후속 범위다. raw OMP frame은 pipe RPC로 직접 전송하지 않는다.

## Chat capability: chat.v1 (0.2.0)

기존 protocolVersion 1 framing과 hello/ping 계약을 유지한다. hello의 capabilities 및
requiredCapabilities에 `chat.v1`을 넣는다. daemon이 --omp로 설정된 경우에만 협상된다.
chat capability를 요구하지 않는 Delphi/기존 adapter는 그대로 ping-only로 동작한다.
chat 메서드는 JSON-RPC request이며 notification으로 보낸 요청은 실행하지 않는다.

| Method | params | result |
| --- | --- | --- |
| chat.open | {} | {sessionId, toolsEnabled, workspaceUri?, readOnly?} |
| chat.prompt | {sessionId, message} | {sessionId, turnId, accepted:true} |
| chat.cancel | {sessionId, turnId} | {requested:true} |
| chat.close | {sessionId} | {closed:true} |

세션 ID/턴 ID는 Core가 만든 불투명 문자열이다. 세션은 pipe connection 소유이며 다른
connection에서 사용할 수 없다. connection마다 한 세션, 세션마다 한 active turn이다.
OMP cwd는 daemon --cwd, 읽기 root는 선택적 --workspace로 고정한다. adapter/UI가 실행파일·명령·cwd/root를 지정할 수 없다.
open은 OMP ready → new_session 응답 후 완료하고 이전 auto-resume 대화를 상속하지 않는다.
OMP에는 --no-tools --no-extensions --no-skills --no-rules --no-lsp --no-session --no-title
--no-pty를 전달한다. 기본 도구·이미지·slash commands는 열지 않는다. workspace capability를 협상한 경우만
Core의 두 read-only host tools를 등록한다. 그 외 세션은 toolsEnabled:false다.
message는 비어 있지 않은 일반 텍스트이며 UTF-8 64 KiB 이하이다.

Core → adapter notification 예:

```json
{"jsonrpc":"2.0","method":"chat.event","params":{"sessionId":"opaque-session","turnId":"opaque-turn","sequence":1,"kind":"started"}}
{"jsonrpc":"2.0","method":"chat.event","params":{"sessionId":"opaque-session","turnId":"opaque-turn","sequence":2,"kind":"delta","text":"안녕"}}
{"jsonrpc":"2.0","method":"chat.event","params":{"sessionId":"opaque-session","turnId":"opaque-turn","sequence":3,"kind":"completed"}}
```

kind는 started/delta/completed/cancelled/error/closed/tool_started/tool_completed이다. sequence는 세션 내 단조 증가한다.
closed의 turnId는 null이다. 이벤트가 prompt 응답보다 먼저 올 수 있다. accepted는 접수이며
완료가 아니다. UI는 started로 turnId를 받아 delta를 표시하고 terminal event로 busy를 해제한다.
message_update.assistantMessageEvent.text_delta만 텍스트 delta로 변환한다.
agent_end는 isTerminal:false를 제외하고 terminal이다. data.agentInvoked:false 응답과
prompt_result.agentInvoked:false도 완료로 처리한다. thinking/raw frames는 UI에 전달하지 않는다.
setStatus 같은 정보성 OMP UI 요청은 무시한다. select/confirm/input/editor 또는 미협상 host tool 요청은
unsupported error로 턴을 종료하고 세션을 닫는다. 임의 승인 응답을 보내지 않는다.

cancel은 OMP abort 응답을 기다리지 않고 `{requested:true}`를 반환한다. abort 전부터 5초
종료 deadline을 시작한다. terminal event가 없거나 abort가 실패하면 취소 이벤트를 한 번 전달하고
해당 세션의 process를 정리한다. 정리 중 같은 abort를 다시 기다리지 않는다.
턴 전체의 고정 시간 제한은 없다. 장시간 도구·하위 에이전트·사용자 입력 대기 또는
모델의 무출력 시간만으로 정상 세션을 종료하지 않는다. prompt acknowledgement,
개별 도구·승인·취소의 제한은 별도로 유지한다.
prompt acknowledgement timeout은 세션을 폐기해 늦은 응답이 다음 턴에 섞이지 않게 한다.
close, pipe disconnect, daemon graceful shutdown은 OMP stdin EOF/2초 kill fallback으로 정리한다.
VS chat은 20초마다 ping해 연결 상태를 확인한다. ping은 연결 유지의 필수 조건이 아니다.
실행 중인 턴은 15초마다 `chat.event`의 `kind: "activity"`를 보낸다.
`frame`에는 `phase`, `elapsedMs`, `quietMs`, `activeTools`, `activeAgents`가 있다.
phase는 `running`, `tools`, `subagents`, `awaiting_input`, `awaiting_progress`,
`cancelling`이다. 2분 무출력은 새 진행 소식 대기 안내이며 실패 판정이나 종료 조건이 아니다.
알 수 없는 event kind를 무시하는 기존 adapter와 호환된다. `closed.text`는 작업 세션
종료 이유이며 pipe 자체의 disconnect와 구분한다. UI는 앞서 받은 오류를 일반 종료 문구로 덮지 않는다.
CLI는 credential의 private 디렉터리에 `lifecycle.jsonl`과 회전 파일 하나를 기록한다.
시각·session/turn ID·상태·경과 시간·실행 수만 기록하며 대화·도구 인자·인증 정보는 제외한다.
RPC는 기본 5초, chat.open은 adapter에서
20초 제한이다. 최대 in-flight 요청 16개, frame 1 MiB/output queue 2 MiB 제한을 유지한다.

추가 오류: -32010 OMP/connection 실패, -32011 session already open/opening,
-32012 session/turn 소유권 또는 ID 불일치, -32013 turn busy. capability 미협상은 기존 -32005다.
영속 세션·usage·승인·checkpoint는 아래의 별도 capability로 협상한다.

## Adapter 구현 메모

0.4.0: 선택 capability `workspace.read.v1`은 `chat.v1`과 함께 협상한다. chat.open의
toolsEnabled/readOnly/workspaceUri 및 chat.event의 tool_started/tool_completed를 추가한다.
read-only host-tool schemas, lifecycle와 제한은 [Workspace 도구 계약](docs/WORKSPACE-TOOLS.md)에 있다.

0.3.0은 선택적 `context.selection.v1` capability를 추가한다. `chat.v1`과 함께 협상한 경우만
chat.prompt의 context 필드를 허용한다. 자세한 schema·제한·소유권은
[Selection context 계약](docs/SELECTION-CONTEXT.md)을 따른다. 기존 hello/ping/chat framing은 유지한다.

Delphi는 Cardinal little-endian header와 TEncoding.UTF8 byte 배열을 사용한다.
C#은 async NamedPipeClientStream과 BinaryPrimitives little-endian header를 사용한다.
문자열 길이를 byte length로 사용하지 않으며 64-bit 숫자 request ID는 string으로 보낸다.
양쪽 모두 pipe I/O를 UI thread 밖에서 실행하고 각 IDE SDK 호출의 thread 규칙을 지킨다.

현재 adapter 구현의 check-connection 명령은 매 실행마다 connect/hello/ping 후 disconnect한다.
둘 다 core.ping만 필수로 요청하고 adapter.capabilities는 []로 선언한다. C# transport는
VS SDK와 독립된 netstandard2.0 library이며 Delphi transport도 ToolsAPI에 의존하지 않는다.
connect와 각 RPC는 각각 5초 제한이며 cancellation 시 pipe I/O를 종료한다.
Delphi는 overlapped I/O, C#은 async NamedPipeClientStream을 사용한다.
PIAGENT_PIPE_NAME은 IDE를 실행하기 전 설정하며 기본값은 piagent-dev다.

근거: [JSON-RPC 2.0](https://www.jsonrpc.org/specification),
[Node net IPC](https://nodejs.org/api/net.html), [Node child_process](https://nodejs.org/api/child_process.html).
OMP reference: RADAgent.RpcClient.pas / RpcProtocol.pas / RpcDispatch.pas와 로컬
RADAgent `.agents/skills/omp-rpc/SKILL.md` (reference-tested omp 18.4.4).

## Approved changes v1 (0.6.0)

Wire protocolVersion remains 1. Optional `workspace.edit.v1` is offered only with
`chat.v1` and `workspace.read.v1` on a daemon configured for approved writes.
`chat.open` includes `writeEnabled:true` and `readOnly:false` when negotiated.
OMP receives `workspace_propose_edit {path,content,reason}` via set_host_tools; it receives no approval method.
One proposal per session waits for at most five minutes.

`chat.event` adds `approval_requested` and `approval_resolved` kinds with an `approval` object.
The requested object contains `proposalId,path,reason,revision,beforeHash,afterHash,expiresAt,diff`.
Hashes and revision are SHA-256 lowercase hex; expiresAt is Unix epoch milliseconds.
The resolved object contains proposalId and approved, with reason on rejection or checkpointId/path/applied
on successful application. A warning can accompany successful application if final journal persistence fails.
Existing sessionId, turnId and sequence rules apply.

All changes methods require the owning connection's open sessionId and negotiated edit capability:

| Method | Additional params | Result |
| --- | --- | --- |
| changes.decide | proposalId, revision, decision: approve or reject | applied/checkpointId/path (approve), approved:false (reject) |
| changes.list | none | checkpoints: [{checkpointId,path,createdAt,state}] |
| changes.previewRestore | checkpointId | checkpointId,path,revision,diff |
| changes.restore | checkpointId, revision | restored:true,checkpointId,path |

Extra parameter keys are rejected. Approval is bound to the cached proposal and exact revision; adapters
must show its diff before deciding. Restore requires a fresh displayed reverse diff and explicit confirmation;
Core rechecks the revision and current file hash. Restore/preview are rejected while a chat turn is active.
Checkpoints belong to the configured workspace and survive sessions/restarts; proposals do not.
List returns at most 50 newest entries, with applied/restored/prepared/restoring/notApplied/recoveryRequired states.
Capability errors use -32005, active-turn restore -32013, invalid param keys -32602; other rejected change
operations use -32010. No failure should be interpreted as proof that an interrupted disk write never started.
Cancellation before writing leaves content unchanged; once writing begins, completion/rollback takes priority.
See [limits and recovery](docs/APPROVED-CHANGES.md).

## Sessions, usage and multi-file extension (0.7.0)

Wire protocolVersion remains 1; all three extensions are optional and depend on chat.v1.
`chat.sessions.v1` is offered only by secure OMP-enabled daemons. `chat.usage.v1` requires OMP.
`workspace.edit.batch.v1` additionally requires workspace.read.v1 and workspace.edit.v1.
Unknown optional capabilities are ignored; required capabilities retain the hello failure rules.

| Method | Params | Result |
| --- | --- | --- |
| sessions.list | empty object | sessions: [{savedSessionId,title,createdAt,updatedAt,resumable,empty,active,deletable}] |
| sessions.deleteEmpty | savedSessionId, confirmed: true | deleted: true, savedSessionId |
| chat.open | optional savedSessionId (UUID v4) | sessionId, sessionsEnabled, usageEnabled; savedSessionId/transcript when durable |
| chat.usage | owning sessionId | provider,model,currency:USD,cost,premiumRequests,tokens,context,providerLimits, optional limitsError |

Saved IDs and runtime sessionId are distinct. Close the current runtime session before opening another.
Resume recreates a child and switches to the saved OMP JSONL; it does not replay UI text into the model.
Only one connection can lease a saved session at a time. The store is scoped to this daemon's workspace and
private credential parent. Timestamps are epoch milliseconds. Transcript entries use role:user/assistant/status,
text:string. Maximum displayed history is 200 entries/256 KiB of serialized JSON.
Empty-session deletion requires `chat.sessions.v1` and explicit `confirmed:true`. The Core obtains
the target lease lock and rechecks emptiness; active/inspection-required sessions, retained or previously
truncated history, OMP message records, BTW topics, plans/lineage/checkpoints and unknown files are
protected. Only verified store-owned regular files are removed; links and arbitrary recursive deletion
are forbidden. `empty`, `active` and `deletable` are advisory list snapshots, never deletion authority.
The UI refreshes the list after deletion. Automatic resume skips a deleted last-session target.

Adapters allow 60 seconds for `chat.prompt` preparation/acknowledgement (distinct from the unbounded
agent turn). Core preparation captures the Git index in one query. VS pauses pending request deadlines
during Windows Suspend and resets them on Resume, validates the pipe with ping, then retries connection
up to three times if needed. Recovery resumes the same workspace's saved conversation without replaying
any prompt. Solution change/closure and adapter disposal invalidate pending recovery.
Capability violations use -32005; unknown owner session -32012; persistence/lease/OMP failures -32010.
Background transcript persistence failures emit chat.event kind:warning with text. This event is scoped to
sessionId/sequence and does not terminate or clear an active turn. Synchronous prompt persistence failures
reject the prompt before sending it to OMP.

Usage numeric fields are finite nonnegative numbers or null. tokens contains input/output/reasoning/cacheRead/
cacheWrite/total; context contains tokens/contextWindow. providerLimits is null or {plan,limits:[{label,window,
usedFraction,resetsAt}]}. Session cost reported by OMP is distinct from a subscription bill. No raw provider
credentials or state/usage command output is forwarded. Adapters allow up to 60 seconds for usage/list/changes.

Batch-capable OMP sessions receive workspace_propose_changes {files:[{path,content}],reason}. Existing files
only, 1–8 unique paths, 32 KiB per file and 128 KiB per batch side. Single-file tools retain their schema.
Approval/restore views and successful results include files:[{path,beforeHash,afterHash}] (successful results
may contain paths only). A batch revision binds every path and both hashes; diff concatenates all full-file diffs.
One decision covers the entire batch. An adapter must show all diffs and check all unsaved target buffers.
Checkpoint lists include files for batches. Non-batch adapters cannot list/preview/restore multi-file checkpoints.
All target hashes are validated before writes and before restore. Cancellation stops before writing; once writing
starts, conditional rollback/completion takes priority. recoveryRequired means inspect remaining bytes/journal.


## OMP controls and designer extension (development)

Optional `omp.controls.v1` and `ide.designer.v1` depend on `chat.v1`. They do not change
Named Pipe protocolVersion 1. `chat.open` adds `ompProfile: restricted|native` and
`ompControlsEnabled: boolean`. Native profile additionally requires durable sessions and
negotiated workspace.read.v1/workspace.edit.v1; it is unavailable on read-only connections.

| Method | Params in addition to owning sessionId | Result |
| --- | --- | --- |
| omp.control | command, fields object (default {}) | normalized command data |
| omp.respond | requestId, answer: {value:string} or {confirmed:boolean} or {cancelled:true} | answered:true |
| designer.reply | requestId, result object or error string | accepted:true |
| designer.decide | proposalId, approved:boolean | accepted:true |

Controls use an explicit allowlist in `omp-controls.ts`, not arbitrary OMP passthrough.
`model_roles` is a Core-handled control for an idle native session. Empty fields return
the OMP role/model catalogue, effective/global assignments, scope and revision.
`{revision,changes:{role:selector}}` saves only changed roles through OMP's config CLI.
An empty selector removes the global assignment; `@role` selects an existing role alias.
Concrete selectors may append only efforts returned by that model's `thinking` catalogue.
Role kind mismatches, alias cycles, invalid fields and stale revisions are rejected.
Global values are merged without copying project-only values into global configuration.
Project/environment overrides may remain effective; current chat selection is separate.
`login` is a Core-handled control with exactly `{providerId:string}`; `cancel_login`
accepts empty fields. They require negotiated controls and an idle native session.
Login runs in a disposable `omp --mode rpc-ui --no-session` child and returns
`{started:true}` after startup/provider validation, without waiting for OAuth completion.
`chat.event` frames of type `login_status` carry state `pending`, `completed`, `failed`
or `cancelled`. Authentication `extension_ui_request` frames carry `login:true` and
namespaced IDs; answer through `omp.respond`. Cancellation terminates the auth child,
not the conversation. Authentication frames/answers are not saved to session history.
The account tab renders URLs/instructions and non-secret code/redirect inputs. OMP
providers requiring secret or pre-authorization input cannot use RPC authentication.
Completion requests fresh provider/model/state data. `/login` opens the account tab.
On Windows, `login_terminal` is a Core-handled control with empty fields. It requires
an idle native OMP session and opens the configured native executable as `omp login`
in a visible PowerShell terminal. It accepts no shell text, provider argument, or
credentials from the adapter; authentication stays in OMP. Success means the terminal
was launched, not that authentication completed. Query `get_login_providers` afterward.
Model/effort discovery and selection are connected to the original UI. Additional allowlisted
controls are transport support, not a claim that every original UI action is connected.
Private get_state paths/system prompts are excluded. Unknown IDs, duplicate answers, non-option
select values, excessive payloads and cross-session answers are rejected. Interaction requests
expire after at most five minutes; adapters remove cards on cancel/session close.

`chat.event` adds kind `omp_event` with `frame`. Sequence/session checks still apply.
Interactive frames retain OMP `extension_ui_request` type/method/id and bounded data (256 KiB).
`ui_event` wraps a normalized original RADAgent renderer event. Native turn completion follows
session_settled/prompt_result, not an intermediate agent_end that may yield to background work.
An individual native assistant `message_end` with `stopReason=error` is provisional:
OMP can automatically retry it. Core retains turn ownership and persists subsequent tools,
text and the final response until settlement. Retry exhaustion retains the provider error;
`auto_retry_end` alone does not end the turn. Restricted-mode errors still terminate immediately.

`chat.open` accepts optional boolean `resumeLast` when `chat.sessions.v1` is negotiated;
it is mutually exclusive with `savedSessionId`. It resumes the last selected workspace-scoped
conversation without resending a prompt. Explicit New conversation omits the flag.

`chat.git {sessionId, op:status|preview|apply}` requires workspace read and OMP controls.
Preview/apply additionally require writable native mode outside plan mode, and an idle session.
Apply requires the connection-owned `previewId`, `revision`, commit author `name` and `email`.
The preview returns included paths, excluded candidates and .gitignore before/after. Core
revalidates before mutation and never configures a remote or pushes. Successful apply returns
`checkpointsEnabled:true`. Opening a non-Git/unborn workspace returns `gitStatus` and
`gitSetupEnabled`; lack of Git disables checkpoints rather than chat.
OMP stdin remains single-frame JSONL. Stdout v2 rpc_chunk sequences must be contiguous, ordered,
valid base64 and UTF-8, and no larger than 64 MiB; raw large frames are not forwarded to IDEs.

Designer host tools:
- `ide_designer_inspect {}`: snapshot of active document/framework/revision/components/properties.
- `ide_designer_set_property {component,property,value}`: one string-valued property proposal.

Negotiating the designer capability enables IDE-neutral designer-first GUI workflow guidance
on ordinary OMP prompts. Read-only connections receive inspection-only guidance. Native slash
commands and user-visible transcript text remain unchanged. This does not add RPC methods or
guarantee model compliance; workspace, approval and revision enforcement remain independent.

Core sends `designer_request {id,operation:inspect|setProperty,args}` to the adapter. Responses
must arrive through designer.reply within 30 seconds. Snapshot responses are limited to 240 KiB.
Snapshot fields: document:string, framework:string, revision:string, canSetProperty:boolean,
components:[{id:string,properties:[{name:string,value:string,writable:boolean}]}], optional mode/reason.
Core issues `designer_approval {proposalId,path,reason,diff}`, then waits for designer.decide.
Only after approval does it send setProperty with the exact inspected document/revision. Adapter
rechecks document, dirty state, revision and property before mutation on the IDE main thread.
`designer_resolved {proposalId,approved}` completes the card; errors do not count as successful edits.
One mutating host-tool proposal is active per session; read operations may run concurrently.
Disconnect/cancel invalidates all pending designer requests/approvals. Saved Git-tracked UTF-8 designer changes can be recorded by the bounded turn observer. Unsaved buffers,
new/deleted/binary files and message-level conversation rollback remain outside this restore contract.

### Designer snapshot schema 2 (additive, PiAgent 0.9.0)

`ide.designer.v1` and pipe protocolVersion 1 remain unchanged. New tools reject old snapshots without
schemaVersion 2; existing inspect/setProperty behavior remains compatible.

- `ide_designer_set_reference {component,property,target}` maps to `setReference`.
- `ide_designer_reparent {component,parent}` maps to `reparent`.
- Both are write tools, share the mutation lock/approval channel, and carry the exact document/revision.
- Snapshot adds `schemaVersion:2`, `supportedOperations:string[]`, `hierarchyKind:string`.
- Components add `parentId`, optional `ownerId`, `allowedParentIds:string[]`, `references`.
- Reference entries expose `name`, `target`, `writable`, `allowedTargets:string[]`; XAML expressions are
  read-only `expression` entries instead. Empty string means no parent/reference; only an explicitly listed
  empty allowed target can clear a reference. Component IDs remain opaque and document scoped.
- RAD parent/reference operations require the returned allowed target AND a fresh adapter-side type/cycle check.
- XAML adds `namespace`, `nodeKind:object-element|property-element`; parent IDs denote XML containment.
- Core enriches only the OMP inspect result with `harness:{schemaVersion:1,packageVersion,instructions,catalog,authority}`.
  No new adapter RPC is needed. A reference catalog never expands live operation permissions.

Unsupported/dirty adapters advertise no write operations. Existing writable scalar fields remain guarded
by canSetProperty. New reference setters can update related properties; approval discloses this. Native
save failure leaves a dirty buffer after attempted relationship restoration, not a durable rollback guarantee.

## Additive chat UI service contract (VSIX 0.9.8)

Named Pipe `protocolVersion:1` and JSON-RPC 2.0 framing remain unchanged.
`chat.btw.v1` / `chat.preferences.v1` are optional negotiated capabilities in addition to chat.v1.
Methods without the corresponding capability fail with -32005. Chat open results contain
`btwEnabled`, `preferencesEnabled`, `exportEnabled`, `filesEnabled`, `checkpointsEnabled`;
UI enables controls from these flags rather than guessing from IDE version or connection alone.
All following methods require the current connection-owned `sessionId`; unexpected params are rejected.

| Method | Additional params | Result |
|---|---|---|
| `chat.preferences` | optional `values` | validated `values`, `ompExecutable`, `ompProfile`, `piagentVersion` (actual Core package version); omit values for read |
| `btw.ask` | `text`, optional `topicId` | `accepted`, `topicId`; processing continues in independent child |
| `btw.list` | optional `offset` | `t:btwList`, stable main `session`, `items`, `append`, optional `nextOffset` |
| `btw.cancel` | `topicId` | `stopped:true` after child is joined |
| `btw.delete` | `topicId` | refreshed list; child is stopped and private topic JSON/session directory removed |
| `workspace.files` | none | `items:string[]` relative slash paths, maximum 1000 files/500 KiB listing |
| `chat.export` | none | private HTML `path` from OMP export_html; adapter chooses final destination |
| `chat.addFolder` | user-selected absolute `path` | `added`, `path`; native idle `/add-dir` execution |
| `chat.proceedPlan` | exact card `path` | new runtime session response + `planPrompt`, same savedSessionId, always-ask |

BTW events are `chat.event(kind:omp_event,frame:{type:ui_event,event:{t:btw,topic,turn}})`.
Public topics contain id/mainSession/mainTitle/created/turns and optional normalized usage;
private `sessionFile`/fork baseline are never forwarded. Turns contain q/a/state/asked and optional error.
States are running/done/stopped/error. Topic history and list pagination are bounded; see implementation document.
Question ack and streamed topic events can arrive in either order. UI correlates composer and panel requests by ID.
Cancel/delete are topic-owned actions and never abort the main turn.

Preference fields: language auto/ko/en/ja/de/fr; fontSize integer 10–24;
showThinking/showTools/showTodos/showSubagents/notifications/highContrast booleans;
defaultApproval always-ask/write/yolo/plan. Unknown keys are errors. Defaults apply to new sessions only.
Adapter response type preferences is the save ack. Failure stays operationError, never a successful local toggle.

`chat.prompt` optionally accepts attachments:string[] (maximum 16 paths). Paths are data references;
validated image files additionally become OMP ImageContent `{type:image,data:<base64>,mimeType}`.
Per-image 512 KiB, 8 images, combined base64 700,000 bytes. Text/selection context retains existing bounds.
The adapter's native picker is the user selection boundary. Attachments are not queued during a running turn.

OMP controls add steer/follow_up `{message}` for an active main turn. Queue cancellation uses exact
`remove_queued_message {message,queue:steering|followUp}` and reports actual `removed`.
get_subagent_messages uses `subagentId`, optional `fromByte`; returned private sessionFile is removed.
get_available_commands is bounded/normalized and combined with local commands, local names taking precedence.
`/fresh`, `/switch`, `/session`, `/branch`, `/tree`, `/wt`, `/worktree`, `/move`, `/handoff` are rejected by Core
because they can change private session/workspace ownership. Use PiAgent new/resume. Other native slash commands
use the ordinary tracked prompt path. Native MCP toggles use this same main turn ownership.

Adapter errors carry `action`, optional request `id`, `command`, `fields`, `ownerSessionId`.
Replies belonging to an old session are ignored. Pending model/preference/submission states clear only on their own
success/error or connection/session retirement. Approval errors re-open manual review without automatic resubmission.
Clipboard response `copied {id}` means the native copy completed. URLs permit HTTP(S) only.

Session schema 2 persists safe presentation events, optional timing and attachment paths. Replay never dispatches
approval/interaction/host actions from transcript text. Schema 1 remains readable and upgrades on save.
`chat.usage` adds queriedAt, scope main-session, and separate BTW scope retained-side-topics;
BTW totals subtract the fork baseline and become null if unavailable/running. They do not include deleted topics.
Checkpoint restore still restores files only. The native turn observer covers existing Git-tracked UTF-8 files,
not the complete filesystem or conversation timeline. See [implementation limits](docs/CHAT-UI-IMPLEMENTATION.md).

## Message timeline capability: chat.timeline.v1

Negotiated together with private sessions and OMP controls. `chat.open` returns `messageRestoreEnabled`.
Persisted user transcript entries carry a positive `seq`; older entries without checkpoints remain viewable.
`chat.previewMessageRestore {sessionId,seq,branch:boolean}` returns `messageRestoreId`, `revision`, `seq`,
`branch`, `prompt`, `scope`, `checkedPaths` and the bounded file proposal/diff. Preview expires after five minutes.
`chat.restoreMessage {sessionId,messageRestoreId,revision}` requires a completed turn and current preview.
The Core rechecks response baseline and proposal hashes; adapters reject any dirty checked IDE documents.
Both actions preserve the original conversation, restore supported changed files after explicit approval and
create a private session with `parent {savedSessionId,message,mode:branch|restore}`. They do not create Git branches.
The response is a new session with `restoredDraft` and `restoreNotice`; the draft must not auto-submit.
If reopening/applying fails, `restoreError` accompanies the reopened original session.
Snapshots contain full private OMP JSONL (64 MiB max), up to 50 message points, and bounded existing Git-tracked
UTF-8 files. New/deleted/binary/untracked/non-Git/additional roots and unsaved buffers are explicitly excluded.
MCP toggles return extension state only after the slash-command turn and chained snapshot writes finish,
then verify the requested state; prompt admission is not a configuration-save acknowledgement.

## OMP execution management extension (omp.controls.v1)

`omp.control feature_catalog {}` returns version, referenceVersion, verifiedContract, contractVersion and
PiAgent-enabled execution commands. verifiedContract identifies the reviewed upstream RPC version,
not installed-IDE acceptance or a successful probe of every command.
`model_roles` adds scope global|project and preset_save|preset_apply|preset_delete operations with name/revision.
`changes` and preset operations are mutually exclusive. Project scope writes only workspace .omp/config.yml roles;
presets are saved/deleted globally, applied to selected scope. External changes invalidate revision.
`feature_settings {}` returns discovered non-secret boolean allowlist entries, revision and scope.
Save takes `{key,value:boolean,revision}` and uses OMP global config CLI. Higher precedence may shadow the write.
Execution commands add compact {customInstructions?}, set_steering_mode/set_follow_up_mode {mode:all|one-at-a-time},
set_interrupt_mode {mode:immediate|wait}. Native compact returns `{accepted:true,operationId}` immediately.
`chat.event kind:omp_event frame:{type:control_operation,operationId,command:compact,state:running|completed|failed,message?}`
reports the result. Events may precede acknowledgement. Running maintenance excludes prompts/other controls;
chat.close retires the owning process; 5-minute compaction timeout retires it too. Late events cannot affect new sessions.
Subagent snapshots are bounded and omit raw progress/private paths. All commands retain owner session checks.

## IDE catalog, reviewed changes and editor context (development candidate)

The M0–M6 candidate extends both adapters through `ide.catalog.v1`,
`editor.context.v1` and `workspace.git.v1`. The current wire contract, bounded
catalog schema, initial publication, operation gating and editor context fields
are defined in [IDE-CATALOG-CONTRACT.md](docs/IDE-CATALOG-CONTRACT.md).
See the [integration guide](docs/IDE-AGENT-INTEGRATION.en.md) for supported backends,
immutable previews, single-use consent, state checks and recovery limitations.
Candidate consent expires after five minutes; side-effecting requests recheck the
adapter state around approval. Read requests do not carry stale mutation state.
The adapter's completion/result fields retain their backend-specific meaning;
transport acceptance alone does not imply successful execution.

## Visual Studio IDE and editor extensions (0.10.0 historical contract)

This section records the released 0.10.0 behavior. The candidate extension above
supersedes its VS-only discovery, approval lifetime and whole-buffer restrictions.

`hello` negotiates `ide.tools.v1` and `editor.suggestions.v1` independently. RAD and older adapters
do not receive VS host tools. Seven OMP tools are registered: `ide_context`, `ide_diagnostics`,
`ide_symbols`, `ide_build`, `ide_tests`, `ide_debug`, `ide_profile`. See [scope](docs/VS-INTELLIGENCE.en.md).
`chat.event` frames `ide_request {id,operation,args}` and `ide_cancel {id}` route to
the owning native adapter, using its current bound workspace. It responds through `ide.reply {sessionId,requestId,result?,error?}`.
Results must correlate with a pending request on that connection; late/cancelled replies are ignored.
Read operations have 30-second limits, execution 180 seconds, and results are bounded to 240 KiB.
At most four requests can be pending. Actual execution deadlines start after approval.
Build/tests/profile and debugger actions other than snapshot require per-action approval through the
existing `designer_approval` / `designer.decide` / `designer_resolved` UI. Plan/read-only mode blocks them.
Approval waiting has no arbitrary dialog expiry; abort, disconnect and session changes retire it.

`editor.suggest {requestId,workspaceUri,file,text,position,mode,recentEdits?,provider?,model?}` needs
the editor capability but no `chat.open`. Mode is `completion|next-edit`; provider/model must be paired.
The workspace is canonically bound and the file passes workspace read exclusions before unsaved text
is used. Context is limited to 64 KiB UTF-8. `position`, `start`, `length` are UTF-16 code units.
Result is `{requestId,revision,start,length,text}` or `{requestId,revision,empty:true}`; revision is
SHA-256 of the original UTF-8 text. Completion can only insert at the original caret. Surrogate splits,
out-of-range edits and oversized output are rejected. `editor.cancel {requestId}` cancels the owned
request. Superseding requests retire pending work; close joins the owned temporary process.
Inference disables tools/extensions/skills/rules/LSP/session/title/PTY; it cannot approve or edit files.
The native adapter checks the request/revision/snapshot/caret again before showing a proposal.
