# Visual Studio adapter

현재 소스 0.11.0 후보 (문서 갱신 2026-10-09). VS2022 17.14 이상 / VS2026이 필요하다.
실제 기능 목록, 승인한 리팩터링·디자이너 복원, CPU/GC 분석과 지원 제약은
[한국어](../../docs/IDE-AGENT-INTEGRATION.md) / [English](../../docs/IDE-AGENT-INTEGRATION.en.md)를 따른다.
Current source: 0.11.0 candidate. The bilingual integration guide describes the supported IDE backends and verified scope. Signing a candidate does not mean it has been published.
IDE 도구·인라인 완성·다음 수정 설정은 [한국어](../../docs/VS-INTELLIGENCE.md) / [English](../../docs/VS-INTELLIGENCE.en.md)를 참고한다.
C# VSIX는 Tools → **PiAgent: Open Chat**의 WPF/WebView2 창에서 채팅 스트리밍·취소,
다중 파일 승인·복원, 저장 대화 재개와 세션 사용량·비용·계정 한도를 제공한다.
Tools → PiAgent: Check Core Connection은 별도의 일회성 hello/ping 검사다.
hello 전에 current-user credential로 상호 HMAC 인증하며 credential/revision은 WebView에 전달하지 않는다.
[보안](../../docs/SECURITY.md) · [승인 변경](../../docs/APPROVED-CHANGES.md) · [세션/사용량](../../docs/SESSIONS-USAGE.md).

선택 코드 가져오기는 저장된 활성 텍스트 파일의 URI·언어·범위·코드를 UI thread에서 캡처한다.
`/selection`으로 가져온 뒤 입력창의 선택 영역 칩을 눌러 다음 질문에 첨부한다. 전체 파일 변경은 Core의 제한된 workspace 도구로 수행하며
승인·복원 전에 모든 대상 파일의 미저장 editor를 VS SDK로 검사한다.

PiAgent.Transport는 VS SDK와 독립된 netstandard2.0 library다. strict UTF-8,
1 MiB framing, request ID 검증, async cancellable pipe I/O와 20초 ping을 제공한다.
일반 RPC는 5초, chat.open은 20초, usage/session/changes는 60초 제한이다.
net10.0 콘솔 harness는 같은 transport를 사용한다. VSIX는 net472 / AnyCPU이다.

## Build and install

루트에서 scripts/build-adapters.ps1을 실행하거나 VS MSBuild로
PiAgent.Vsix/PiAgent.Vsix.csproj을 restore/rebuild한다. SDK 17.14 기반이며 manifest는
VS 2022/2026 amd64와 arm64를 대상으로 한다.
산출물: PiAgent.Vsix/bin/Release/net472/PiAgent.Vsix.vsix.
SDK assembly는 재배포하지 않고 자체 DLL, Newtonsoft.Json, WebView2 DLL/loader와 라이선스를 포함한다.
WebView2 Runtime은 PC의 설치본을 사용한다.

1. secure Core를 `--omp <omp.exe> --workspace <Git-root> --allow-writes`로 실행한다.
2. VSIX를 원하는 Visual Studio instance에 설치하고 IDE를 다시 시작한다.
3. Tools → PiAgent: Open Chat을 열면 자동 연결된다. 입력창에서 질문을 보낸다.
4. 모든 diff를 검토한 뒤 승인한다. 변경 기록에서는 역방향 diff를 확인해 복원 적용한다.

다른 endpoint는 IDE 실행 전 PIAGENT_PIPE_NAME으로 지정한다(기본 piagent-dev).
통합 설치된 VSIX는 Core를 자동 실행하거나 재사용한다. VSIX 설치는 통합 설치파일 또는 VSIXInstaller로 수행한다. [설치 안내](../../docs/INSTALLATION.md).
WebView는 local-origin만 허용하며 모델 출력을 HTML로 실행하지 않는다.
창 숨김/재표시는 연결을 유지하고 IDE/tool window disposal에서 연결을 정리한다.
0.7.1은 Core 0.7.0과 호환되는 VSIX 전용 수정이다. SDK WPF wrapper는 초기 부모 Window의
Closed 이벤트에서 controller를 해제한다. 도킹 후 이전 부동 창이 닫힐 때도 이 이벤트가 남아
빈 화면이 발생한다. ChatWebView는 controller 수명을 tool window에 두고, WPF HwndHost의
조상 창 전환을 controller의 ParentWindow에 명시적으로 반영한다.
같은 controller/문서를 유지하므로 채팅 연결·승인 화면·입력 초안을 재생성하지 않는다.

도킹 회귀 검사: VS MSBuild로 PiAgent.WebView.Smoke/PiAgent.WebView.Smoke.csproj을
`/restore /p:Configuration=Release` 빌드한 뒤 bin/Release/net472/PiAgent.WebView.Smoke.exe를 실행한다.
실제 WebView2에서 부모 창 이동/종료, 탭 전환, 숨김/재표시 후 브라우저 PID·DOM·한글 초안을 검사한다.
`--baseline`은 기존 WPF WebView2로 동일 시나리오를 실행하며 최초 부모 창 종료 후 실패한다.
테스트 harness는 x64(.NET Framework)이고 ARM64 Windows에서는 x64 호환 실행을 사용한다.

기존 설정과 분리하는 테스트 설치는 VSIXInstaller `/rootSuffix:PiAgentTest /instanceIds:<id>`와
같은 devenv.exe의 `/RootSuffix PiAgentTest /Log <activity.xml>`를 사용한다.
업데이트 뒤에는 해당 프로필에 `/UpdateConfiguration`을 실행한다. 기본 프로필에는 적용하지 않는다.

## Validation

서명된 0.11.0 후보의 실제 격리 프로필에서 VS2026 WPF 11/11,
VS2022 .NET Framework WinForms 8/8과 네이티브 C++ 3/3 검사를 통과했다.
VS2022의 이전 후보 VB 5/5·WinUI 소스 7/7 기록은 해당 바이너리 식별자를 유지한다.
이 결과는 전체 프레임워크·IME·확장 조합의 전수 검증을 뜻하지 않는다.
2026-10-05 NanumPDF의 약 2시간 37분 작업 기록과 아래 0.7.x 결과는 당시 버전의 이력이다.
[장시간 검증](../../docs/LONG-RUNNING-TURN-FIX.md) · [설치 acceptance](../../docs/INSTALLED-ACCEPTANCE-0.9.14.md).

VS 2022와 VS 2026 MSBuild로 DLL/pkgdef/VSCT/VSIX와 payload를 검증했다.
C# 통합 테스트는 실제 secure Named Pipe에서 인증, Unicode, 취소, capability negotiation,
동시 ping/스트리밍 및 승인·적용·복원 흐름을 검사한다.
VS 2022 17.14.35 (17.14.37411.7, instance 8967bed4)와
VS 2026 18.10.3 (18.10.12224.181, instance 4dee894c)의 별도 PiAgentTest 프로필에서
실제 파일 diff 승인·적용·역방향 diff·복원과 정상 종료를 확인했다.
두 IDE의 0.7.0에서는 두 파일을 함께 승인·복원했고 최종 Git diff도 비어 있다.
승인 테스트는 deterministic fixture OMP를 사용하며 실제 모델 채팅 검증과 구분한다.
세부 결과/제한은 [VALIDATION.md](../../docs/VALIDATION.md)에 기록한다.

VS 2022 Newtonsoft.Json binding 호환성을 위해 converter array를 명시하는 overload를 사용한다.
진단 로그는 .tools/ide-validation 및 Windows TEMP의 dd_VSIXInstaller 로그에 있다.


0.7.3는 RADAgent 원본 WebView UI를 재사용한다. 세션은 제목, 사용량은 하단 원형 표시, 승인은 대화 내 카드에서 처리한다. 원본과의 연결 범위는 [UI 안내](../../ui/README.md)를 따른다.
