# PiAgent 0.11.1 — 범위를 명시한 서명 사전 릴리즈

**한국어** · [English](RELEASE-0.11.1.en.md) · [사용 안내](IDE-AGENT-INTEGRATION.md) · [검증 이력](VALIDATION.md)

2026-10-10 KST 현재 **후속 소스, 서명 어댑터의 격리 IDE fixture와 첫 서명 설치파일을 검증한 제한적 사전 릴리즈**다. 일반 IDE 프로필의 0.11.1 설치/복구는 수행하지 않았다. 공개 0.11.0 설치파일과 그 해시·실제 업데이트/롤백/복원 근거는 [0.11.0 기록](RELEASE-0.11.0.md)에 그대로 둔다. 이전 0.11.0 패키지의 검증이 새 바이트를 인증하지 않는다.

이번 릴리즈는 중단·재연결·대화 저장 경계에서 지연된 이전 턴 이벤트가 새 세션의 초안, 승인 카드, URL 열기 또는 설정을 바꾸지 못하도록 한다. 연결하지 않은 상태의 언어 전환과 연결됐지만 턴이 없는 상태의 로그인은 계속 허용한다. VS 코드 제안은 표시 전후의 문서/세션 상태를 다시 확인하고, 오래된 제안과 취소를 안전하게 처리한다. VS 다중 파일 변경은 부분 적용/복구 실패를 성공으로 보고하지 않는다. RAD 디자이너 복구는 저장 파일뿐 아니라 실제 열린 폼의 상태도 다시 확인한다. 구성요소 경로의 `Columns` 인덱스 검사 오류도 수정했다.

VS 테스트에는 명시적으로 선택한 MTP 프로젝트를 실행하고 TRX 결과를 읽는 경로가 추가됐다. 실제 fixture에서 두 테스트의 성공과 의도적으로 한 테스트가 실패한 결과를 확인했다. MTP 사용에는 명시적 framework와 opt-in이 필요하다. 이 경로는 IDE Test Explorer 조작이 아니며 MTP filter/runsettings를 지원하지 않는다. 최신 out-of-process WinForms 디자이너도 여전히 지원 범위 밖이다.

## 검증 범위

| 검사 | 기록된 결과 | 해석 |
|---|---|---|
| Core 전체 직렬 회귀 | 226개 중 **225 PASS, 0 FAIL, 선택 RAD receipt 1 skip** | 지연 이벤트와 연결 해제 경계 포함 |
| 어댑터 통합 | **17/17 PASS** | 짧은 결정적 수명 검사 포함; 장시간 soak 아님 |
| 공유 WebView | **93 PASS** | 실제 WebView2 DOM, 12회 도킹/탭/숨김 전환, 완료 후 null-turn 편집기·URL·확인 요청 차단 및 연결 중 idle 로그인 |
| VS 네이티브 콘솔 | **91 PASS** | 편집기 안전성과 MTP/TRX; 실제 성공·실패 MTP fixture 별도 확인 |
| VS2026 최종 서명 VSIX | WPF **8/8 PASS**, 보관된 VSIX UI **104/104**, 실제 공유 WebView **93 PASS** | VSIX SHA-256 `09DB05A9E02E2ECB8284AE38B4CD481314355E25A0B085C1F21D07FC025976D7`, 네이티브 DLL 버전 0.11.1; 격리 프로필 검증 |
| RAD13.2 최종 서명 BPL | Win32·Win64 각각 VCL **11/11**, FMX **9/9** | 실제 IDE fixture의 저장/재열기·복구·상태 검사. 두 BPL의 해시와 SDK/Core 세부 범위는 [검증 이력](VALIDATION.md)에 기록 |
| 이전 미서명 기준선 | VS2026 WPF **8/8**; RAD Win32·Win64 SDK 각 **11/11**, 생성 단계 빌드 VCL **5/5**, FMX **4/4** | 최종 서명 바이너리보다 앞선 독립 근거. 인증 Core routing은 Win64 기준선만 VCL **16/16**, FMX **12/12** |

상세 receipt와 실제 바이너리 SHA-256은 [검증 이력](VALIDATION.md)의 “Follow-up source validation”에 있다. 이전 미서명 VSIX는 나중에 고친 공유 UI 파일을 포함하지 않으며 최종 서명 VSIX 결과와 구분한다. RAD FMX Font는 `StyledSettings.Family`가 표시 모양을 덮을 수 있고 실제 시각적 폰트 검증은 완료하지 않았다. RAD32 Core routing과 일반 프로필 설치도 별도다.

사용자 요청에 따라 **엄격한 4시간 검증과 조건을 맞춘 경쟁 제품 실측 비교는 차후 진행**한다. 기존 두 IDE의 약 4시간 receipt는 UTC 기준 문턱에 미달해 PASS가 아니며 원래 바이너리 식별자를 유지한다. 신규 설치, 물리 x64, 더 넓은 프로젝트·IME·바쁜 UI 시나리오와 M0–M6 전체 완료도 주장하지 않는다.

## 서명 패키지와 배포 범위

첫 0.11.1 서명 설치파일은 서명, 전체 payload, ARM64/x64 번들 runtime과 정책 검사를 통과했다(`artifacts/release-0.11.1-installer-test.log`). 패키지 검사 **3/3**, 어댑터 통합 **17/17**도 통과했다. 문서를 포함해 재포장한 **최종 배포 바이트**는 자체 검사를 받아야 하며 해시는 [GitHub 릴리즈 자산](https://github.com/kimmingul/PiAgent/releases/tag/v0.11.1)의 `.exe.sha256`과 [검증 이력](VALIDATION.md)에 기록한다. 설치파일 검사는 일반 IDE 프로필의 0.11.1 설치/업데이트/복구 검증이 아니다.
