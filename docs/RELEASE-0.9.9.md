# PiAgent 0.9.9 사전 릴리즈

Node.js 24 LTS/TypeScript Core, Named Pipe JSON-RPC, OMP JSONL RPC 구조를 유지한다.
RADAgent 원본 WebView UI/UX를 유지하면서 VS/RAD host 연결을 보완했다.

## 변경

- 메시지별 대화 분기·복원, 원본 세션 보존 및 복원 초안 반환.
- 승인 후 기존 Git 추적 UTF-8 파일 복원, 수동 변경·미저장 편집기 차단.
- ARM64 Windows Core 자동 실행 및 인증 bootstrap 수정.
- BTW/설정/접근 모드/첨부/폴더/MCP/플러그인/계획/대기열/사용량 연결 보완.
- 무응답 OMP 취소, 설정 후 동적 UI 상태, C#/XAML/FMX 파일 참조 수정.
- RAD 복원 후 FMX 디자이너 갱신, MCP 편집기 표시 및 폴더 선택 창 소유자 수정.
- Windows DPAPI PIN을 CNG/CSP 서명 프로세스에 전달한다. CNG 키를 명시적으로
  취득하고 private signing에 silent flag를 적용해 별도 PIN 대화상자를 사용하지 않는다.
- MSBuild 환경의 console codepage와 관계없이 pinned Sign CLI 소스를 UTF-8로 읽는다.

## 배포 범위

통합 설치 프로그램에서 RAD Studio Win32/Win64, VS2022/2026을 선택할 수 있다.
Windows x64/ARM64 Node 및 .NET runtime을 포함하고, OMP 미설치 시 선택 설치한다.
실사용 검증은 이 ARM64 PC의 VS2026과 RAD13.2 Win64에서 수행했다.
VS2022 및 RAD32는 빌드·자동 검증 범위이며 이번 실사용 검증 대상이 아니다.

## 알려진 검증·지원 제한

- BTW 삭제는 서비스 회귀로 확인했으나 설치 IDE의 삭제 UI는 미검증이다.
- provider retry 취소는 설치된 UI 자산을 실제 WebView2에서 controlled fixture로 검증했다.
  실제 provider 장애를 강제로 발생시키지는 않았다.
- RAD HTTPS 링크는 Edge 새 탭 열기를 확인했으나 마지막 브라우저 캡처는 도구의 URL 판별 제한으로 중단했다.
- 복원은 기존 Git 추적 UTF-8 파일로 제한된다. 신규/삭제/바이너리/미추적 파일 및 미저장 버퍼 복원을 지원하지 않는다.
- 메시지 snapshot 50개, OMP JSONL 64 MiB, 파일 capture 500개/8 MiB/파일당 32 KiB;
  복원 8개/양쪽 128 KiB, preview 유효시간 5분.

상세 증거: [설치본 검증 기록](MESSAGE-TIMELINE-AND-INSTALLED-ACCEPTANCE.md).

## 자동 검증

- `npm test`: 89/89 통과.
- C#/Delphi 인증 Named Pipe 통합 테스트: 15/15 통과.
- VSIX 및 RAD Win32/Win64 빌드 완료.
- 통합 setup 자체 진단: ARM64, RAD32/RAD64, VS2022/2026, 기존 OMP 감지 확인.
- embedded payload 모든 SHA-256 검증 통과.
- bundled Node 24.21.0 ARM64/x64 각각 인증 handshake/capability negotiation/ping 통과.
- installer safety tests 통과: 변조/traversal/기존 추출 경로/미설치 IDE 거절, 업그레이드 설정 보존.

## 코드서명 검증

실제 USB 인증서 `3CE49DE1124F325082FA90BDE4944756D1626251`로 서명했다.
Win32/Win64 BPL, pipe host, VSIX 내부 DLL 및 OPC 컨테이너, 통합 setup의 서명을 검증했다.
PE는 SHA-256/RFC3161 timestamp를 포함하며 VSIX는 content signature/신뢰 체인을 확인했다.
암호화 PIN 등록 후 별도 PIN 입력 없이 연속 서명을 완료했다.

서명된 setup 자체 진단, embedded payload hash 전체 검사, ARM64/x64 runtime handshake/ping,
installer safety tests가 통과했다. 실제 설치 IDE의 남은 검증 항목은 위 제한을 그대로 유지한다.
