# RAD Studio adapter

현재 소스 0.11.0 후보, 문서 갱신 2026-10-09. 실사용 검증은 RAD13.2 **64-bit**를 대상으로 한다.
Win32는 빌드/패키징과 transport 검증을 구분하며 최신 32-bit IDE UI 실사용은 미검증이다.
기능 목록, 빌드·디버거·DUnitX, 편집기 제안과 VCL/FMX 디자이너 변경·복원 범위는
[한국어](../../docs/IDE-AGENT-INTEGRATION.md) / [English](../../docs/IDE-AGENT-INTEGRATION.en.md)를 따른다.
Current source: 0.11.0 candidate. The bilingual integration guide distinguishes native IDE operations, external runner results and unsupported backends. Local C++Builder compilers are absent, so C++Builder acceptance is not claimed.

Delphi design-time BPL은 **View → PiAgent** 또는 **Tools → PiAgent**에서 Vcl.Edge
WebView2 채팅 창을 연다. VS와 같은 TypeScript UI로 채팅, 승인·복원, 저장 대화 재개 및 사용량을 표시한다.
hello 전에 Core/adapter 상호 HMAC 인증을 수행하며 credential은 WebView에 전달하지 않는다.
[보안 설정](../../docs/SECURITY.md) · [승인 변경](../../docs/APPROVED-CHANGES.md).

PiAgent.ChatWorker의 전용 worker가 pipe와 runtime session을 단독 소유한다. bounded queue와
메인 스레드 timer polling으로 UI를 연결하며 ToolsAPI/WebView 호출은 메인 스레드에서만 실행한다.
모든 대상 파일의 미저장 editor를 검사한 뒤 승인·복원을 요청한다. 패키지 unload에서 timer와
worker를 cancel/join한다. queued callback/notifier를 남기지 않는다. adapter가 두 메뉴 항목을 소유하고
패키지 unload 시 제거한다. IDE 메뉴 초기화가 늦으면 메인 스레드 timer로 등록을 재시도한다.
Tools 메뉴가 열릴 때 기존 IDE handler를 먼저 실행한 뒤 PiAgent 항목을 유지한다.

PiAgent.PipeClient는 ToolsAPI에 의존하지 않는다. strict UTF-8, 1 MiB length-prefix framing,
request ID 검증과 overlapped cancellable I/O를 사용한다. 일반 RPC는 5초, chat.open과
usage/session/changes는 60초 제한이다. 20초 ping이 연결을 유지한다.
IDE metadata의 ideVersion은 현재 Delphi compiler version이다.

## Build and install

루트에서 `scripts/build-adapters.ps1`을 실행한다. `-BdsRoot`로 설치본을 지정할 수 있다.
requires는 rtl, vcl, vcledge, designide이며 이 PC의 RAD Studio 13.2/Delphi 37.0 결과는 다음과 같다.

- bin/Win32/0.11.0/PiAgent370.bpl + WebView2Loader.dll + ui/
- bin/Win64/0.11.0/PiAgent370.bpl + WebView2Loader.dll + ui/
- 각 디렉터리의 PipeSmoke.exe / ChatSmoke.exe 테스트 harness

현재 사용자에게 설치된 WebView2 Runtime을 사용한다. loader는 package 폴더의 절대 경로로 로드한다.
IDE와 같은 bitness의 BPL만 Component → Install Packages에서 설치한다. 해당 디렉터리의 loader/UI를
같이 유지한다. 다른 Delphi version의 BPL은 해당 SDK로 재빌드해야 한다.
기존 BPL을 unload하거나 IDE를 종료한 뒤 교체한다. 빌드 스크립트는 버전별 출력 디렉터리를 사용한다.

1. secure Core를 `--omp <omp.exe> --workspace <Git-root> --allow-writes`로 실행한다.
2. IDE를 실행하고 View → PiAgent 또는 Tools → PiAgent를 선택한다. 두 메뉴는 같은 채팅 창을 연다.
3. 파일 diff를 확인해 승인한다. 변경 기록에서 역방향 diff를 확인한 뒤 복원 적용한다.
4. 저장된 대화에서 재개하고 사용량·비용을 펼쳐 확인한다.

다른 endpoint는 IDE 실행 전에 PIAGENT_PIPE_NAME으로 지정한다(기본 piagent-dev).
통합 설치본은 Core 자동 실행/재사용을 지원하며 선택 코드 캡처는 `/selection`으로 요청한다. 설치·실행·제거는
[INSTALLATION.md](../../docs/INSTALLATION.md)를 따른다. RADAgent source/package/설정은 수정하지 않는다.

## Validation

Delphi personality/원본 프로젝트 식별 수정을 포함한 서명 0.11.0 `ide-dev-release011b`
후보를 그대로 복사한 RAD13.2 Win64 격리 프로필에서 VCL/FMX 각각
디자이너 6단계, 네이티브 IDE 26단계, 인증 Core 승인 경로 8개 시나리오를 통과했다.
생성·이벤트 연결·삭제 후 보존한 프로젝트 여섯 개도 각각 빌드했다.
두 fixture의 실제 외부 `Fixture.dpr` 별칭 빌드와 진단에서 원본 `Fixture.dproj` 및
`Delphi.Personality` 일치를 확인했다. 외부 백엔드는 활성 원본 `.dpr`/`.dproj`와
Delphi personality를 먼저 확인하고 구성/platform/원본 경로를 재검사한다.
`.cbproj`, `.dpk`, 다른 personality의 같은 이름 `.dproj` sidecar는 지원하지 않는다.
서명 유효 BPL SHA256: Win64 `598202985DF8705A441F4BD694C97B24F89C05A6B830A87D39256CAE359A2275`,
Win32 `E099084DDA176B30814FEC9FB38947B4D57E36127AFAABEC62B908BD5E4A9147`.
후보 `final-acceptance.receipt.json`에 결과를 보존했으며 UI 104개 파일 해시도 서명 출력과 일치한다.
별도 VCL20 4시간 soak는 원래 0.10.0 바이너리 식별자를 유지하며 아직 완료로 기록하지 않는다.
Win32/Win64 채팅·전송 검사는 별도로 통과했으며 아래 과거 화면 검증과 구분한다.

Win32/Win64 BPL과 두 harness를 빌드했다. 실제 secure Named Pipe 통합 테스트에서 두 bitness의
worker가 다중 파일 승인·적용·복원, 세션 교체·재개와 사용량을 검증했다.
2026-10-04 Win64 IDE의 별도 PiAgentValidation07 프로필에서 package load, WebView 연결,
두 파일 승인·복원, 저장 대화 재개 및 토큰/USD 비용/계정 한도 표시를 실제 화면에서 확인했다.
승인 UI 검증은 deterministic fixture OMP를 사용했고 원본 파일 바이트와 Git diff 없음도 확인했다.
최종 Win32 채팅 창과 다른 RAD Studio 버전은 실제 UI 검증이 남아 있다.
[전체 검증 기록](../../docs/VALIDATION.md).
