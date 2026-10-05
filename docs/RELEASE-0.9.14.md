# PiAgent 0.9.14 — OMP 실행 관리

현재 상태 갱신: 2026-10-06. 제품 버전은 0.9.14를 유지한다. 아래 첫 설치 경로는 초기 배포 이력이다.
후속 결함 수정 및 idle/10분 종료 수정까지 반영한 서명 setup은 `dist/PiAgent-Setup-0.9.14.exe`다.
현재 이 PC의 receipt는 `0.9.14-20261005095258`을 가리키고 VS2022/2026 및 RAD32/64 등록을 기록한다.
2026-10-06 KST 배포용 재빌드 setup SHA256:
`a5884450c175e5559d6cc2e78e0f5836f10c188092210bdc8a7aa651307a7d4f`.
이전 설치본 SHA256은 `8abeaad9202a84549ca741e3bbc9a02f0f6b4a4182e2b348aaf591c799f5b3f6`이며,
현재 PC의 설치 receipt는 재빌드 전 설치 상태를 나타낸다. 이번 릴리즈 작업은 IDE 재설치를 수행하지 않는다.

## GitHub 배포 (2026-10-06 KST)

- [v0.9.14 사전 릴리즈](https://github.com/kimmingul/PiAgent/releases/tag/v0.9.14): 서명된 통합 setup과 SHA256 제공.
- [제품 홈페이지](https://kimmingul.github.io/PiAgent-site/): NanumCsvViewer 스타일의 한/영 소개, 테마 전환, 설치 안내.
- PiAgent 소스 저장소의 비공개 상태를 유지한다. 현재 계정에서는 비공개 저장소 Pages가 허용되지 않아
  홈페이지 파일만 공개 `kimmingul/PiAgent-site`에 게시한다. 릴리즈 다운로드에는 PiAgent 접근 권한이 필요하다.
- 전체 자동 회귀 118/118, adapter 통합 15/15, 홈페이지 정적 검사 통과.
- setup Authenticode `Valid`, USB 코드서명 및 GlobalSign timestamp 검증.
- 포함 파일 hash, ARM64/x64 Node 24.21.0 인증 handshake/capability/ping 및 installer safety 검사 통과.

서명/timestamp·payload hash, bundled ARM64/x64 runtime handshake/ping 및 installer safety 검증을 확인했다.
VS2026 실제 NanumPDF 작업은 2026-10-05 21:35:54 KST에 약 2시간 37분 후 완료했다.
이 관찰과 최신 자동 회귀 118/118은 전체 기능 실사용 승인을 의미하지 않는다.
[장시간 수정](LONG-RUNNING-TURN-FIX.md) · [검증 이력](VALIDATION.md).
최신 VS2022 최종 검증과 RAD32 UI 실사용은 남아 있다. 아래 초기 배포 기록과 GitHub 배포 기록은 구분한다.

기존 RADAgent 채팅 UI와 설정 탭을 유지하며 다음 기능을 추가했다.

- 모델 역할의 전역·프로젝트 저장 위치와 전역 프리셋 저장·적용·삭제.
- OMP 버전·검토한 RPC 계약 목록, Fast·압축·재시도·캐시·queue/interrupt 설정.
- 수동 압축의 즉시 접수 및 비동기 완료 이벤트.
- 하위 에이전트 목록·기록·지시·중단. 설정 탭을 유지하는 기록 표시.
- 설치 OMP에서 발견한 Advisor·Memory·Prewalk 등의 boolean 설정 편집.

전체 자동 테스트 105/105, 신규 경로 재검증과 WebView2 100/150/200% 및 12개 도킹 전환 통과.
OMP 18.6.1 계약을 기준으로 했으며 실제 사용자 설정을 변경하지 않고 조회를 확인했다.
Goal, 전체 세션 트리/handoff, worktree 및 추가 관리 도구는 아직 구현 중이다.
전체 상태와 제한은 [OMP 기능 진행표](OMP-FEATURE-IMPLEMENTATION.md)를 따른다.

서명 통합 설치 파일: `dist/PiAgent-Setup-0.9.14.exe`.
이 PC에서는 Core ARM64, Visual Studio 2026, RAD Studio 13.2 64bit를 교체한다.
VS2022와 RAD32 설치·실사용 검증은 이번 교체 대상에서 제외한다.
기존 세션·인증·접근 설정은 보존한다. 설치 후 실제 검증 결과는 별도로 기록한다.

## 이 PC 설치 결과 (2026-10-05)

- USB 인증서와 기존 Windows DPAPI 등록 정보를 사용해 새 PIN 입력 없이 서명 완료.
- setup/VSIX/포함 DLL/BPL의 인증서 및 timestamp, 전체 payload hash 검증 통과.
- 포함 ARM64/x64 런타임의 인증 handshake/ping 및 installer safety 검증 통과.
- `--install-components core,rad64,vs26` 종료 코드 0으로 설치 완료.
- 설치 경로: `%LOCALAPPDATA%/Programs/PiAgent/releases/0.9.14-20261005010910`.
- Core/VSIX/RAD64 등록과 UI execution.js hash 검증. RAD64 프로세스에서 새 BPL 실제 로드 확인.
- 오래된 관리 Core를 종료하고 설치된 ARM64 Core를 시작. OMP 경로는 기존 18.6.0 복사본에서
  `%LOCALAPPDATA%/omp/omp.exe`의 18.6.1로 변경. 다른 접근·작업영역 설정은 보존.
- 새 Core의 실제 Named Pipe에서 인증/ping, NanumPDF workspace bind, preferences 버전 0.9.14,
  OMP 18.6.1, 모델 160개/역할 15개/boolean 설정 14개 조회 검증.
- VS2026에서 NanumPDF.sln을 다시 열고 Tools.PiAgentOpenChat 명령 실행.
  새 Core의 OMP child가 NanumPDF workspace namespace에 연결된 것을 확인.
- VS2022/RAD32는 교체 대상으로 선택하지 않았다. 모든 채팅 동작의 설치 IDE 전수 검증은 미완료다.
- 복구·검증 자료: `artifacts/deployment-0.9.14`, 이전 설치 release는 유지.
