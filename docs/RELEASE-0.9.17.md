# PiAgent 0.9.17 — 종료된 저장 세션의 안전한 복구

2026-10-08 KST. 세션 잠금 복구와 시작 실패 정리를 포함하는 사전 릴리즈다.

이전 실행의 `active.lock`이 남으면 마지막 대화 자동 복원이 계속 실패하던 문제를 수정했다.
Windows의 세션별 OS 잠금으로 중복 접속과 복구 경쟁을 막고, 잠금 소유 Core/OMP가 모두
종료됐음을 확인한 경우에만 남은 잠금을 복구한다. 실제 사용 중인 대화와 살아 있는 OMP는 보호한다.
설정 읽기·프로세스 생성 실패와 시작 도중 연결 종료도 정리가 끝날 때까지 기다린다.

기존 버전의 빈 잠금이나 손상·링크된 잠금, OMP 생성 중 소유 정보가 불완전해진 잠금은
계속 별도 검사가 필요하다. 대화를 자동 삭제·수정하거나 중단된 프롬프트를 재전송하지 않는다.
기존 저장 대화, 프로젝트, 로그인 및 IDE adapter 설정은 유지한다.

[원인과 실제 VS2026 복구](SESSION-RECOVERY-FIX.md) ·
[세션 계약](SESSIONS-USAGE.md) · [설치](INSTALLATION.md) · [코드서명](CODE-SIGNING.md).

0.9.16의 prompt 준비 60초 제한, Git 스냅샷 일괄 조회, VS 절전 복귀 연결 복구도 포함한다.
VS2026의 NanumPDF 기존 대화 재개와 데이터 해시 보존을 실제 설치 Core에서 확인했다.
Windows 전체 절전 주기, VS2022 전수 검증, RAD32 UI 및 모든 디자이너 실사용 검증은
완료로 주장하지 않는다. 기존 acceptance의 PARTIAL/MANUAL 항목은 유지한다.

설치파일: `dist/PiAgent-Setup-0.9.17.exe`. 설치할 IDE를 종료한 뒤 실행한다.
이번 릴리즈 게시가 실행 중인 IDE나 현재 설치된 Core를 자동 교체하지는 않는다.

SHA-256은 설치파일과 함께 게시하는 `.exe.sha256` 파일에서 확인할 수 있다.
코드서명은 Nanum Space 인증서와 RFC 3161 타임스탬프를 사용하며, 서명·내장 payload 해시·
번들 런타임과 설치 안전성 검증을 통과한 산출물만 게시한다.

검증 완료:

- TypeScript strict 빌드와 전체 자동 회귀 **140/140**, skip/fail 없음.
- C#/Delphi adapter Named Pipe 통합 **17/17**, skip/fail 없음.
- 완성된 VSIX에서 추출한 실제 WebView UI 검증 통과. 도킹·탭·숨김 전환 후 초안과 DOM 보존 확인.
- Setup, VSIX 및 내부 assembly, RAD Win32/Win64 BPL, PipeHost의 Nanum Space 서명·타임스탬프 검증 통과.
- 설치파일 내장 payload 전체 해시 및 설치 안전성 검사 통과.
- 번들 Node 24.21.0 ARM64·x64에서 인증 handshake/capability/ping 통과.
- 홈페이지 자산·링크·한/영 전환·테마 전환 검증 통과.

Setup SHA-256: `51121fd2b799be8c2fddc18f4bc75c4b905f02ae91aa11c653dd22cedba215ef`.

증거: `artifacts/release-0.9.17-{build,regression,adapters,installer,webview,website}.log`.
이는 자동·패키지 검증이며 위에 명시한 미완료 실사용 항목을 완료로 바꾸지는 않는다.
