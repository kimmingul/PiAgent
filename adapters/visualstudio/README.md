# Visual Studio adapter

C# VSIX 최소 vertical slice: Tools → PiAgent: Check Core Connection.
명령은 background worker에서 Core에 connect/hello/capability negotiation/ping을 수행하고
연결을 닫는다. 결과는 PiAgent Output pane에 표시한다. IDE 변경 도구나 WebView UI는 아직 없다.

PiAgent.Transport는 VS SDK에 의존하지 않는 netstandard2.0 library다. strict UTF-8,
1 MiB length-prefix framing, request ID 검증, 5초 deadline과 cancellation을 제공한다.
동일 library를 net10.0 콘솔 harness로 테스트한다. VSIX 자체는 net472 / AnyCPU이다.

## Build

루트에서 scripts/build-adapters.ps1을 실행하거나 VS MSBuild로 PiAgent.Vsix/PiAgent.Vsix.csproj을
restore/build한다. SDK 17.14 기반이며 manifest는 VS 2022/2026 amd64와 arm64를 대상으로 한다.
빌드 산출물: PiAgent.Vsix/bin/Release/net472/PiAgent.Vsix.vsix.
Microsoft IDE SDK assembly는 재배포하지 않으며 자체 DLL과 Newtonsoft.Json / MIT notice만 포함한다.

## IDE에서 확인

1. npm start -- --pipe piagent-dev로 Core를 실행한다.
2. 생성한 VSIX를 VSIXInstaller로 테스트할 Visual Studio instance에 설치한다.
3. IDE를 재시작하고 Tools → PiAgent: Check Core Connection을 실행한다.
4. PiAgent Output pane의 handshake/capability/ping OK 또는 오류를 확인한다.

다른 endpoint는 IDE 실행 전에 PIAGENT_PIPE_NAME 환경 변수로 지정한다.
Core 자동 실행/설치, persistent connection/reconnect/heartbeat, IDE capability 호출은 아직 없다.
VSIX를 자동 설치하거나 사용자의 기존 VS 설정을 변경하는 script는 제공하지 않는다.

기존 설정과 분리한 테스트 설치는 VSIXInstaller의 /rootSuffix:PiAgentTest와 /instanceIds:<instanceId>를
사용한다. IDE도 devenv.exe /RootSuffix PiAgentTest /Log <activity.xml>로 실행해야 한다.
기본 프로필에는 이 테스트 설치가 표시되지 않는다. 새 프로필의 초기 로그인/개발 환경 선택은 사용자가 완료한다.

## 검증 상태

VS 2022와 VS 2026 MSBuild로 DLL/pkgdef/VSCT resource/VSIX 생성과 payload를 확인했다.
npm run test:adapters는 실제 Node Core를 대상으로 VS 2022/2026 metadata, Unicode pong,
취소 및 oversized response를 동일 C# transport로 확인한다.
VS 2022 (17.14.37411.7, instance 8967bed4) / VS 2026 (18.7.11925.98, instance 4dee894c)의
PiAgentTest 프로필에 설치했다. VSIXInstaller는 두 설치의 commit/enabled 완료를 보고했다.
로그: .tools/ide-validation 및 Windows TEMP의 dd_VSIXInstaller 로그.
2026-10-03 VS 2026을 18.10.3 (18.10.12224.181)으로 업데이트하고 초기 설정을 마친 뒤,
PiAgentTest에서 실제 Tools 메뉴를 실행해 PiAgent Output의 handshake/capability/ping OK를 확인했다.
ActivityLog에도 PiAgentPackage의 Begin/End package load가 기록되었다.
결과 로그: .tools/ide-validation/vs2026-piagent-output.txt 및 vs2026-updated-activity.xml.
기본 프로필의 기존 사용자 설정은 변경하지 않았다. VS 2022 실제 메뉴 실행은 아직 미검증이다.
