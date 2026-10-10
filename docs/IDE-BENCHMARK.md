# IDE 제품 비교 실행 규약

상태: **사용자 요청으로 경쟁 제품 실측 비교를 차후로 보류했다. 계획만 작성됨. 정식 비교 실행·결과·순위 없음.** 4시간 연속 검증도 차후에 진행한다. 이 문서는 나중에 사용할 실행 기준이다. [English](IDE-BENCHMARK.en.md)

## 계획과 범위

| 계획 | 제품 | 과제/반복 | 시도 수 |
|---|---|---:|---:|
| [VS 계획](../scripts/ide-benchmark-plan.json) | PiAgent / Copilot, VS2026 | 12개 × 각 5회 | 120 |
| [RAD 계획](../scripts/ide-benchmark-plan-rad.json) | PiAgent / KAI, RAD13.2 | 12개 × 각 5회 | 120 |

두 계획의 `mode`는 `product-default`다. 각 제품의 실제 기본 모델·설정을 기록하는 제품 경험 비교이며, 모델 자체의 우열을 입증하지 않는다. 동일한 제공자·모델·추론 강도를 양쪽에서 설정하고 검증할 수 있을 때만 별도의 `matched-model` 계획을 만든다. **KAI의 설치·계정·버전·실행 가능성은 확인되지 않았다.** 이를 확인하기 전에는 RAD 대조 실행을 시작하지 않고, 없는 결과를 `unsupported` 실행 기록으로 만들지 않는다.

[과제 명세](../tests/fixtures/ide-benchmark/tasks.json)의 ID와 한국어 요청을 사용한다. 명세는 과제 분류이며 즉시 실행 가능한 fixture가 아니다. 정식 실행 전 각 과제마다 독립 프로젝트와 고정된 최종 요청문, 시작 IDE 상태, 숨겨진 정답 검사, 복원 절차를 만들고 버전 관리한다. 사용자 프로젝트를 사용하지 않는다. 두 제품에 같은 과제 입력과 동일한 사용자 허용 범위·제한 시간을 제공한다. IDE/워크로드가 기능을 지원하지 않으면 그 시도의 실제 결과를 `unsupported`로 남긴다.

| VS 과제 ID | 독립 검사와 필수 증거 |
|---|---|
| `vs-context`, `vs-symbols` | 활성 구성·미저장 버퍼/오버로드 대상 식별; 원본 버퍼와 IDE 문맥·심볼 결과, 변경 없음 확인 |
| `vs-completion`, `vs-next-edit` | 적용 전 제안 위치·내용, 수락 후 빌드, Undo 바이트 복원 또는 문서 변경 후 오래된 제안 거절; 편집 전후 버퍼·화면 기록 |
| `vs-build-repair`, `vs-refactor` | 지정 구성의 실제 빌드 종료·진단, 의도한 참조만 변경·동명 그림자 심볼 보존; 빌드 로그·파일 diff·숨겨진 검사 |
| `vs-test-repair`, `vs-debug` | 원래 실패 재현 후 대상 테스트 재실행, 실제 중단점/stack 근거와 수정 후 동작; 테스트 결과·디버거 기록 |
| `vs-profile` | 같은 입력·설정의 전후 측정과 정확성 유지; 원본 trace·시간/CPU/GC 범위·출력 검사 |
| `vs-designer`, `vs-recovery` | 지원하는 WPF 또는 .NET Framework WinForms fixture의 UI/코드 일치와 실행; 변경 승인·복원 후 버퍼/파일 바이트 확인 |
| `vs-deploy` | 지원하는 로컬 게시 대상의 구성·출력 파일과 실제 완료; 임시 로컬 출력 manifest, 원격 부작용 없음 확인 |

| RAD 과제 ID | 독립 검사와 필수 증거 |
|---|---|
| `rad-context`, `rad-symbols` | 활성 프로젝트·플랫폼·미저장 코드 판별; 심볼 의미 탐색이 미지원이면 그 사실을 기록하고 텍스트 검색을 의미 결과로 세지 않음 |
| `rad-completion`, `rad-next-edit` | 현재 지원되는 미리보기/수락 경로에서 UTF-8 바이트·UTF-16 위치·한글/emoji/CRLF·Undo 확인; 네이티브 ghost/Tab을 가정하지 않음 |
| `rad-build-repair`, `rad-refactor` | 네이티브 빌드 완료와 외부 진단 출처 구분; 의미 기반 rename 미지원 시 결과를 그대로 기록, 텍스트 치환을 동등 기능으로 세지 않음 |
| `rad-test-repair`, `rad-debug` | 외부 DUnitX 러너의 실패/재실행 XML·종료값, 지원 디버거 상태와 stack 근거; IDE Test Explorer로 표시하지 않음 |
| `rad-profile` | 같은 입력의 제한된 CPU 전후 측정·정확성 검사; 호출 스택/할당 등 없는 메트릭을 만들지 않음 |
| `rad-designer`, `rad-recovery` | 직접 표준 VCL/FMX fixture의 생성·속성·이벤트·저장·다시 열기·실행 및 정확한 소스/폼 복원; 상속/타사 컴포넌트는 별도 지원 확인 |
| `rad-deploy` | manifest·출력·플랫폼 조회 범위 확인; 완료 통지가 검증되지 않은 배포를 성공으로 세지 않음 |

## 각 시도 전 고정할 것

1. 제품별 독립 IDE 프로필에서 버전·설치 기능·확장·계정·모델·추론 설정을 기록한다. 같은 PC, IDE 빌드, fixture commit, 프로젝트 구성·플랫폼, 프롬프트 언어, 시간 제한, 승인 정책, 네트워크 조건을 사용한다. 한 제품에만 기능이 없으면 실제 `unsupported`를 기록한다.
2. 각 과제의 **최종** 한국어 요청문과 정답 검사 정의를 파일로 고정하고 SHA256을 각각 `promptHash`, `acceptanceHash`에 기록한다. 선택 파일·커서·미저장 텍스트·디버거 상태·테스트 필터·임시 게시 위치까지 fixture manifest에 명시한다. `fixtureRevision`은 해당 fixture의 commit/hash, `environmentRevision`은 IDE/확장/설정 manifest의 hash다.
3. 매 시도 전 fixture를 원본으로 복원하고 버퍼, 폼, 빌드 출력, 테스트 결과, 임시 게시 폴더, 세션/캐시 상태를 확인한다. 복원 명령, 시작 상태의 파일 hash, IDE 상태 증거를 그 시도 고유의 `resetEvidence` 경로에 저장한다. 복원이 실패하면 해당 시도를 시작하지 않는다. 원래 실패 상태를 재현해야 하는 과제는 그 실패도 시작 상태 증거에 포함한다.
4. 각 과제·반복에서 제품 순서를 번갈아 실행한다(홀수: PiAgent 먼저, 짝수: 대조 제품 먼저). `cold`와 `warm`은 별도 계획 또는 완전히 분리된 결과로 기록하며, 동일 조건을 섞어 비교하지 않는다. 실행 순서·시작/끝 시각과 운영자 개입을 원본 로그로 보존한다.
5. 과제별 동일 시간 제한을 실행 전에 고정한다. 시간 초과·중지·실패·미지원도 누락 없이 한 시도씩 기록한다. 사용자 승인 횟수와 거절, 수정 횟수, 모델 지연과 IDE/통신 대기, 첫 유효 제안 지연을 구분해 관찰한다.

## 결과 파일과 판정

한 시도는 JSONL 한 줄이다. `scripts/ide-benchmark.mjs`의 필수 필드는 `runId`, `product`, `productVersion`, `ide`, `ideVersion`, `taskId`, `fixtureRevision`, `machine`, `provider`, `model`, `effort`, `permissions`, `cache`, `mode`, `startedAt`, `elapsedMs`, `outcome`이다. 비교 계획에는 `suiteId`, `repetition`(1–5), `promptHash`, `acceptanceHash`, `environmentRevision`, `resetEvidence`도 필요하다. `mode`는 계획과 동일하게 `product-default`다. 확인되지 않은 토큰·비용·메모리·CPU는 `0`이 아닌 `null` 또는 생략으로 남긴다.

`outcome`은 `passed`, `failed`, `timeout`, `unsupported`, `cancelled` 중 실제 상태다. `passed`는 이름·증거 경로가 있는 독립 검사 `checks`를 하나 이상 요구하며, 작업별 숨겨진 검사가 모두 통과해야 한다. 질문에 답했거나 빌드/배포 요청을 받았다는 ACK만으로 통과시키지 않는다. 로그·trace·diff·IDE 화면·시험 결과는 시도별 보존 디렉터리에 저장하고, 통과 판단자가 원본을 별도로 검토한다. 웹 검색 같은 허용 범위 위반과 운영자 중지도 해당 시도의 실패/중지 기록에 남긴다.

예시 명령은 **실제 시도 JSONL과 잠긴 fixture가 준비된 뒤**에만 실행한다.

```powershell
node scripts/ide-benchmark.mjs evidence/vs-runs.jsonl evidence/vs-report.json scripts/ide-benchmark-plan.json
node scripts/ide-benchmark.mjs evidence/rad-runs.jsonl evidence/rad-report.json scripts/ide-benchmark-plan-rad.json
```

비교 판정기는 계획 밖 시도, 중복 시도, 누락된 조합, 조건 불일치와 증거 필드 부재를 드러낸다. 12과제×5회의 조건 충족은 결과의 정확성이나 우위를 자동 판정하지 않는다. 성공률의 분모에는 실패·시간 초과·미지원·중지도 포함한다. 속도는 같은 독립 합격 기준을 만족한 시도끼리만 살피고, 과제별 5회로 p95를 주장하지 않는다. 각 제품·과제·반복의 원본값과 범위, 사용자 개입, 알 수 없는 비용을 함께 제시한다.
