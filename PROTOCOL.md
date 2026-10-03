# PiAgent pipe protocol v1

## 두 transport

IDE adapter ↔ Node.js/TypeScript Core: Windows duplex byte-mode Named Pipe / JSON-RPC 2.0.
Core ↔ OMP: `omp --mode rpc-ui` stdin/stdout UTF-8 JSONL / type 기반 OMP protocol.
이 문서의 PiAgent version과 OMP protocolVersion은 독립적이다. wire format을 섞지 않는다.

## Named Pipe framing

기본 endpoint: `\\.\pipe\piagent-dev`. CLI는 짧은 이름을 받는다.
이름은 ASCII 영숫자, -, _만 1~128자다. remote UNC endpoint를 CLI에 받지 않는다.
OS-level remote-client 차단/peer authentication은 현재 Node transport가 보장하지 않는다.

Frame = `uint32 little-endian bodyLength` 4 bytes + UTF-8 JSON body.
bodyLength는 문자 수가 아닌 byte 수로 1~1,048,576이다. BOM, trailing NUL과 줄 구분자는 없다.
Pipe read/write와 frame 경계는 다르며 부분 header/body 및 여러 frame의 coalescing을 처리한다.
0/초과 길이, header/body 중간 EOF는 응답 없이 해당 연결을 닫는다. frame 사이 EOF는 정상
disconnect다. 각 frame의 read/idle deadline은 30초, write deadline도 30초다.
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

`Connected → adapter.hello 성공 → Ready → disconnect`.
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
Core 지원 capability는 core.ping뿐이다. capabilities 응답은 요청과 지원의 교집합이다.
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

Unknown method는 hello 전에도 -32601이다. ping은 handshake → capability → params 순서로
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
new_session, prompt, abort를 허용한다. 고유 string ID로 pending 요청을 관리하고 response.id와 command를 함께
검사한다. 최대 64개 pending, 기본 request timeout 5초, ready timeout 10초다.
실패 응답·timeout·child exit·stop은 pending Promise를 reject한다.
response 성공은 명령 응답이며 agent 턴 완료가 아니다. 그 외 event는 raw frame으로 전달한다.
stdin EOF로 종료를 요청하고 기본 2초 deadline 후 직접 자식을 kill한다. 자동 restart는 없다.

chat session은 아래 정규화 계약으로 OMP prompt/event를 연결한다. host_tool_call 응답/승인,
checkpoint와 usage 집계는 후속 범위다. raw OMP frame은 PiAgent pipe RPC envelope로 직접 전송하지 않는다.

## Chat capability: chat.v1 (0.2.0)

기존 protocolVersion 1 framing과 hello/ping 계약을 유지한다. hello의 capabilities 및
requiredCapabilities에 `chat.v1`을 넣는다. daemon이 --omp로 설정된 경우에만 협상된다.
chat capability를 요구하지 않는 Delphi/기존 adapter는 그대로 ping-only로 동작한다.
chat 메서드는 JSON-RPC request이며 notification으로 보낸 요청은 실행하지 않는다.

| Method | params | result |
| --- | --- | --- |
| chat.open | {} | {sessionId, toolsEnabled:false} |
| chat.prompt | {sessionId, message} | {sessionId, turnId, accepted:true} |
| chat.cancel | {sessionId, turnId} | {requested:true} |
| chat.close | {sessionId} | {closed:true} |

세션 ID/턴 ID는 Core가 만든 불투명 문자열이다. 세션은 pipe connection 소유이며 다른
connection에서 사용할 수 없다. connection마다 한 세션, 세션마다 한 active turn이다.
workspace는 daemon --cwd로 고정한다. adapter/UI가 실행파일·명령·cwd를 지정할 수 없다.
open은 OMP ready → new_session 응답 후 완료하고 이전 auto-resume 대화를 상속하지 않는다.
OMP에는 --no-tools --no-extensions --no-skills --no-rules --no-lsp --no-session --no-title
--no-pty를 전달한다. 이번 버전에서는 도구 실행, 이미지, slash commands를 열지 않는다.
message는 비어 있지 않은 일반 텍스트이며 UTF-8 64 KiB 이하이다.

Core → adapter notification 예:

```json
{"jsonrpc":"2.0","method":"chat.event","params":{"sessionId":"opaque-session","turnId":"opaque-turn","sequence":1,"kind":"started"}}
{"jsonrpc":"2.0","method":"chat.event","params":{"sessionId":"opaque-session","turnId":"opaque-turn","sequence":2,"kind":"delta","text":"안녕"}}
{"jsonrpc":"2.0","method":"chat.event","params":{"sessionId":"opaque-session","turnId":"opaque-turn","sequence":3,"kind":"completed"}}
```

kind는 started/delta/completed/cancelled/error/closed이다. sequence는 세션 내 단조 증가한다.
closed의 turnId는 null이다. 이벤트가 prompt 응답보다 먼저 올 수 있다. accepted는 접수이며
완료가 아니다. UI는 started로 turnId를 받아 delta를 표시하고 terminal event로 busy를 해제한다.
message_update.assistantMessageEvent.text_delta만 텍스트 delta로 변환한다.
agent_end는 isTerminal:false를 제외하고 terminal이다. data.agentInvoked:false 응답과
prompt_result.agentInvoked:false도 완료로 처리한다. thinking/raw frames는 UI에 전달하지 않는다.
setStatus 같은 정보성 OMP UI 요청은 무시한다. select/confirm/input/editor 또는 host tool 요청은
unsupported error로 턴을 종료하고 세션을 닫는다. 임의 승인 응답을 보내지 않는다.

cancel은 OMP abort를 보내며 그 응답이 턴 종료를 의미하지 않는다. terminal event를 기다리고,
5초 내 종료 이벤트가 없으면 취소 처리 후 해당 세션의 process를 정리한다. 턴 제한은 10분이다.
prompt acknowledgement timeout은 세션을 폐기해 늦은 응답이 다음 턴에 섞이지 않게 한다.
close, pipe disconnect, daemon graceful shutdown은 OMP stdin EOF/2초 kill fallback으로 정리한다.
VS chat은 20초마다 ping해 idle connection을 유지한다. RPC는 기본 5초, chat.open은 adapter에서
20초 제한이다. 최대 in-flight 요청 16개, frame 1 MiB/output queue 2 MiB 제한을 유지한다.

추가 오류: -32010 OMP/connection 실패, -32011 session already open/opening,
-32012 session/turn 소유권 또는 ID 불일치, -32013 turn busy. capability 미협상은 기존 -32005다.
권한·영속 복원·tool approval·checkpoint는 별도 capability로 후속 확장한다.

## Adapter 구현 메모

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
