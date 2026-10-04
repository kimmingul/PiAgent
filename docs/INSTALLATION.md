# Windows 설치 (0.7.0)

Core 지원 대상: Windows x64와 ARM64, Node.js 24.21.0 이상 24 LTS, .NET 8 이상 runtime.
같은 JS/AnyCPU 배포본을 두 architecture에서 사용한다. 승인 쓰기에는 Git과 HEAD commit이 있는
standalone repository가 필요하다. 채팅에는 별도 OMP executable과 로그인 설정이 필요하다.
VS/RAD WebView에는 WebView2 Runtime이 필요하다. Node native addon이나 Rust는 사용하지 않는다.

1. PiAgent-0.7.0-windows.zip을 빈 디렉터리에 압축 해제한다.
2. PowerShell에서 아래 script를 실행한다. 관리자 권한은 필요하지 않다.

```powershell
& .\scripts\install-core.ps1 -Omp "$env:LOCALAPPDATA\omp\omp.exe" -Workspace 'D:\project' -AllowWrites
```

읽기 전용이면 -AllowWrites를 생략한다. pipe는 기본 piagent-dev이고 -PipeName으로 바꿀 수 있다.
-InstallRoot는 기본 `$env:LOCALAPPDATA\PiAgent\runtime`이다. 각 버전은 별도 폴더에 설치한다.
script는 전체 SHA-256 manifest를 확인하고 기존 설치를 덮어쓰지 않는다. manifest는 무결성 확인용이며
서명/발행자 인증이 아니다. 재배포 받은 archive의 출처도 확인한다.

```powershell
& "$env:LOCALAPPDATA\PiAgent\runtime\0.7.0\scripts\start-core.ps1"
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
BPL을 추가하고 Help → Help Wizards → PiAgent: Open Chat을 연다. 다른 compiler/package suffix는
해당 RAD SDK로 rebuild해야 한다. IDE runtime/design packages를 재배포하지 않는다.
ARM64 Windows의 RAD IDE는 설치된 Win32/Win64 IDE의 호환 실행을 사용하며 ARM64 BPL은 제공하지 않는다.
RAD [별도 registry profile](https://docwiki.embarcadero.com/RADStudio/Athens/en/IDE_Command_Line_Switches_and_Options)은
`bds.exe -rPiAgentValidation07`로 실행할 수 있다. 기존 RADAgent profile/package는 그대로 둔다.

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
