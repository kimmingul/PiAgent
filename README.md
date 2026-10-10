# PiAgent

**한국어** · [English](README.en.md) · [문서 / Documentation](docs/README.md)

소스 버전 **0.11.1 제한적 사전 릴리즈** · 소스·격리 IDE·서명 설치파일 검사 통과 · 4시간 검증 보류 · 문서 갱신일 **2026-10-10 KST**.
개발자: **김민걸 (Min-Gul Kim)** · [mgkim@jbnu.ac.kr](mailto:mgkim@jbnu.ac.kr).

[제품 홈페이지](https://kimmingul.github.io/PiAgent/) ·
[릴리즈 게시 상태](https://github.com/kimmingul/PiAgent/releases).
공개 저장소 `kimmingul/PiAgent`에서 소스와 서명 릴리즈를 제공한다. 0.11.1 설치파일의 자산과 SHA-256은 [GitHub Releases](https://github.com/kimmingul/PiAgent/releases/tag/v0.11.1)에서 확인한다.

0.11.0은 실제 IDE 기능 카탈로그, 검토한 의미/디자이너 변경과 복구, 네이티브 빌드/디버거, 외부 테스트, 실행 성능 분석과 로컬 작업을 추가했다. 0.11.1은 세션/제안의 오래된 이벤트 차단, VS 다중 파일 변경 안전성·명시적 MTP/TRX 실행, RAD 열린 디자이너 복구를 보강한다. 지원은 연결된 adapter·언어/프레임워크·도구 설치 상태를 따른다. 자동 VS 제안은 기본으로 꺼져 있으며 VS2022는 17.14 이상이 필요하다.
[사용 방법과 지원 범위](docs/IDE-AGENT-INTEGRATION.md) · [0.11.1 변경·검증](docs/RELEASE-0.11.1.md).

[VS2026·RAD13.2 전체 IDE 활용 개발 계획](docs/IDE-AGENT-ROADMAP.md): 단계별 기능, GPT-6.1 sol 병렬 개발 분담, 검증 기준을 정리했습니다. 계획된 신규 기능은 현재 출시 기능과 구분합니다.

[사용 안내](docs/IDE-AGENT-INTEGRATION.md): `/ide` 기능 상태, 변경 미리보기·승인·복원과 VS/RAD 도구별 지원 범위를 설명한다. 0.11.1 소스는 Core **225 PASS·선택 skip 1**, 어댑터 **17/17**, 공유 WebView **93**, VS 네이티브 콘솔 **91**을 통과했다. VS2026과 RAD13.2의 격리 프로필 fixture 결과는 [검증 이력](docs/VALIDATION.md)에 실제 바이너리 식별자와 함께 기록한다. 사용자 요청으로 4시간 재검증과 경쟁 제품 실측 비교를 차후 진행한다.

## 처음 설치하는 분께

**IDE 하나 + OMP + 사용할 AI 연결 하나**부터 준비하세요. Claude Code, Codex, Grok Build,
Antigravity를 전부 설치할 필요는 없습니다. Ollama 로컬 모델을 선택하면 Ollama와 모델이 필요합니다.
현재 설치파일은 **VS2022/2026, RAD13.2**를 대상으로 하며 RAD11/12에는 해당 SDK로 별도 빌드한 BPL이 필요합니다.

![PiAgent 설치 순서: IDE → 기본 도구 → PiAgent와 OMP → AI 연결 → OMP 확인 → IDE 첫 대화](docs/images/setup-flow.ko.svg)

[한국어: 처음 설치하기](docs/GETTING-STARTED.ko.md) · [English: first-time setup](docs/GETTING-STARTED.en.md) ·
[홈페이지 설치 순서](https://kimmingul.github.io/PiAgent/?lang=ko#setup).
각 단계의 완료 기준, AI 서비스별 준비 사항, 오류 확인 위치를 안내합니다.

## 기술 개요

Node.js 24 LTS + TypeScript strict/ESM 기반 IDE-neutral Core다. C# VSIX와 Delphi BPL은
인증된 Named Pipe JSON-RPC로 연결하고 Core는 OMP와 `--mode rpc-ui` JSONL로 통신한다.
기존 RADAgent의 WebView UI/UX를 유지하며 RADAgent repository는 수정하지 않는다.

## 현재 사용 및 설치

서명 설치파일은 `dist/PiAgent-Setup-0.11.1.exe`이고 릴리즈 자산 경로는 `releases/download/v0.11.1/PiAgent-Setup-0.11.1.exe`다. 첫 패키지의 서명·payload/runtime·정책 검사가 통과했으며 최종 배포 바이트의 해시는 자산의 `.exe.sha256`과 [검증 이력](docs/VALIDATION.md)에서 확인한다. 일반 IDE 프로필의 0.11.1 설치/복구 검증은 수행하지 않았다. 설치 전 대상 IDE를 종료한다.
Core와 RAD13.2 32/64-bit,
VS2022/2026를 선택 설치하며 OMP가 없으면 선택적으로 설치한다. 설치 대상 IDE를 먼저 종료한다.
[설치 안내](docs/INSTALLATION.md) · [통합 설치](docs/UNIFIED-INSTALLER.ko.md).

- VS: **Tools → PiAgent: Open Chat**.
- RAD: **View → PiAgent** 또는 **Tools → PiAgent**.
- 통합 설치된 adapter는 Core를 자동 시작하거나 기존 Core를 재사용한다.
- 사용자별 루트는 `%LOCALAPPDATA%\Programs\PiAgent`, release별 runtime을 사용한다.
  ARM64 Windows에서는 ARM64 Node/.NET/OMP를 사용하고 setup은 x64 호환 실행이다.

0.9.18 검증 당시 RAD receipt는 `0.9.18-20261007162727` release를 가리키며 VS2022/2026와 RAD32/64
등록을 기록한다. 설치 기록은 실사용 검증 완료를 뜻하지 않는다. 현재 우선 실사용 검증 대상은
**VS2026와 RAD13.2 64-bit**다. 제한된 VS2022 VB·WinUI3 소스·WinForms fixture도 통과했으나 전체 VS2022 또는 RAD32 UI 인증을 뜻하지 않는다.

## 언어 선택

**설정 → 표시 → 언어**에서 `자동`, `한국어`, `English`를 선택한다. 기본값 `자동`은 한국어 시스템에서 한국어, 그 외에는 영어다. 직접 선택한 언어는 현재 프로젝트의 비공개 설정에 저장되며 다음 실행에도 적용한다. 설정·계정·모델 역할·실행 제어·Git·승인 안내가 함께 전환된다. 모델의 답변이나 코드, 외부 도구의 원문을 자동 번역하지 않는다.
설치프로그램 오른쪽 위에서도 한국어/영어를 선택할 수 있다. 홈페이지는 선택을 저장하고 [한국어](https://kimmingul.github.io/PiAgent/?lang=ko) / [English](https://kimmingul.github.io/PiAgent/?lang=en)로 직접 연결할 수 있다.
[0.11.1 변경 및 검증](docs/RELEASE-0.11.1.md).

## 현재 기능과 검증

최신 전체 직렬 Core 검사는 **208 PASS, 실패 0, 선택 receipt skip 1**(총 209개)이다. 오프라인 runtime 문서 링크, 실제 adapter 계약, 중단 세션 복구와 체크포인트 예산 초과의 비치명적 처리도 집중 검증했다. VS 네이티브 검사 **75개**, VS2026 WPF **11/11**·WinForms **8/8**, 제한된 VS2022 VB **5/5**·WinUI3 소스 **7/7**·WinForms **8/8**을 통과했다. WinUI3 생성 단계도 컴파일됐으나 네이티브 visual designer나 실행 앱 검증을 뜻하지 않는다.

Delphi 원본 프로젝트 식별 수정을 포함한 서명 RAD `release011b` VCL/FMX는 각각 강한 구조 변경 6단계, 네이티브 SDK 26개, 인증 Core 시나리오 8개(승인 4개 포함 receipt 행 12개)와 생성 단계 여섯 개 빌드를 통과했다. 실제 외부 `.dpr` 별칭 빌드와 진단도 원본 Delphi 프로젝트 식별자를 유지했다. 네이티브 디버거, CPU 비교, Unicode 편집기 수락/Undo와 실제 DUnitX 실패/필터 성공도 통과했다. Win32/Win64 SDK smoke는 아키텍처별 10개 통과이며 RAD32 UI는 별도다.

생성·삭제·이벤트 연결은 검토한 표준 WPF/WinUI3 소스 변경, 공개 in-process .NET Framework WinForms 디자이너 서비스 또는 저장된 표준 Delphi VCL/FMX 폼 조건을 따른다. 완전한 원본 복구 검토와 정확한 파일 hash를 별도로 승인한다. 최신 out-of-process WinForms, 임의 타사/상속 RAD 폼, Delphi 의미 refactor, RAD 네이티브 compiler 메시지 열거는 미지원이다. 일반 workspace 파일 생성/삭제는 미지원이며 의미 rename은 검증한 VS backend를 따른다.

0.11.1의 전체 Core·어댑터·공유 WebView 검증과 VS 네이티브 콘솔 검사 결과는 위와 같다. 최종 서명 VSIX의 격리 VS2026 WPF **8/8**, 보관된 UI **104/104**, 서명 RAD13.2 Win32/Win64의 VCL **11/11**·FMX **9/9**가 통과했다. 첫 서명 설치파일의 패키지·runtime·정책 검사도 통과했지만 일반 IDE 프로필의 0.11.1 설치/복구 근거는 아니다. 4시간 조건 재검증과 정식 Copilot/Kai 비교는 보류하며 M0–M6 전체 완료를 주장하지 않는다. [검증 이력](docs/VALIDATION.md)을 따른다.

### 이전 릴리즈 근거

0.9.18은 RAD 폼 디자이너의 OMP 승인과 실제 IDE 변경 차단을 구분했다. 승인 카드에 작업 범위를
표시하고, 미저장 변경·읽기 전용 소스·변경 서비스 부재의 구체적인 복구 이유를 전달한다.
[0.9.18 변경 및 검증](docs/RELEASE-0.9.18.md) · [RAD 원인과 사용 안내](docs/RAD-DESIGNER-DIAGNOSTICS.md).
전체 회귀 **143/143**, C#/Delphi adapter 통합 **17/17**을 통과했다.
RAD13.2 64-bit의 VCL·FMX에서 실제 모델의 기존 폼 속성 변경·저장·재조회와 빌드·실행 화면을 확인했다.
생성·삭제·이벤트 생성은 해당 이전 릴리즈의 네이티브 도구 범위 밖이었다. 현재 0.11.1 지원 범위는 위 설명을 따른다.

0.9.17은 이전 실행의 저장 세션 잠금이 남아 마지막 대화를 열지 못하던 문제를 수정한다.
실제 중복 접속은 막고, 소유 Core/OMP가 종료된 세션을 안전하게 복구한다. 세션 시작 실패와
시작 도중 연결 종료 시 정리도 보완했다. VS2026의 NanumPDF 기존 대화와 데이터 보존을 확인했다.
[0.9.17 변경 및 검증](docs/RELEASE-0.9.17.md) · [세션 복구 원인](docs/SESSION-RECOVERY-FIX.md).

0.9.17 전체 회귀 **140/140**, C#/Delphi adapter 통합 **17/17**, 실제 패키지 WebView 검증을
통과했다. 통합 설치파일·adapter 코드서명과 타임스탬프, 내장 파일 해시 및 ARM64/x64 런타임도 검증했다.

0.9.16의 VS/RAD 전송 준비 60초 제한, Git 스냅샷 일괄 조회, VS 절전 복귀 연결 복구도 포함한다.
메시지는 자동 재전송하지 않는다. [0.9.16 변경 이력](docs/RELEASE-0.9.16.md).

스트리밍 채팅·취소·BTW·설정·UI 로그인·모델/effort·OMP 역할/프리셋, 첨부/선택 코드,
workspace 자동완성·MCP/플러그인·내보내기, 저장 세션 재개·메시지 분기/복원,
다중 파일 승인/checkpoint 복원·사용량, 실행 제어·하위 에이전트 관리와 GUI harness를 제공한다.
대화 목록에서 사용하지 않는 빈 세션을 확인 후 삭제할 수 있다.
대화 기록이나 BTW·분기·복원 데이터가 있거나 사용 중인 세션은 보호한다.
기능은 OMP profile, capability와 IDE별 지원 범위에 따라 활성화된다.
[UI 구현](docs/CHAT-UI-IMPLEMENTATION.md) · [GUI harness](docs/GUI-HARNESS.md).

Goal, 전체 세션 트리/handoff, worktree 연동, SSH/background 관리, 확장 custom UI 등의
잔여 범위는 [OMP 진행표](docs/OMP-FEATURE-IMPLEMENTATION.md)를 따른다.
Native 도구나 추가 폴더의 모든 변경을 PiAgent checkpoint가 복원한다고 가정하지 않는다.

인증 후 연결의 idle 강제 종료와 턴 전체 고정 10분 제한을 제거했다. handshake/frame/ACK와
명시적 취소 등의 제한은 유지하며 중단한 프롬프트는 자동 재전송하지 않는다.
수정 시 전체 자동 회귀 **118/118**, Named Pipe fixture **631초**, WebView2 smoke **PASS 57개**를 확인했다.
설치 VS2026의 NanumPDF 작업은 2026-10-05 18:58:30–21:35:54 KST, 약 2시간 37분 진행 후
실제 최종 응답과 Core `completed` 기록을 확인했다. 이는 장시간 실행 검증이며 모든 기능의 전수
실사용 검증 완료를 의미하지 않는다. [장시간 작업 기록](docs/LONG-RUNNING-TURN-FIX.md).
기존 [acceptance](docs/INSTALLED-ACCEPTANCE-0.9.14.md)의 PARTIAL/MANUAL 항목은 남아 있다.

0.9.15는 native OMP의 개별 provider 오류를 최종 실패로 조기 처리하던 문제를 수정한다.
자동 재시도 후 도구·최종 답변·저장 transcript를 유지하고 최종 settlement에서 종료한다.
[재시도 진단과 수정](docs/PROVIDER-RETRY-DIAGNOSIS-20261006.md) ·
[당시 로컬 설치 검증](docs/LOCAL-PREVIEW-0.9.15.md).

0.9.15 개발본은 작업목록 접기, 로컬 Git 미리보기·확인 첫 커밋, 프로젝트별 마지막 대화 자동
재개도 포함한다. [로컬 Git/세션 재개](docs/LOCAL-GIT-AND-RESUME.md).

## 현재 개발 명령

```powershell
npm ci --ignore-scripts
npm run build
npm run build:transport
npm test
npm run test:adapters
# 기본 RAD build는 Win64; 통합 설치 배포 시 두 bitness 포함
& .\scripts\build-adapters.ps1 -RadPlatforms Win32,Win64
& .\scripts\build-installer.ps1
```

Node 24.21.0 이상 24 LTS, .NET SDK, adapter 빌드용 VS MSBuild/RAD compiler가 필요하다.
Core는 x64/ARM64 공통 JS이며 Rust/native npm addon은 사용하지 않는다. package 버전은
`package.json`을 단일 기준으로 생성한다. 서명은 USB 인증서와 Windows 암호화 저장소를 사용하며
PIN을 문서나 repository에 기록하지 않는다. [코드 서명](docs/CODE-SIGNING.md).

CLI 기본 profile은 `restricted`다. native 개발 실행은 `--omp-profile native --allow-writes`를
명시하며 IDE binding은 열린 프로젝트를 사용한다. 설치 실행과 과거 수동 실행은 구분한다.

## 초기 버전 이력과 수동 개발 예제

아래 0.2–0.7 설명과 당시 테스트 숫자는 이력이다. 최신 설치/기능/검증은 위 안내와 연결 문서를 따른다.

0.7.0은 **VS 2022/2026 및 RAD Studio WebView 채팅·승인·복원**, **세션 자동 저장·재개**,
**세션 토큰·비용과 계정 한도**, **다중 파일 승인·복원**을 제공한다.
[설치](docs/INSTALLATION.md) · [세션/사용량](docs/SESSIONS-USAGE.md) · [검증 결과](docs/VALIDATION.md).

0.6.0은 **diff 확인 → 개별 승인 → 파일 적용 → Git checkpoint 복원**을 추가한다.
`--allow-writes`를 명시한 secure workspace에서 VS Chat으로 사용할 수 있다.
[승인 변경 사용법과 제한](docs/APPROVED-CHANGES.md).

0.5.0은 **현재 사용자 전용 Named Pipe와 상호 인증**을 추가한다. CLI는 기본적으로 secure
Windows pipe host를 사용하며 VS/Delphi adapter가 pipe별 credential을 자동 발견한다.
[설정과 보안 범위](docs/SECURITY.md). Node.js 외에 .NET 8 이상 runtime이 필요하다.

0.4.0은 **workspace 파일 읽기·검색**을 추가한다. Core에 --workspace를 명시하면 VS Chat에서
프로젝트 파일을 찾고 읽어 설명받을 수 있다. [실행 방법과 제한](docs/WORKSPACE-TOOLS.md).

0.3.0의 VS Chat은 **선택 코드 가져오기**로 코드 미리보기를 확인한 뒤 질문에 첨부한다.
사용 방법과 계약: [Selection context](docs/SELECTION-CONTEXT.md).

Node.js 24 LTS + TypeScript strict / ESM 기반 IDE-neutral Core.
RAD Studio Delphi BPL과 Visual Studio 2022/2026 C# VSIX adapter는 Named Pipe JSON-RPC로
연결하고, Core는 별도 OMP 자식과 `omp --mode rpc-ui` JSONL로 통신한다.

현재 구현: daemon, adapter handshake/version/capability negotiation/ping, simulator,
OMP process manager, C# VSIX/Delphi BPL 연결 메뉴와 transport/tests.
0.2.0은 OMP 텍스트 채팅 세션, 스트리밍, 취소와 VS WebView 채팅 UI를 제공한다.
독립 실행 배포본에는 x64/ARM64 공용 Core, VSIX, Win32/Win64 BPL과 설치·실행·제거 스크립트가 포함된다.

- [Architecture](ARCHITECTURE.md): Rust 제거/유지 내역, workspace, reference mapping, 확장 경계
- [Protocol](PROTOCOL.md): binary framing, capability negotiation, 오류와 OMP JSONL 계약

## 준비와 빌드

2026-10-03 기준 최신 LTS인 Node.js 24.21.0과 npm을 사용한다. .nvmrc / engines가
24 LTS line을 고정하며 package-lock.json이 개발 dependency와 workspace 링크를 고정한다.
Windows x64 / ARM64에서는 동일 JS 산출물을 실행하며 native addon이나 MSVC/Rust 도구 체인이 필요 없다.

```powershell
npm ci --ignore-scripts
npm run build
npm run build:transport
npm run typecheck
npm test
```

packages/piagent-{protocol,core,daemon,omp}가 npm workspace다. TypeScript project references,
NodeNext ESM, strict / noUncheckedIndexedAccess / exactOptionalPropertyTypes를 사용한다.
런타임 외부 dependency는 없고 개발 dependency는 typescript / @types/node뿐이다.

## Daemon과 adapter probe

Terminal 1:

```powershell
npm start -- --pipe piagent-dev
```

Terminal 2:

```powershell
npm run probe -- piagent-dev rad-studio 13.2
npm run probe -- piagent-dev visual-studio 2022
npm run probe -- piagent-dev visual-studio 2026
```

probe는 hello에서 core.ping을 필수 capability로 요청하고, 결과와 Unicode nonce pong을 검증한다.
불일치/RPC 오류는 비정상 종료한다. daemon 로그는 stderr, pipe는 JSON-RPC 전용이다.
Ctrl+C로 종료한다. 인증 완료 연결은 idle만으로 닫지 않으며 불완전 frame 등에는 deadline을 유지한다.

## OMP 연결 (선택)

OMP는 별도로 설치한 실행파일을 사용한다. 기본 daemon은 OMP를 자동으로 실행하지 않는다.
Windows에서는 shell wrapper(.cmd/.bat)가 아닌 omp.exe 경로를 지정한다.

```powershell
npm start -- --pipe piagent-dev --omp "$env:LOCALAPPDATA\omp\omp.exe" --cwd D:\source\PiAgent
```

이 명령은 chat.v1 capability를 제공한다. chat.open 때 연결별 OMP child를 시작하고
JSONL v1 ready/new_session 후 채팅을 받는다. OMP 도구는 비활성화한다.
읽기 전용 연결 smoke는 별도 임시 workspace에서 실행하는 것이 좋다:

```powershell
npm run omp:smoke -- "$env:LOCALAPPDATA\omp\omp.exe" C:\path\to\scratch-workspace
```

smoke는 ready와 get_state만 확인하고 OMP를 종료한다. 실제 LLM 호출을 하지 않는다.
OMP manager는 ready gate, ID/command correlation, frame limit, timeout, stderr drain,
정상 EOF 종료와 강제 종료 fallback을 제공한다. v2 chunking과 전체 subprocess tree 정리는 아직 없다.

## 검증과 지원 범위

npm test는 node:test로 protocol, 실제 Windows Named Pipe, standalone CLI와 fake OMP를 검증한다.
실제 pipe tests는 다른 OS에서 skip되며 production daemon도 Windows 외 실행을 거절한다.
Windows에서 모든 테스트가 실행되어야 한다. OMP의 live smoke는 설치 상태에 의존하므로 opt-in이다.

2026-10-04 이 PC(Windows ARM64)에서 Node 24.21.0 ARM64와 x64(Windows emulation)로
0.7.0 Core/UI 테스트 43개씩과 adapter 테스트 13개가 통과했다. 실제 IDE 검증은 docs/VALIDATION.md를 따른다.
x64 runtime은 공식 SHA-256으로 검증한 테스트용 바이너리다.
Native x64 PC의 실행 결과와는 구분한다. 설치된 OMP에서는 ready/get_state smoke도 통과했다.
원하는 runtime으로 재검증하려면:

```powershell
& .\scripts\test-windows.ps1 -NodeExecutable C:\path\to\node.exe
```

x86/Win64 Delphi transport harness의 Core 통신과 BPL build를 검증했다.
x86 Core runtime 배포는 미래 범위다. pipe 인증/사용자 전용 ACL의 범위는 docs/SECURITY.md를 따른다.
승인 변경과 checkpoint는 --allow-writes로 활성화한다. 큰 숫자 RPC ID는 문자열로 보내야 한다.

D:\source\RADAgent는 읽기 전용 reference다. session/approval/checkpoint/usage/WebView의
다음 단계 설계는 ARCHITECTURE.md와 ui/README.md에 기록했다. 기존 Rust source와 Cargo 파일은
제거했으며 Git 제외된 target/.tools cache와 전역 Rust 설치는 활성 프로젝트에서 참조하지 않는다.

## IDE adapter build와 검증

```powershell
& .\scripts\build-adapters.ps1
npm run test:adapters
```

빌드에는 Visual Studio MSBuild / .NET 10 SDK(smoke harness) / RAD Studio compiler가 필요하다.
기본 script는 최신 설치된 Visual Studio와 RAD Studio를 찾으며 -MsBuildPath / -BdsRoot로
명시할 수 있다. 두 Delphi bitness를 모두 빌드하고 IDE 설치/레지스트리 변경은 하지 않는다.
2026-10-03에 VS 2022/2026 MSBuild와 RAD Studio 13.2 Win32/Win64 build를 확인했다.
adapter 테스트 8개는 실제 Core 연결, Unicode nonce, 취소와 oversized response, C# 채팅 스트림·선택 코드·workspace 도구를 검증한다.

설치와 메뉴 확인 절차: [Visual Studio adapter](adapters/visualstudio/README.md),
[RAD Studio adapter](adapters/radstudio/README.md). VSIX는 VS 2022/2026의 별도 PiAgentTest
프로필에 설치했다. VS 2026 업데이트(18.10.3) 후 PiAgentTest에서 실제 package load, Tools 메뉴 실행과
PiAgent Output의 handshake/capability/ping OK를 확인했다. 0.2.0 Chat UI의 실제 질문/응답 스트리밍,
취소·새 대화·IDE 종료 시 OMP 정리도 확인했다. VS 2022 PiAgentTest에서도 실제 메뉴 hello/ping,
채팅 스트리밍·완료·새 대화·IDE 종료 시 OMP 정리를 확인했다.
RAD Studio의 실제 host 검증 결과는 adapter README에 기록한다.
자세한 검증 기록은 [docs/VALIDATION.md](docs/VALIDATION.md)에 있다.

## VS 채팅 사용 (0.2.0)

```powershell
npm run build
npm start -- --pipe piagent-dev --omp "$env:LOCALAPPDATA\omp\omp.exe" --cwd C:\path\to\workspace
```

새 VSIX를 설치한 프로필에서 Tools → PiAgent: Open Chat을 열고 연결을 누른다.
질문을 입력해 보내고, 응답 중 취소할 수 있다. Enter로 전송하고 Shift+Enter로 줄바꿈한다.
새 대화는 기존 OMP 세션을 닫고 새 세션을 만든다. 창을 숨겼다가 열면 대화를 유지한다.
연결 종료/IDE 종료는 세션을 정리한다. IDE 실행 전에 PIAGENT_PIPE_NAME으로 endpoint를 바꿀 수 있다.
WebView2 Runtime이 필요하다. SDK DLL/loader는 VSIX에 포함하며 Node Core는 native dependency가 없다.
기존 RADAgent의 composer/bridge 패턴을 참고한 최소 TypeScript UI이며 원본 repository는 수정하지 않는다.
당시 0.2.0은 일반 텍스트만 지원했다. 현재 slash commands·첨부·파일 변경 지원은 위 현재 기능 안내를 따른다.

실제 모델 호출 smoke (설치된 OMP 인증을 사용하며 모델 사용량이 발생한다):

```powershell
node scripts/chat-smoke.mjs "$env:LOCALAPPDATA\omp\omp.exe" C:\path\to\scratch-workspace
```

자동 테스트는 fake OMP로 결정적으로 검증하고 이 명령은 opt-in이다. 실제 OMP 18.5.0에서
ready/new_session/prompt/text delta/agent_end로 `PiAgent chat verified` 응답을 받았다.

## 독립 실행 배포본

```powershell
npm run package
# adapter를 먼저 빌드한 경우 VSIX / Win32·Win64 BPL도 포함
npm run package:adapters
```

artifacts/piagent-<UTC timestamp>에 새 폴더를 만든다. workspace junction 대신 각 ESM package의
실제 파일과 SHA-256 release-manifest.json을 포함한다. 저장소, npm install, TypeScript compiler 없이
Node 24 LTS가 설치된 Windows x64/ARM64에서 실행할 수 있다. Node/OMP/IDE runtime은 별도 설치다.

```powershell
node core.mjs --pipe piagent-dev
# 다른 터미널
node probe.mjs piagent-dev test-adapter release
```

release 테스트는 임시 폴더에서 배포본 daemon/probe를 실행하고 hello/pong 및 모든 파일 hash를 검증한다.
adapter 포함 배포본은 현재 빌드된 BPL compiler version을 그대로 포함한다. 다른 RAD Studio version에는 재빌드한다.
