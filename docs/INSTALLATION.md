# Windows 설치 (0.8.1)

통합 설치파일은 [UNIFIED-INSTALLER.md](UNIFIED-INSTALLER.md)를 참고한다.
VSIX 0.9.3부터 모든 adapter의 인증 경로는 `PIAGENT_AUTH_FILE` 명시 값,
또는 `%USERPROFILE%/.piagent/security/<pipe>/token`을 사용한다. AppData의 패키지 리디렉션을
피하기 위한 경로이며 ACL과 상호 HMAC 인증은 유지한다. 인증 파일을 직접 만들거나 권한을 넓히지 않는다.
통합 설치된 VSIX는 연결 시 Core를 자동으로 시작하고, 이미 실행 중이면 재사용한다.
실패 시 표시되는 경로와 오류 종류를 확인하고 기존 설정 메뉴에서 연결을 다시 시도한다.

Core 지원 대상: Windows x64와 ARM64, Node.js 24.21.0 이상 24 LTS, .NET 8 이상 runtime.
같은 JS/AnyCPU 배포본을 두 architecture에서 사용한다. 승인 쓰기에는 Git과 HEAD commit이 있는
standalone repository가 필요하다. 채팅에는 별도 OMP executable과 로그인 설정이 필요하다.
VS/RAD WebView에는 WebView2 Runtime이 필요하다. Node native addon이나 Rust는 사용하지 않는다.

1. PiAgent-0.8.1-windows.zip을 빈 디렉터리에 압축 해제한다.
2. PowerShell에서 아래 script를 실행한다. 관리자 권한은 필요하지 않다.

```powershell
& .\scripts\install-core.ps1 -Omp "$env:LOCALAPPDATA\omp\omp.exe" -Workspace 'D:\project' -AllowWrites
```

읽기 전용이면 -AllowWrites를 생략한다. pipe는 기본 piagent-dev이고 -PipeName으로 바꿀 수 있다.
OMP 기본 도구/확장을 사용하는 검증 모드는 `-OmpProfile native -AllowWrites`로 명시한다.
native 도구의 직접 파일 쓰기는 PiAgent 승인 변경 기록에 자동으로 포함되지 않는다.
-InstallRoot는 기본 `$env:LOCALAPPDATA\PiAgent\runtime`이다. 각 버전은 별도 폴더에 설치한다.
script는 전체 SHA-256 manifest를 확인하고 기존 설치를 덮어쓰지 않는다. manifest는 무결성 확인용이며
서명/발행자 인증이 아니다. 재배포 받은 archive의 출처도 확인한다.

```powershell
& "$env:LOCALAPPDATA\PiAgent\runtime\0.8.1\scripts\start-core.ps1"
```

설치 폴더의 settings.json을 편집해 Node/OMP/pipe/workspace를 변경한다. foreground daemon은 Ctrl+C로
종료한다. 자동 service 등록이나 시작 프로그램, PATH 변경을 하지 않는다. Node/.NET/OMP를 내려받지 않는다.
IDE와 Core bitness는 서로 달라도 된다. x86 Core runtime 배포는 이번 지원 범위에 포함하지 않는다.

VS 2022/2026: `adapters/visualstudio/PiAgent.Vsix.vsix`를 각 설치에 설치하고 IDE를 재시작한다.
VSIX는 amd64/arm64를 선언한다. Tools → PiAgent: Open Chat → 연결을 누른다.
테스트 프로필은 VSIXInstaller의 `/rootSuffix:PiAgentTest /instanceIds:<id>`를 사용한다.
테스트 후 `/RootSuffix PiAgentTest /UpdateConfiguration`은 해당 프로필에만 적용한다.

RAD Studio 13.2: IDE가 Win32면 adapters/radstudio/Win32, Win64면 Win64의 PiAgent370.bpl을 사용한다.
각 폴더의 ui/ 및 WebView2Loader.dll을 BPL 옆에 그대로 둔다. Component → Install Packages → Add로
BPL을 추가하고 View → PiAgent 또는 Tools → PiAgent를 연다. 두 메뉴는 같은 채팅 창을 연다. 다른 compiler/package suffix는
해당 RAD SDK로 rebuild해야 한다. IDE runtime/design packages를 재배포하지 않는다.
registry로 테스트 프로필을 등록할 경우 64-bit IDE는 `Known Packages x64`를 사용한다.
`Known Packages`만 갱신하면 이전 x64 BPL이 계속 로드될 수 있으므로 실제 로드 경로를 확인한다.
ARM64 Windows의 RAD IDE는 설치된 Win32/Win64 IDE의 호환 실행을 사용하며 ARM64 BPL은 제공하지 않는다.
RAD [별도 registry profile](https://docwiki.embarcadero.com/RADStudio/Athens/en/IDE_Command_Line_Switches_and_Options)은
`bds.exe -rPiAgentValidation07`로 실행할 수 있다. 기존 RADAgent profile/package는 그대로 둔다.
현재 실사용 검증 대상은 VS2026과 RAD13.2이며 VS2022 검증은 최종 완성 직전으로 보류한다.

기본 이외의 pipe를 사용하면 IDE를 시작하기 전에 PIAGENT_PIPE_NAME을 설정한다.
IDE에는 Core 자동 실행 기능이 없으므로 daemon을 먼저 실행한다.

업그레이드는 새 버전 설치 후 이전 Core를 정상 종료하고 새 launcher를 사용한다. VSIX는 새 파일로 교체하고,
RAD에서는 IDE를 종료하거나 이전 BPL을 해제한 뒤 새 BPL을 등록한다. 실행 중인 BPL을 덮어쓰지 않는다.

```powershell
& .\scripts\uninstall-core.ps1 -InstallDirectory "$env:LOCALAPPDATA\PiAgent\runtime\0.7.0"
```

Core를 먼저 종료한다. uninstall은 receipt로 확인한 그 버전 디렉터리만 제거하며 credential·저장 세션·Git
checkpoint는 보존한다. VSIX/BPL 등록 해제는 각 IDE의 extension/package 관리에서 수행한다.
복구 가능한 이전 버전은 재설치할 수 있지만 새 batch checkpoint는 구버전 adapter에서 숨겨진다.
검증된 실제 host와 테스트 범위는 VALIDATION.md에 기록한다.

0.9.0 GUI harness 검증본은 `harness-validation/runtime/0.9.0`, pipe `piagent-harness09`에 설치한다.
이번 RAD 배포는 Win64만 포함하며 build-adapters.ps1 기본값도 Win64이다. Core의 x64/ARM64
지원과 RAD BPL의 IDE bitness는 별개이다. 프레임워크별 skill/catalog는 Core release에 포함되므로
별도 전역 skill 설치 없이 inspect 결과를 통해 OMP에 전달된다. 자세한 범위는 GUI-HARNESS.md 참고.
