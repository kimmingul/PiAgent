# PiAgent 0.11.0 — 미출시 후보 (UNRELEASED CANDIDATE)

**한국어** · [English](RELEASE-0.11.0.en.md) · [후보 사용 안내](IDE-AGENT-INTEGRATION.md)

2026-10-09 기준 상태: **개발 후보이며 게시된 0.11.0 배포판이 아니다**.
소스는 현재 0.11.0 후보를 표시한다. 이전 실제 사용 검증과 진행 중인 soak receipt의
실제 0.10.0 바이너리 식별자는 유지하며 최종 0.11.0 검증은 별도다. 이 문서는 예정
릴리즈의 구현·근거를 기록한다. M0–M6 계획 전체는 완료되지 않았다. 4시간 soak,
최종 회귀·패키지 검사와 정식 비교 평가는 각각 별도 조건이다.

후보는 기존 Core/OMP/Named Pipe 구조에 실제 IDE 문맥, 검토한 변경, 실행 근거와
복구를 확장한다. SDK 호출은 VS/RAD 어댑터에 남으며 고정 도구 목록 대신 연결된
설치 환경의 실제 가용성을 따른다.

## 개선과 단계별 상태

| 단계 | 구현된 후보 동작 | 근거와 남은 범위 |
|---|---|---|
| M0: 기반 | 추가 협상 `ide.catalog.v1`, 타입이 있는 작업 가용성/사유, 구현 버전과 워크스페이스/리비전 연결; `/ide`와 설정에서 마지막 상태 표시 | 카탈로그 소유권·잘못된 payload·기존 연결 호환·작업 차단 검사. 기존 어댑터 결과 모양을 유지하며 보편적 완료 상태를 임의로 만들지 않음 |
| M1: 문맥과 빌드 | 프로젝트/문서/구성/의존성 문맥; VS 네이티브 대상 build/rebuild/clean; RAD 네이티브 완료 notifier와 명시적 외부 MSBuild | VS 실제 fixture 빌드 통과. RAD 외부 진단은 출처와 오래된 상태 가능성을 표시하며 네이티브 컴파일 메시지 열거는 미지원 |
| M2: 변경과 편집기 | 불변 의미 기반/디자이너 변경안, 실제 내용을 보여 주는 승인, 5분 만료·일회용 토큰·리비전 재검사; 제한된 Unicode 커서 문맥과 안전한 새 파일 식별 | WPF/WinForms C# 두 파일 rename/apply/네이티브 Undo와 오래된 변경안 거절 통과. RAD 명시적 수락은 undoable writer를 사용하며 IME/다른 공급자 공존의 넓은 검증은 남음 |
| M3: 테스트와 디버거 | VS 외부 VSTest/TRX 대상 선택과 확장한 네이티브 디버거 제어; RAD 명시적 DUnitX/NUnit XML 실행기와 제한된 ToolsAPI 디버거 | VS 실제 테스트/디버거 통과. RAD 실행기/parser/CPU/프로세스 fixture 통과; 더 넓은 실제 디버거/테스트 흐름 검증은 남음 |
| M4: 디자이너 | 생성·삭제·이벤트 연결 미리보기/승인과 별도로 검토하는 소스/폼/리소스 체크포인트 복원; 제한된 타입 기반 RAD 중첩 속성 | WPF와 .NET Framework WinForms 실제 fixture 통과. RAD VCL/FMX 저장 상태 강한 검사와 생성 단계 빌드 통과; 실제 구조 도구는 저장된 표준 폼/type/parent 엄격한 조건 필요 |
| M5: 성능과 로컬 작업 | 최신 .NET CPU/GC/이전 trace 비교; RAD Windows CPU 카운터; 검토한 로컬 publish; 로컬 Git 상태/diff/이력/브랜치와 stage/commit | WPF 프로파일/비교와 격리 로컬 publish receipt 통과. 문맥 크기 측정은 제한된 근거이며 속도 개선 입증이 아님; 원격 배포와 OMP 프로세스 풀링 없음 |
| M6: 검증과 패키지 | 결정적 수명 검사, 비교 benchmark 작업/보고 형식, 양언어 안내와 진단 companion 패키징/서명 지원 | 자동 검사와 범위를 한정한 실제 검사 통과. 4시간 실제 soak, 최종 서명 설치/업데이트/복구, 조건을 맞춘 정식 경쟁 제품 비교는 미완료 |

계획/읽기 전용 모드는 등록 전에 변경 작업을 제외하며 실행 시 접근 권한을 다시
검사한다. 실행 작업은 승인 전후 어댑터 상태를 검사한다. 취소/연결 해제는 자동
재실행 근거가 아니다. SDK나 프로세스 실행이 시작됐다면 효과가 이미 발생했을 수
있다. 네이티브 Undo, Core 파일 체크포인트, 디자이너 복구와 대화 복원은 서로 다른
범위를 유지하며 부분·불확실 결과를 성공으로 바꾸지 않는다.

## 현재 지원 범위

| 영역 | Visual Studio 2026 후보 | RAD Studio 13.2 후보 |
|---|---|---|
| 언어/문맥 | 공개 VS 솔루션/프로젝트/편집기 API; Roslyn C#/VB 탐색과 rename/format/simplify | 공개 프로젝트/그룹/items/의존성/구성 API; Delphi/C++Builder 의미 기반 리팩터링 bridge 없음 |
| 빌드/진단 | 네이티브 솔루션/선택 프로젝트 빌드; Error List/컴파일러 관찰 | 네이티브 compile notifier 완료; 저장된 활성 `.dproj`의 명시적 외부 빌드/log 진단; 대상/구성/platform 일치 제한 |
| 테스트 | 외부 `dotnet test`, VSTest/TRX, filter/configuration/framework/runsettings | 소스에서 command-line/NUnit logger를 확인한 빌드된 활성 DUnitX 콘솔 실행기; 필터와 실제 XML; discovery/암묵적 빌드 없음 |
| 디버깅 | 상태를 검사하는 breakpoint/실행/evaluation, thread/frame | 중단 상태 제어, 소스 breakpoint, 제한된 stack/thread와 안전 조건 evaluation; locals/frame 선택 미지원 |
| 제안 | 네이티브 VS suggestion/next-edit UI; 전체 버퍼 리비전을 갖는 제한된 UTF-16 문맥; 안전하게 연결된 새/미저장 문서 | 명시적 before/after 미리보기와 수락; UTF-8 writer/UTF-16 위치 변환; 최대 1 MiB 저장 버퍼는 제한된 커서 창 사용 |
| 디자이너 | WPF/WinUI 구조적 XAML/C# 소스 backend; 공개 in-process .NET Framework WinForms `IDesignerHost` 표준 컨트롤 | 기존 VCL/FMX 속성/참조/부모 변경; 저장된 직접 상속 표준 Delphi 폼/컴포넌트 조건하의 생성·삭제·이벤트 연결과 소스/폼 복구 |
| 프로파일/실행 | 사용 가능한 `dotnet-trace`를 통한 최신 .NET EventPipe; 구성 검사와 새 출력에 불변 승인된 로컬 publish | 정확히 일치하는 활성 실행파일 Windows CPU 카운터/비교; 출력/배포 metadata 검사; publish 미지원 |
| Git | 공유 인증 로컬 status/diff/log/branches와 검토한 stage/commit | 같은 Core 작업 흐름 |

VS 선택 프로젝트 빌드는 프로젝트 의존성을 제외한다. 의존성이 필요하면 솔루션
빌드를 사용한다. 테스트 결과는 외부 실행기의 근거이며 IDE Test Explorer 제어가
아니다. 테스트 0개, 보고서 부재, 오래된 진단과 dispatch 확인만으로 성공을 판단하지 않는다.

실제 의미 기반 검증은 C#과 제한된 VS2022 VB(5/5)를 다뤘고 WinUI3 소스 7/7과
생성 단계 세 개의 빌드를 통과했다. WinUI3 실행 앱/네이티브 visual designer 검증은
주장하지 않는다. 최신 out-of-process WinForms, 임의 Quick Action,
네이티브 C++ 의미 분석, UWP/Live Visual Tree 자동화, 임의 타사 디자이너 컨트롤과
일반 inherited form/collection authoring 지원은 주장하지 않는다. 네이티브 컴파일
메시지 열거, Delphi 의미 기반 도구, RAD ghost text/Tab provider와 원격/device/cloud
배포는 미지원이다.

GC allocation tick은 표본 추정치이며 collection duration은 측정된 GC pause time이나
heap snapshot이 아니다. EventPipe는 네이티브 C++/.NET Framework 프로파일링을
다루지 않는다. RAD CPU 카운터는 실제 시간 대비 프로세스 CPU이며 call stack,
할당 분석이나 Delphi GC가 아니다. 각 카탈로그/검사는 실제 가용 backend를 표시한다.

RAD 제한된 중첩 scalar 속성은 Font 필드를 포함해 구현됐으나 실제 Font 검증은
남아 있다. Collection authoring은 구현하지 않았다.

로컬 Git 승인은 캐시된 diff/메시지를 보여 준다. Stage는 index를 변경하고 commit은
로컬 hook/서명 설정을 따른다. 오래된 상태, 링크 경로, 바이너리, 사용자 clean filter,
이미 일부 스테이징된 선택 파일을 거절하며 다른 작성자의 index lock을 존중한다.
커밋 후 index 전달이 실패하기 전에 HEAD가 이미 바뀔 수 있다. `partial`,
`outcome_unknown`, `applied_verification_failed`는 재시도 전 검사가 필요하다.
Push·checkout·reset이나 동시 수동 ref 변경에 대한 원자성은 약속하지 않는다.

Git 내용 조회/검토는 기존 워크스페이스 보호 경로 정책을 공유한다. 관련 추적 변경의
제외 경로가 있으면 diff/스테이징 검토를 거절하며 이름 변경/삭제 경로도 검사한다.
커밋 검토는 스테이징된 제외 경로가 하나라도 있으면 거절한다. 상태 출력에서는
제외 이름을 숨긴다. 이력 메시지/브랜치 이름은 메타데이터이며 전체 이력의 비밀
제거를 주장하지 않는다. 보호된 변경은 수동으로 처리해야 한다.

## 기록된 검증

- 보호 경로 Git 회귀 3개 추가 후 최신 전체 TypeScript/직렬 Node 검사: **205 PASS, 0 FAIL, 선택 네이티브 RAD receipt 검사 1개 skip**(총 206개; 147,544.6771 ms). 집중 Git/워크스페이스 검사는 **15/15, skip 0개**를 통과했다. fixture 호환성만 수정한 최종 어댑터 통합은 **18/18, skip 0개**를 통과했다.
- 실제 payload/Core 재생: production C# 결과 emitter와 실제 RAD VCL/FMX 변경/복구 receipt를 사용해 **2 PASS, 0 skip**. 실제 내용 승인, 정확한 proposal/checkpoint 전달과 일회용 처리를 검사하며 이 테스트의 SDK 변경은 모의 처리한다.
- 실제 VS2026 격리 프로필: **WPF 11/11 PASS**, **.NET Framework WinForms 8/8 PASS**. 문맥/빌드, 두 파일 rename/네이티브 Undo, 오래된 변경 거절, 디버거와 디자이너 세 작업/정확한 복원을 포함한다. WPF는 실제 VSTest, 격리 로컬 publish와 연결된 CPU/GC/비교도 통과했다.
- 실제 RAD13.2 Win64: VCL/FMX 각각 **생성·이벤트 연결·삭제·역순 복원 강한 6단계** 통과. 생성된 프로젝트 단계 여섯 개가 모두 빌드됐으며 저장 소스/리소스 검사가 이전의 불충분한 returned-success 검사를 대체했다. VCL 실행 창을 관찰했다. 일반 프로젝트 호환성이나 RAD32 UI 검증을 의미하지 않는다.
- 최종 RAD wave24 VCL/FMX는 각각 **실제 인증 Core→ChatWorker→SDK 시나리오 8개**(승인 이벤트 4개를 포함한 receipt 행 12개)를 통과했다. 거절된 빌드의 네이티브 실행 0회, 승인한 네이티브 빌드, 실제 구조 변경 내용 승인, 정확한 소스/폼 복원과 소비된 토큰 재실행 거절을 포함한다. 네이티브 디버거, Windows CPU/비교, 한글/emoji 편집기 completion/next-edit/Undo/오래된 상태 거절도 통과했다. 실제 DUnitX는 테스트 2개/실패 1개/exit 1, 필터 실행 테스트 1개/실패 0개/exit 0을 반환했다.
- 실제 파이프 결정적 수명 검사: 서로 다른 프로젝트 전환/재개 10회, 모드 전환 10회, 취소/정상 완료 주기 30회, 편집기 요청 100회 통과. **프로세스 인스턴스 131개**가 모두 종료됐으며 인스턴스 ID로 Windows PID 재사용을 구분했다. 약 27초 fixture 검사는 4시간 실제 soak가 아니다.
- 현재 VSIX에 진단 EXE/config와 전체 실행 의존성, package/license 목록이 있다. 서명/검증 스크립트 구문 검사를 통과했고 실제 패키지 안의 자사 EXE 검증을 포함한다. 서명 0.11.0 VSIX/companion 서명은 유효하며 최종 WebView 79개(전환 포함), 서명 VS2026 WPF 11/11을 통과했다. 서명 RAD VCL/FMX 각각 디자이너 6/네이티브 SDK 26/Core 8 시나리오와 생성 단계 여섯 개 빌드를 통과했다. 최종 통합 설치 게시나 4시간 soak 완료를 뜻하지 않는다.
- 최종 서명 VS2022는 최종 DLL(SHA256 시작 6A3141)로 **WinForms 8/8·C++ 3/3**을 통과했다. 서명 VS2026 WPF의 생성 단계 빌드 3개와 실제 실행 컨트롤도 통과했다. 보호 Git 수정을 반영해 다시 만든 서명 설치파일은 전체 payload 해시, ARM64/x64 번들 runtime·정책 검사와 영어→한국어 전환 중 IDE 선택 보존을 통과했다(`setup-20261009-125725`, `test-installer-0.11.0-protected-git.log`). 이후 RAD Delphi personality/원본 프로젝트 식별 수정은 새 서명 release011b 검증을 통과했다(아래 상세 기록). 교체 패키지 검증은 남아 있으며 이전 RAD/설치파일 식별자는 유지한다.

새 집중 회귀는 ChatSession 갑작스러운 중단 후 요청 재실행 없는 재개, 256 KiB
체크포인트 예산 초과의 비치명적 처리, 하위 프로세스 종료가 불확실한 경우 편집기
대체 프로세스 시작 거절, 어댑터 dispatch 전 상속된 객체 필드 이름의 엄격한 schema
거절을 다룬다. RAD 실제 표준 폼 조건과 request retirement는 아키텍처별 SDK smoke
10개를 통과했지만 컴파일/smoke만으로 RAD32 UI 검증을 완료한 것은 아니다.

설치 OMP 18.6.1의 기본 모델(`anthropic/claude-opus-5-5`, minimal effort)로 유효하고
비어 있지 않은 합성 편집기 제안 10개를 받았다. 새 전체 버퍼 요청 5회와 커서 창
요청 5회에서 소스 payload는 61,440에서 4,096 bytes로 줄었으며 종료 포함 시간의
중앙값은 2,669.6과 2,503.2 ms였다. 각 쌍의 전체 버퍼 → 창 고정 순서, 표본 5개와
통제되지 않은 공급자/cache 영향 때문에 신뢰할 만한 인과적 속도 개선, p95, 품질·비용
주장을 할 수 없다. 후보의 문맥 크기를 비교했으며 설치 0.10.0과 0.11.0 비교가 아니다.

## 남은 릴리즈 조건

VS/RAD의 240분 네이티브 context/catalog/build soak가 진행 중이며 이 문서에 완료가
기록되지 않았다. 남은 M6에는 고정 바이너리의 최종 전체 Core/adapter/UI 검사,
바쁜 UI의 취소/연결 해제 fault 검증, 더 넓은 RAD runtime/editor/중첩 속성과
더 넓은 VS 프로젝트/IME 시나리오가 포함된다. 제한된 VS2022 fixture는 통과했으며 RAD32와 물리 x64 검증은 주 검증
환경인 VS2026/RAD13.2 Win64와 구분해야 한다.
VS/RAD 네이티브 구조 미리보기는 변경 전에 완전한 원본 복구 검토와 전체 escaped
제안 envelope를 검사한다. RAD 구조 변경은 바이너리/디코딩 불가능한 소스/폼 리소스를
제외한다. 이 조건을 적용한 최종 wave24 VCL/FMX raw 복구 payload 모두 Core 재생을
통과했으며 검증 fixture 범위의 근거이지 임의 프로젝트 호환성 주장은 아니다.

보호 Git 설치파일의 payload/runtime/정책 검사는 통과했으나 최종 서명 RAD 식별
수정을 담은 교체 패키지를 기다리는 이전 후보가 됐다. 서명 RAD 식별 수정은 새
`ide-dev-release011b` VCL/FMX 각각 디자이너 6·네이티브 SDK 26·Core 8 시나리오와
생성 단계 여섯 개 빌드를 통과했다. 실제 외부 `.dpr` 별칭 빌드/진단은 원본
`.dproj`/Delphi 식별자를 유지했다. 두 BPL 서명이 유효하며 SHA256은
Win64 `598202985DF8705A441F4BD694C97B24F89C05A6B830A87D39256CAE359A2275`,
Win32 `E099084DDA176B30814FEC9FB38947B4D57E36127AFAABEC62B908BD5E4A9147`이다.
외부 빌드는 활성 원본 `.dpr`/`.dproj`와 `Delphi.Personality`를 요구하며
`.cbproj`, `.dpk`, 다른 personality의 sidecar는 미지원이다. 최종 패키지 검증, 신규 설치,
업데이트와 이전 버전 복구는
남아 있다. 릴리즈 준비 전 저장소 버전 표기를 출시된 배포판으로 취급해서는 안 된다.
정식 Copilot/Kai 우월성 주장을 하지 않는다. 비교를 발표하려면 모델/설정/작업을
맞추고 정확성을 독립적으로 평가하며 실패·미지원 시도를 분모에 남기고 충분한
조건 일치 지연 표본을 수집해야 한다.

[후보 사용 안내](IDE-AGENT-INTEGRATION.md), [계약](IDE-CATALOG-CONTRACT.md),
[개발 계획](IDE-AGENT-ROADMAP.md), [검증 이력](VALIDATION.md)을 참조한다.
재현 도구는 [실제 어댑터 재생](../scripts/validate-designer-contract.mjs),
[편집기 문맥 측정](../scripts/measure-editor-context.mjs),
[benchmark 보고 검사](../scripts/ide-benchmark.mjs)다.
`artifacts/ide-agent-20261009/`와 어댑터 fixture 디렉터리의 로컬 receipt/log는
근거 파일이며 자동으로 공개 릴리즈 자산이 되는 것은 아니다.
