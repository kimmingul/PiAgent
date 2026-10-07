# OMP 기능 확장 진행표

현재 상태 갱신: 2026-10-08, PiAgent 0.9.18. 사용자가 승인한 순서대로 단계적으로 구현한다. 음성, 이미지·음성 생성 결과 표시,
협업·공유·방송·녹화재생은 대상에서 제외한다. RADAgent는 읽기 전용 reference implementation이다.
기존 채팅 UI와 다섯 설정 탭을 유지하고 관리 기능을 설정 안에 배치한다.

## 이번 구현과 검증

- 기능 목록: 실제 `omp --version`과 PiAgent의 명시적인 실행 제어 계약을 반환한다.
  OMP 18.6.1만 `verifiedContract`가 true다. 이 값은 **공식 RPC 계약을 확인했다는 뜻**이며
  모든 기능을 실제 설치 IDE에서 검증했다는 뜻이 아니다. 다른 버전은 미검증으로 표시하고
  실제 명령 오류를 숨기지 않는다. 명령별 자동 probe/지원 상태 캐시는 후속 작업이다.
- 모델 역할: 전역·현재 프로젝트 저장 위치 선택, 전역 프리셋 저장·적용·삭제.
  프로젝트는 `<bound-workspace>/.omp/config.yml`의 modelRoles만 변경하고 다른 YAML과 주석을 보존한다.
  revision 검사, PiAgent 쓰기 잠금, 임시 파일·atomic rename, 링크 거부를 사용한다.
  외부 편집기는 PiAgent 잠금을 공유하지 않으므로 최종 검사와 rename 사이의 외부 쓰기를 완전히
  잠글 수는 없다. 전역 쓰기는 OMP CLI를 사용한다. 프로젝트 전용 프리셋은 여기서 삭제하지 않는다.
  프리셋 적용은 선택 scope의 역할을 대체한다. defaultThinkingLevel은 OMP처럼 전역에 저장한다.
  두 설정의 CLI 저장은 단일 트랜잭션이 아니며, runtime/환경변수는 저장한 값보다 우선할 수 있다.
- 실행 제어: Fast, 자동 압축·재시도, 캐시 준비, steering/follow-up/interrupt 모드와 수동 압축.
  공식 enum 값만 받으며 unknown 상태를 임의의 기본값으로 채우지 않는다.
  수동 압축은 즉시 접수 후 operation 이벤트를 전송한다. 실행 중 prompt와 중복 제어는 거부한다.
  5분 timeout이면 OMP를 종료해 늦은 압축과 다음 prompt가 겹치지 않게 한다.
- 하위 에이전트: 목록, 기록, 지시 전달, 중단. 기록은 설정 안에 표시하고 HTML로 실행하지 않는다.
  사용자 제공 sessionFile 경로는 받지 않으며 목록/기록에서 비공개 sessionFile을 제거한다.
- Advisor·Memory·Prewalk: 설치 OMP의 config list에서 발견한 allowlist boolean 설정만 표시·저장한다.
  provider 인증값이나 권한 정책은 이 editor에 노출하지 않는다. Memory backend의 전체 관리,
  Advisor roster/진행 상태와 Prewalk 상태 표시는 아직 후속 범위다.

검증:

- 전체 `npm test`: 105/105 통과. 마지막 크기 제한·disconnect 처리 수정 후 해당 신규 7개 테스트 재통과.
- 인증된 Windows Named Pipe에서 압축 즉시 접수·완료 이벤트·실행 중 prompt 차단·완료 후 재사용 검증.
- 프로젝트 YAML 보존·stale revision·junction 거부, 프리셋 scope, boolean schema·secret 제외 검증.
- 설치된 OMP 18.6.1에서 버전과 14개 boolean 설정 조회 (사용자 설정 변경 없음).
- WebView2: 원본 설정 탭 유지, subagent 목록·기록의 HTML escape, 오류 표시,
  100/150/200% 배율 및 12개 도킹·탭·숨김 전환 통과.
- 스크린샷: artifacts/omp-controls-preview-207769d3b9e94835a3b89cca6ba01ad3/screenshots.
- 이 검증은 isolated WebView harness다. 현재 설치된 VS2026/RAD13.2의 업그레이드·실사용 검증은 아니다.
- VSIX 및 RAD Win64 BPL 빌드 통과 (`build-adapters.ps1 -SkipCodeSign -RadPlatforms Win64`).
  VSIX의 ui/execution.js 포함과 RAD 복사본의 SHA256 일치 확인. 서명·배포·설치는 이번 단계에서 수행하지 않았다.
  당시 package version 0.9.13의 개발 검증이었다. 후속 0.9.14 서명 설치파일에는 이 기능과 결함/장시간 작업 수정이 포함된다.

## 승인된 전체 순서와 남은 완료 조건

| 단계 | 상태 | 다음 완료 조건 |
|---|---|---|
| 1. 기능 탐지·공통 실행 처리 | 기본 구현 | 명령별 probe/실행 상태 및 지원 여부 캐시 |
| 2. 모델 프리셋·프로젝트 설정 | 역할·프리셋 구현 | scope별 유효값 provenance, 전체 프로젝트 설정 schema editor |
| 3. 고급 실행 제어 | 구현·자동 검증 | 실제 공급자 압축·재시도·Fast 검증 |
| 4. 하위 에이전트 관리 | 목록·기록·지시·중단 구현 | 재개·역할·사용량과 native lifecycle 통합 |
| 5. Advisor·Memory·Prewalk | boolean 설정 구현 | backend 관리·roster·상태 이벤트·효과 검증 |
| 6. Goal 모드 | 미구현 | native 자동 continuation을 PiAgent turn·승인·checkpoint·취소와 함께 추적 |
| 7. 세션 트리·handoff | 미구현 | private lease를 유지한 분기·이동·rollback; 기존 메시지 복원과 구분 |
| 8. worktree·IDE 프로젝트 연동 | 미구현 | Git 대상 검증, dirty buffer 검사, adapter에서 프로젝트 재열기 |
| 9. 관리 도구 | 미구현 | Skill·모델 refresh·background process·SSH의 typed CLI route와 오류·취소 |
| 10. 확장 UI 지원 확대 | 기본 dialog만 기존 지원 | OMP UI 계약별 widget/custom editor·취소·재연결 검증 |
| 11. 설치 IDE·배포 검증 | 서명 배포·부분 실사용 확인 | VS2026/RAD13.2 64bit의 PARTIAL/MANUAL 항목, 마지막 VS2022, 물리 x64 검증 |

Goal의 native RPC 자동 continuation은 현재 main-turn이 없어도 OMP가 실행될 수 있다.
단순 goal 버튼만 추가하면 PiAgent의 승인·복원 baseline 밖에서 변경이 발생할 수 있으므로
agent lifecycle과 checkpoint를 연결한 뒤 사용 가능하게 한다. 세션과 worktree 명령도 raw passthrough로
차단을 해제하지 않는다. IDE별 동작은 adapter에서 처리한다.

## 공식 기준

2026-10-05 후속 설치: 서명 0.9.14로 Core ARM64/VS2026/RAD13.2 64bit 교체 완료.
설치된 Core의 인증/기능 조회, VS2026 프로젝트 연결 및 RAD64 BPL 로드를 확인했다.
전수 실사용 acceptance와 미구현 단계는 여전히 남아 있다. [설치 결과](RELEASE-0.9.14.md).

- [OMP 18.6.1 RPC](https://github.com/can1357/oh-my-pi/blob/v18.6.1/docs/rpc.md)
- [OMP 설정과 scope](https://github.com/can1357/oh-my-pi/blob/v18.6.1/docs/settings.md)
- [모델 프리셋 계약](https://github.com/can1357/oh-my-pi/blob/v18.6.1/packages/coding-agent/src/config/model-presets.ts)
- [RPC Goal lifecycle](https://github.com/can1357/oh-my-pi/blob/v18.6.1/packages/coding-agent/src/modes/rpc/rpc-goal.ts)
