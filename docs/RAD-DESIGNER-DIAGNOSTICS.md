# RAD Studio 폼 디자이너 승인과 변경 차단

2026-10-08 KST · PiAgent 0.9.18 · RAD Studio 13.2 64-bit / OMP 18.6.1.

## 확인한 원인

실제 IDE에는 PiAgent 0.9.15와 0.9.16 BPL이 함께 등록되어 있었고, 로드된 모듈은 0.9.15였다.
통합 설치파일로 Core와 RAD32/64를 업데이트하여 각 등록 위치에 0.9.18 하나만 남겼다.
기존 설정, OMP 설치와 대화는 유지했다. 다른 버전의 BPL이 로드되면 새 Core만 교체해도
디자이너 상태 판단은 이전 코드로 실행된다.

OMP `always-ask`에서는 조회 전에도 `Allow tool: ide_designer_inspect` 승인이 필요하다.
이것은 Windows 관리자 권한 요청이 아니다. 과거 테스트 기록에도 조회 도구 거절 결과가 있었다.
단, 사용자가 경험한 모든 오류가 이 거절 때문이었다고 단정할 수는 없다.
공식 [OMP 승인 모드](https://github.com/can1357/oh-my-pi/blob/main/docs/approval-mode.md)와
[18.6.1 RPC 구현](https://github.com/can1357/oh-my-pi/blob/v18.6.1/packages/coding-agent/src/modes/rpc/rpc-mode.ts)을 확인했다.
현재 host tool 등록에는 조회 도구의 승인 등급을 지정하는 필드가 없다.
PiAgent는 승인 정책을 우회하지 않고 요청 카드에 작업 범위와 거절·취소 의미를 추가한다.

RAD adapter는 저장하지 않은 모듈 변경이 있으면 쓰기를 차단한다. 이전 Core는 이때 구체적
원인 대신 일반적인 변경 불가 오류를 반환했다. 일부 속성도 여전히 writable로 표시했다.
0.9.18은 이 모순을 없애고 실제 차단 이유를 모델에 전달한다.

## 오류별 복구

| 상태 / 결과 | 의미와 조치 |
|---|---|
| `Allow tool: ide_designer_inspect` | 열린 폼 조회를 위한 OMP 승인. 승인하면 조회, 거절·취소하면 실행하지 않는다. |
| `Tool call denied by user` | OMP 도구 실행이 거절됨. 원하는 작업이면 새 요청에서 해당 도구를 승인한다. |
| `writeBlockCode: unsaved_changes` | 대상 모듈에 미저장 수정이 있음. IDE에서 저장하고 다시 조회·승인한다. |
| `source_read_only` | IDE 디자이너가 읽기 전용 소스로 판단함. 프로젝트의 실제 읽기 전용 원인을 확인한다. |
| `modification_service_unavailable` | IDE 변경 서비스가 없음. 대상 폼이 정상 디자이너로 열렸는지 확인한다. |
| `unsupported_framework` | 네이티브 도구의 지원 범위 밖. 프레임워크와 지원 작업을 확인한다. |
| `hostAccess.canWrite: false` | 계획 모드, 연결 capability 또는 Core의 쓰기/Git 설정 문제. 함께 반환된 reason을 따른다. |
| stale revision | 조회 후 폼 내용이 바뀜. 다시 조회하고 변경 내용을 재승인한다. |

정상 순서는 폼 열기 → 조회 도구 승인 → snapshot 확인 → 변경 도구 승인 → IDE 변경 값 검토/승인
→ 저장 → 재조회 → 빌드·실행이다. 승인 방식에 따라 IDE 변경 승인 횟수는 다르다.
`always-ask`의 OMP 승인과 실제 IDE 변경 값 검토는 별도 단계다.
관리자 실행이나 권한 무시 모드로 전환할 필요는 없다.

## 검증 범위

사용자 프로젝트 대신 별도 Git fixture를 만들고 실제 모델에 소스 직접 편집을 금지한 상태로 검증했다.
VCL과 FMX 모두 설치 0.9.18 BPL에서 실제 조회, Caption 변경, IDE 저장, 재조회와 실행 화면을 확인했다.
FMX 미저장 변경을 직접 재현하고 구체적 차단 이유와 저장·재조회 안내, 파일 보존을 확인했다.
최종 설치·회귀 결과는 [릴리즈 기록](RELEASE-0.9.18.md)을 따른다.

지원 도구는 조회, scalar 속성 변경, 제한된 참조 연결과 기존 컴포넌트 부모 이동이다.
컴포넌트 생성·삭제, 이벤트 처리기 생성, 복합 속성/컬렉션 변경을 네이티브 디자이너가
모두 처리한다고 주장하지 않는다. 해당 작업은 승인된 소스 변경과 디자이너 재조회·빌드·실행이 필요하다.
RAD32는 빌드·서명·등록 검사와 RAD64 실사용 검증을 구분한다.
