# PiAgent Windows 통합 설치프로그램

**한국어** · [English](UNIFIED-INSTALLER.md) · [문서](README.md)

문서 갱신: 2026-10-09. 현재 제품 버전은 0.9.20다.
이전 0.9.18에서 Core와 RAD32/64를 업데이트하고 중복 RAD BPL 등록을 정리했다.
설치 기록과 실제 IDE 검증은 구분한다. VS2026와 RAD13.2 64-bit를 우선 검증하며,
VS2022와 RAD32의 최종 UI 검증은 완료로 주장하지 않는다.
[세션 복구](SESSION-RECOVERY-FIX.md)와 [검증 기록](VALIDATION.md)을 참고한다.

출력 파일은 `dist/PiAgent-Setup-0.9.20.exe`다. 하나의 독립 실행 설치파일로
Windows x64와 ARM64를 지원한다. ARM64에서는 설치파일이 x64 호환 실행되며,
설치되는 Node.js, .NET, OMP는 시스템의 네이티브 아키텍처를 사용한다.
시스템 PATH나 기존 런타임을 교체하지 않는다.

설치 창 오른쪽 위에서 **한국어 / English**를 선택할 수 있다. 기본값은 한국어 Windows에서
한국어, 그 외에는 영어다. 설치 안내, 진행 상태, PiAgent 오류, 시작 메뉴 바로가기와
제거 안내에 선택한 언어를 사용한다. 제거 바로가기도 설치 당시의 언어를 전달한다.
앱의 언어는 **설정 → 표시 → 언어**에서 별도로 선택한다. 앱의 기본값 `자동`은
한국어 시스템에서 한국어, 그 외에는 영어를 사용하며 직접 선택한 언어가 우선한다.

WPF 설치프로그램은 설치된 IDE를 감지하고 다음 항목을 개별 선택하도록 제공한다.

- RAD Studio 13.2 / Delphi 37.0의 32-bit IDE (Win32 BPL)
- RAD Studio 13.2 / Delphi 37.0의 64-bit IDE (Win64 BPL)
- 감지한 지원 Visual Studio 2022 인스턴스
- 감지한 지원 Visual Studio 2026 인스턴스

없는 IDE는 선택할 수 없다. 감지한 IDE는 기본 선택되며, 해제하거나 Core만 설치할 수 있다.
설치 전에 선택한 IDE를 종료한다. IDE 창 종료를 확인한 뒤 각 인스턴스의 VSIXInstaller를
`/shutdownprocesses`로 실행하므로 남은 ServiceHub 프로세스에 의한 오류 2004를 방지한다.
완료한 인스턴스를 기록하며 같은 버전도 다시 실행하여 복구할 수 있다.
이미 설치했으나 이번에 해제한 구성요소는 유지한다. 전체 제거는 제거프로그램을 사용한다.

Core 업데이트는 pipe, OMP 경로, 작업영역, 쓰기 설정, OMP profile을 보존하고 새 Node 경로만 갱신한다.
기존 설정이 잘못되면 접근 정책을 임의 초기화하지 않고 중단한다.
RAD는 HKCU의 `Known Packages` / `Known Packages x64`에 등록한다. PiAgent 항목만 교체하고,
이전 PiAgent 등록은 기록하여 파일이 남아 있으면 제거 시 복원한다. RADAgent 등록과 파일은 변경하지 않는다.
다른 RAD 컴파일러 버전은 지원하지 않는다.

OMP는 PATH, 표준 위치, 기존 PiAgent 관리 설치에서 찾으며 네이티브 실행파일을 재사용한다.
없으면 `can1357/oh-my-pi`의 공식 최신 x64/ARM64 릴리즈를 선택 다운로드할 수 있다.
GitHub의 SHA-256 asset digest로 검증하며 인터넷이 필요하다. 다운로드 실패 시 복구 기록을 남기고
중단한다. 선택한 OMP 설치가 실패했는데 성공으로 처리하지 않는다.
인증은 OMP 바로가기로 사용자가 진행하며 로그인 토큰을 복사하지 않는다.

Core, 두 RAD adapter, VSIX와 전용 Node.js/.NET 런타임을 포함하므로 기본 설치에는 인터넷이 필요 없다.
빌드 시 Node 24.21.0과 .NET 8 배포파일을 공식 checksum으로 확인하고 라이선스를 포함한다.
WebView2 Runtime은 별도 IDE 전제조건이다. Git은 승인된 작업영역 쓰기에만 필요하다.
새 Core 설정은 읽기 전용이고 작업영역이나 로그인 자동 실행을 지정하지 않는다.

사용자별 위치는 `%LOCALAPPDATA%/Programs/PiAgent`이며 관리자 권한을 요청하지 않는다.
시작 메뉴에 Core, 사용 가능한 OMP, 제거 바로가기를 만든다.
IDE 채팅창을 열면 설치된 Core를 자동 시작하거나 재사용한다.
RAD는 View/Tools → PiAgent, VS는 Tools → PiAgent: Open Chat을 사용한다.
필요한 경우에만 설치된 `core/settings.json`의 작업영역과 쓰기 권한을 설정한다.

Windows 설치된 앱에도 PiAgent가 표시된다. 제거 전 해당 IDE와 이 설치의 Core를 종료한다.
외부 OMP, 사용자 인증 정보, `%USERPROFILE%/.piagent/security`의 저장된 대화는 유지한다.
설치프로그램이 소유한 OMP 다운로드는 설치와 함께 제거한다.
제거 worker는 임시 복사본에서 실행하여 설치파일 자체를 제거할 수 있다.

빌드:

```powershell
& .\scripts\build-installer.ps1
```

기본 빌드는 adapter, VSIX, Core broker, 설치파일을 서명하고 SHA-256 sidecar를 출력한다.
`-NoSign`은 로컬 확인용 `-unsigned-preview.exe`를 만든다.
`-SkipAdapterBuild`는 개발 반복 시 기존 산출물을 재사용한다.
서명 빌드는 adapter 컴파일을 생략해도 서명 없는 BPL, broker, VSIX와 자체 VSIX DLL을 거부한다.
`scripts/test-installer.ps1`로 설치파일, 전체 payload, 포함된 런타임의 인증 Core handshake/ping을 확인한다.
추출 시 등록 전에 모든 파일의 SHA-256을 검증한다. 부분 설치도 제거할 수 있도록 기록한다.

진단 명령 (IDE나 레지스트리를 변경하지 않음):

```powershell
PiAgent-Setup.exe --inspect C:\temp\piagent-detection.json
PiAgent-Setup.exe --verify-payload C:\temp\piagent-new-empty-folder
```

명시적 무인 설치 (IDE 등록을 변경하며 Core는 항상 포함):

```powershell
PiAgent-Setup.exe --install-components core,rad64,vs26
```

허용 구성요소: `core,rad32,rad64,vs22,vs26,omp`. OMP가 없고 `omp`를 선택한 경우에만 다운로드한다.
`--language ko`, `--language en`, `--language auto`를 어떤 실행 방식에도 추가할 수 있다.
완료는 종료 코드 0, 오류는 1과 `%TEMP%/PiAgent-setup-error.txt`로 보고한다.
진행 기록은 `%TEMP%/PiAgent-setup-install.log`, VSIX 로그는 설치 루트의 `vsix-<instanceId>.log`에 남는다.
미서명 preview를 서명 완료나 실제 IDE 검증 완료로 표현해서는 안 된다.
