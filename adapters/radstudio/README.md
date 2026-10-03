# RAD Studio adapter

0.6.0은 hello 전에 Core/adapter 상호 HMAC 인증을 수행한다. pipe별 credential을 자동 발견하며
PIAGENT_AUTH_FILE로 다른 경로를 지정할 수 있다. [보안 설정](../../docs/SECURITY.md).

Delphi design-time BPL 최소 vertical slice다. IDE의 PiAgent: Check Core Connection wizard 메뉴가
worker에서 Core와 hello/capability negotiation/ping을 수행하고 연결을 닫는다.
결과는 IDE Messages에 표시한다. pipe I/O는 worker에 있고 ToolsAPI 호출은 메인 스레드다.
공개 IOTAMenuWizard / RegisterPackageWizard로 등록하며 IDE가 command menu의 생성과 제거를 관리한다.
수동 TMenuItem이나 시작 retry callback을 보관하지 않는다. unload 때 worker를 cancel/join하고 polling timer를 해제한다.

PiAgent.PipeClient는 ToolsAPI에 의존하지 않으며 1 MiB length-prefix framing, Unicode nonce,
request ID 검증과 5초 deadline을 제공한다. overlapped I/O를 cancel event로 취소하고,
BPL unload 전에 worker를 join한다. queued callback을 사용하지 않아 unload 후 package code가 실행되지 않는다.
현재 ideVersion metadata는 Delphi compiler version이다. 실제 IDE 제품 version 조회는 후속 작업이다.

## Build

루트에서 scripts/build-adapters.ps1을 실행한다. -BdsRoot로 설치본을 지정할 수 있다.
IDE에서는 src/PiAgent.dproj를 열어 Win32/Win64를 각각 빌드한다.
Requires는 rtl, vcl, designide뿐이며 BPL suffix는 compiler의 LIBSUFFIX AUTO를 따른다.
이 PC의 RAD Studio 13.2 결과:

- bin/Win32/0.6.0/PiAgent370.bpl
- bin/Win64/0.6.0/PiAgent370.bpl
- bin/Win32/0.6.0/PipeSmoke.exe 및 bin/Win64/0.6.0/PipeSmoke.exe

실행 중인 이전 BPL을 덮어쓰지 않도록 script는 버전별 디렉터리에 빌드한다.
새 BPL로 교체하려면 IDE에서 기존 package를 해제하고 새 파일을 설치한다. 배포 ZIP은 bitness별 파일을 제공한다.

## IDE에서 확인

1. npm start -- --pipe piagent-dev로 Core를 실행한다.
2. IDE의 Component → Install Packages에서 해당 IDE와 같은 bitness의 BPL만 선택한다.
3. Help → Help Wizards → PiAgent: Check Core Connection 메뉴를 실행한다.
4. Messages의 handshake/capability/ping OK 또는 오류를 확인한다.

다른 endpoint는 IDE 실행 전에 PIAGENT_PIPE_NAME을 지정한다. BPL을 rebuild하기 전에는
IDE에서 unload하거나 IDE를 닫는다. 기존 RADAgent package/설정은 변경하지 않는다.
Core 자동 실행, persistent session, WebView UI나 IDE host tool은 아직 없다.

## 검증 상태

RAD Studio 13.2 compiler로 Win32/Win64 BPL과 콘솔 harness를 빌드했다.
npm run test:adapters는 같은 transport로 실제 Core hello/ping, Unicode echo,
무응답 서버에서의 cancel과 oversized response 거절을 두 bitness에서 확인한다.
RAD Studio 13.2 Win32/Win64 IDE에서 최종 BPL load, Help Wizards 메뉴 등록, Core hello/ping과
Messages의 handshake/capability/ping OK를 확인했다. Win32에서는 IDE의 정상 종료도 확인했다.
다른 RAD Studio version은 아직 미검증이다.
