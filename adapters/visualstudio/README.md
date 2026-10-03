# Visual Studio adapter

0.6.0: hello 전에 current-user credential을 자동 발견하고 Core/adapter 상호 HMAC 인증을 수행한다.
credential과 proof는 WebView로 전달하지 않는다. daemon과 adapter를 함께 업데이트한다.
기본 경로와 PIAGENT_AUTH_FILE 설정은 [SECURITY.md](../../docs/SECURITY.md)를 따른다.

0.4.0: Chat은 `workspace.read.v1`을 선택적으로 협상한다. Core --workspace가 지정되면
연결 상태에 읽기 root를 표시하고 파일 조회 시작/완료를 보여준다. 쓰기 도구는 없다.

0.3.0: 저장된 활성 텍스트 파일의 선택 코드를 Chat의 **선택 코드 가져오기**로 캡처한다.
URI·언어·범위·코드를 미리 보고 질문을 보내면 한 턴에 첨부된다. 캡처는 UI thread에서 실행하며
Core는 파일을 조회하지 않는다. 전체 파일·오류 목록·파일 수정 기능은 아직 없다.

C# VSIX: Tools → PiAgent: Check Core Connection / PiAgent: Open Chat.
명령은 background worker에서 Core에 connect/hello/capability negotiation/ping을 수행하고
연결을 닫는다. 결과는 PiAgent Output pane에 표시한다. Open Chat은 WPF ToolWindowPane 안의
WebView2에서 shared TypeScript UI를 실행한다. 연결별 텍스트 채팅이며 IDE 변경 도구는 아직 없다.

PiAgent.Transport는 VS SDK에 의존하지 않는 netstandard2.0 library다. strict UTF-8,
1 MiB length-prefix framing, request ID 검증, 5초 deadline과 cancellation을 제공한다.
동일 library를 net10.0 콘솔 harness로 테스트한다. VSIX 자체는 net472 / AnyCPU이다.

## Build

루트에서 scripts/build-adapters.ps1을 실행하거나 VS MSBuild로 PiAgent.Vsix/PiAgent.Vsix.csproj을
restore/build한다. SDK 17.14 기반이며 manifest는 VS 2022/2026 amd64와 arm64를 대상으로 한다.
빌드 산출물: PiAgent.Vsix/bin/Release/net472/PiAgent.Vsix.vsix.
Microsoft IDE SDK assembly는 재배포하지 않는다. 자체 DLL, Newtonsoft.Json과 WebView2 SDK DLL/loader 및
라이선스를 포함한다. WebView2 Runtime 자체는 배포하지 않는다. VSIX manifest 버전 확인을 위해 Rebuild한다.

## IDE에서 확인

1. npm start -- --pipe piagent-dev로 Core를 실행한다.
2. 생성한 VSIX를 VSIXInstaller로 테스트할 Visual Studio instance에 설치한다.
3. IDE를 재시작하고 Tools → PiAgent: Check Core Connection을 실행한다.
4. PiAgent Output pane의 handshake/capability/ping OK 또는 오류를 확인한다.

다른 endpoint는 IDE 실행 전에 PIAGENT_PIPE_NAME 환경 변수로 지정한다.
Core 자동 실행/설치와 IDE capability 호출은 아직 없다. 채팅은 persistent connection과 20초 ping을 사용한다.
Open Chat → 연결 → 질문 전송 → 응답/취소가 최소 흐름이다. Core에는 --omp/--cwd를 지정해야 한다.
채팅에는 chat.v1 capability가 필수이며 없는 daemon에서는 연결 오류를 표시한다. 새 대화로 세션을 교체한다.
WebView2는 local-origin만 허용하고 UI는 response를 HTML로 해석하지 않는다.
VSIX를 자동 설치하거나 사용자의 기존 VS 설정을 변경하는 script는 제공하지 않는다.

기존 설정과 분리한 테스트 설치는 VSIXInstaller의 /rootSuffix:PiAgentTest와 /instanceIds:<instanceId>를
사용한다. IDE도 devenv.exe /RootSuffix PiAgentTest /Log <activity.xml>로 실행해야 한다.
기본 프로필에는 이 테스트 설치가 표시되지 않는다. 새 프로필의 초기 로그인/개발 환경 선택은 사용자가 완료한다.

## 검증 상태

VS 2022와 VS 2026 MSBuild로 DLL/pkgdef/VSCT resource/VSIX 생성과 payload를 확인했다.
npm run test:adapters는 실제 Node Core를 대상으로 VS 2022/2026 metadata, Unicode pong,
취소 및 oversized response, 동시 ping/채팅 스트리밍/cooperative abort를 동일 C# transport로 확인한다.
VS 2022 (17.14.37411.7, instance 8967bed4) / VS 2026 (18.7.11925.98, instance 4dee894c)의
PiAgentTest 프로필에 설치했다. VSIXInstaller는 두 설치의 commit/enabled 완료를 보고했다.
로그: .tools/ide-validation 및 Windows TEMP의 dd_VSIXInstaller 로그.
2026-10-03 VS 2026을 18.10.3 (18.10.12224.181)으로 업데이트하고 초기 설정을 마친 뒤,
PiAgentTest에서 실제 Tools 메뉴를 실행해 PiAgent Output의 handshake/capability/ping OK를 확인했다.
ActivityLog에도 PiAgentPackage의 Begin/End package load가 기록되었다.
결과 로그: .tools/ide-validation/vs2026-piagent-output.txt 및 vs2026-updated-activity.xml.
기본 프로필의 기존 사용자 설정은 변경하지 않았다.

0.2.0은 VS 2026 PiAgentTest에서 WebView2 Chat 생성·연결, 실제 모델 질문/스트리밍 응답 완료,
응답 중 취소, 새 대화 및 IDE 정상 종료 때 OMP child 정리를 확인했다. docs/VALIDATION.md에 기록한다.
테스트 VSIX를 교체한 뒤 이전 설치 경로를 참조하면, IDE를 닫고 같은 devenv.exe로
/RootSuffix PiAgentTest /UpdateConfiguration을 실행한 뒤 재시작한다. 기본 프로필에는 적용하지 않는다.

VS 2022 17.14.35 PiAgentTest에서도 package load, Tools의 handshake/capability/ping OK,
WebView 채팅 스트리밍·응답 완료·새 대화·IDE 종료 때 OMP 정리를 확인했다.
VS 2022의 Newtonsoft.Json binding에는 JToken.ToString(Formatting) overload가 없어,
transport와 WebView bridge에서 converter array를 명시하는 호환 overload를 사용한다.
수정 후 adapter 테스트 6개도 다시 통과했다.

0.6.0 adds per-file diff approval and checkpoint restore in Chat. Start the secure daemon with
`--workspace <Git-root> --allow-writes`; see [approved changes](../../docs/APPROVED-CHANGES.md).
Unsaved target documents must be saved before requesting a fresh proposal.
