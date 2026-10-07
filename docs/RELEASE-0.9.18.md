# PiAgent 0.9.18 — RAD 폼 디자이너 진단 개선

2026-10-08 KST. OMP 도구 승인과 IDE 디자이너의 변경 가능 상태를 구분한다.

- 디자이너 조회/속성/참조/부모 이동 도구의 OMP 승인 카드에 작업 범위와 거절·취소 의미를 표시한다. 승인 정책과 선택지는 유지한다.
- RAD VCL/FMX snapshot에 저장되지 않은 변경, 읽기 전용 소스, 지원하지 않는 프레임워크, 변경 서비스 부재의 구체적인 이유를 제공한다.
- 변경할 수 없는 snapshot은 scalar 속성과 참조/부모 이동도 쓰기 가능으로 광고하지 않는다.
- Core가 모델에 호스트의 읽기 전용/계획 상태를 전달하고, IDE의 차단 이유를 실제 변경 오류에 보존한다.

컨트롤 생성·삭제, 이벤트 처리기 생성, 복합 속성/컬렉션의 네이티브 디자이너 자동화는 아직 지원하지 않는다.
지원 범위 밖 작업은 승인된 소스 변경 후 IDE 새로고침·재조회와 빌드·실행 검증이 필요하다.

## 원인과 설치 수정

RAD13.2 64-bit에 0.9.15와 0.9.16 BPL이 중복 등록되어 실제 0.9.15가 로드됐다.
서명 통합 설치파일로 Core/RAD32/RAD64를 업데이트하여 각 위치에 0.9.18 하나를 등록하고
실제 로드된 Win64 BPL 경로를 확인했다. 기존 설정, OMP 18.6.1 및 대화는 유지했다.
[오류별 진단과 복구](RAD-DESIGNER-DIAGNOSTICS.md).

## 검증

- 전체 자동 회귀 **143/143**, C#/Delphi adapter 통합 **17/17**.
- VCL: 실제 모델의 조회 → Caption 변경 승인 → ToolsAPI 저장 → 재조회 성공.
  기존 BPL의 첫 검증 후 설치 0.9.18 BPL로 반복하여 `PiAgent VCL 0.9.18 Verified`, `dirty: false`,
  `applied: true`를 확인했다. Delphi Win64 빌드와 실제 실행 창 제목도 확인했다.
- FMX: 실제 설치 0.9.18 BPL과 모델로 같은 흐름 성공. `applied: true`, 저장 후 `dirty: false`,
  새 Caption을 확인했다. 저장된 프로젝트를 Delphi Win64로 빌드하고 실제 실행 창에서도 제목을 확인했다.
- FMX 미저장 Caption 변경을 IDE에서 직접 재현: `dirty: true`, `canSetProperty: false`,
  `writeBlockCode: unsaved_changes`, Caption `writable: false`, 빈 supportedOperations를 모델이 보고했다.
  모델은 관리자 권한 문제가 아니며 저장·재조회가 필요함을 안내했고 파일 변경은 없었다.
- 네이티브 VCL/FMX hierarchy, 메뉴, 공유 Actions, Owner 보존, 순환/읽기 전용 관계 차단 검사 통과.
  FMX streamed 메뉴·툴바·상태 구조, New 동작과 UTF-8 파일 round trip 검사 통과.
- 설치 패키지 UI의 WebView 검사 **70 PASS**, 도킹/탭/숨김 12회 전환과 한국어 초안 보존 확인.
- 통합 설치파일과 VSIX, 내부 DLL, Win32/Win64 BPL, PipeHost 코드서명 및 타임스탬프 검사 통과.
  내장 전체 파일 해시와 번들 ARM64/x64 인증 handshake/ping, 설치 안전성 검사 통과.

증거: `artifacts/designer-0.9.18-{final-regression,adapters,build,harness,installer-test,webview}.log`,
`artifacts/designer-validation-20261008/`의 별도 프로젝트, 모델 대화 기록과 실행/승인 화면.
사용자의 실제 프로젝트는 검증용 변경에 사용하지 않았다.
RAD32 IDE UI, 전체 컴포넌트/serializer와 생성·이벤트 자동화의 전수 검증을 뜻하지 않는다.
실행 창은 화면에서 확인했지만 자동화 도구가 창을 반환하지 않아 그 창의 버튼/메뉴 클릭 검증은 하지 않았다.

최종 서명 설치파일 SHA-256:
`06a7e96cb8ad2cf83de30c453d313b5d19b2bf74c6fe8195a3cde269da97c727`.
최종 문서 포함 빌드와 payload 재검증 증거는
`artifacts/designer-0.9.18-final-installer-{build,test}.log`에 기록했다.
