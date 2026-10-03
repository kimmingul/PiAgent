# Selection context — PiAgent 0.3.0

VS에서 저장된 텍스트 파일을 열고 코드를 선택한다. Tools → PiAgent: Open Chat → 연결 →
선택 코드 가져오기를 누른다. 파일 URI·언어·범위·코드 미리보기를 확인하고 질문을 보내면
OMP에서 코드 설명을 받는다. 기본 질문은 한국어 설명이다. 전체 파일을 자동 첨부하지 않는다.
선택 코드가 없거나 32 KiB를 초과하면 오류를 표시하며 이전 첨부도 제거한다.
첨부 해제로 전송 전에 제거할 수 있다. 스냅샷은 이후 editor 변경을 추적하지 않는다.

## Contract

`context.selection.v1`은 `chat.v1`과 함께 협상한다. 기존 `chat.prompt`에 선택적 context를 추가한다.

```json
{"sessionId":"opaque-id","message":"Explain this code","context":{"documentUri":"file:///D:/project/Example.cs","workspaceUri":"file:///D:/project/","language":"CSharp","selection":{"text":"Console.WriteLine(42);","startLine":1,"startColumn":1,"endLine":1,"endColumn":23}}}
```

- documentUri: 필수 file URI, 최대 4096 UTF-8 bytes.
- workspaceUri: 선택적 file URI, 최대 4096 bytes. VS는 열린 solution의 디렉터리를 사용한다.
- language: 필수 비어 있지 않은 문자열, 최대 128 bytes. IDE가 제공하는 이름이다.
- selection.text: 비어 있지 않은 코드, 최대 32768 UTF-8 bytes.
- startLine/startColumn/endLine/endColumn: 1부터 시작하는 정수, 최대 2147483647.
  끝 위치는 exclusive이며 시작 위치 뒤여야 한다. column은 UTF-16 editor 위치이다.
- 직렬화된 context JSON: 최대 48 KiB. 미등록 필드와 null은 거부한다.
- 기존 message 64 KiB/일반 텍스트 제한은 유지한다. capability 미협상은 -32005,
  형식/크기 오류는 -32602이며 OMP 턴을 시작하지 않는다.

Core는 URI를 열거나 파일을 읽지 않는다. adapter 스냅샷을 JSON 데이터와 사용자 질문으로
OMP prompt에 넣으며 IDE 종류에 따른 분기가 없다. 데이터로 표시하는 것은 모델 보안 경계가
아니므로 기존 OMP 도구 비활성화를 유지한다.

VS host는 UI thread에서 실제 활성 TextDocument selection을 캡처한다. WebView는
captureSelection/clearSelection 액션만 요청하며 임의 context object를 공급할 수 없다.
캡처만으로 모델에 전송되지 않는다. 사용자가 질문을 보낼 때 host가 보관한 스냅샷을 첨부한다.
첨부는 한 턴 후 해제되지만 이미 보낸 코드는 대화에 남는다. 대화에서 제거하려면 새 대화를 만든다.
Core는 별도 context 저장소를 두지 않는다. 오류 목록·전체 solution 탐색·파일 수정은 후속 범위이다.
