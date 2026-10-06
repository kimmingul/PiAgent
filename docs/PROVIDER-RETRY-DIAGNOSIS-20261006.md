# OMP provider 재시도와 PiAgent 조기 종료 진단

확인일: 2026-10-06 KST. 실행 중인 VS2026의 PiAgent 화면, 저장 세션, OMP 로그 및 로컬/원격 Git 상태를 읽기 전용으로 확인했다. 프롬프트 재전송, 승인/복원, 프로세스 종료, 인증 설정 변경이나 NanumPDF 수정은 수행하지 않았다.

## 관찰

- Core sessionId: `62f8a3e0-2995-4f69-8fb3-e0d57a87905e`.
- 오류 turnId: `9f3cfd03-6cc1-4b28-b445-7e1489a8b402`.
- 해당 savedSessionId: `cac7f2a3-8205-4b7f-8528-a6dd8d76d898`.
- 설치 release: `0.9.14-20261005095258`, Core PID 17852, OMP PID 7532.
- 10:14:47: NanumPDF private 소스 push와 별도 공개 배포 저장소 관련 사용자 요청 시작.
- 10:15:19.029: Anthropic `claude-sonnet-5-5` provider error: `The socket connection was closed unexpectedly before the response completed`.
- 10:15:19.044: PiAgent lifecycle에 턴 `error` 기록. 저장 transcript도 여기서 종료된다.
- 10:15:19.419: OMP 로그에는 `agent.continue scheduled`, source `automatic-retry` 기록.
- 10:22:52: 원본 OMP 세션에는 정상 `stop` 최종 응답이 저장됨. 저장소 생성/push 및 배포 준비 결과를 설명한다. PiAgent transcript에는 이 응답이 없다.
- 읽기 전용 GitHub 조회: `nanumspace/NanumPDF` private, `nanumspace/NanumPDF-dist` public. 소스 main 원격/로컬 HEAD는 `871572c1544b0c81cd8280c230dec0d336e6534d`로 일치하고 작업 트리는 깨끗하다. 공개 배포 저장소에는 릴리즈가 없다.
- 현재 UI는 Core `연결됨`, 복원 승인 카드와 중지 버튼이 보인다. 별도의 복원 분기 `03fe30e3-32f5-4666-b5d2-6dc482a40da8`가 생성돼 있으나 승인 대기를 조작하지 않았다.

## 원인과 한계

첫 오류는 Git push 실패나 Named Pipe 연결 종료가 아니라 OMP의 모델 provider 응답 스트림 오류다. 공급자/중간 네트워크 중 어떤 장비가 socket을 닫았는지는 현재 로그만으로 특정할 수 없다.

PiAgent Core의 `chat.ts`는 `message_end`의 `stopReason=error`에서 즉시 `finish('error')`를 호출한다. 설치된 compiled 코드에도 동일한 분기가 있다. OMP native 모드에서는 개별 assistant 오류 뒤 자동 재시도가 이어질 수 있으므로 이것은 전체 턴 종료 신호가 아니다. Core가 먼저 turn을 지운 뒤 후속 delta/tool/final 처리를 건너뛰어 OMP와 UI 상태가 갈라진다. 재시도 안내는 표시하면서 실제 최종 응답은 잃을 수 있다. PROTOCOL.md의 native 최종 종료 기준과도 맞지 않는다.

컨텍스트는 해당 후속 최종 응답 기준 약 695k tokens이며 모델 contextWindow는 1M으로 기록됐다. 크기가 지연에 영향을 줄 가능성은 있지만 이번 socket 종료의 원인으로 단정하지 않는다.

## 권장 수정 순서

1. Native profile의 개별 `message_end` 오류를 잠정 오류로 보관하고 전체 턴을 종료하지 않는다. `session_settled` 또는 최종 `prompt_result`를 최종 완료/실패 기준으로 사용한다. Restricted profile, 명시적 취소, 실제 프로세스/프로토콜 종료는 각각 기존 계약에 맞게 처리한다.
2. `auto_retry_start/end`를 진행 상태에 반영하고 재시도 성공 뒤 스트림·도구·최종 응답·transcript를 계속 처리한다. 재시도 종료만을 전체 완료로 간주하지 않는다. 최종 실패 시 보관한 provider 오류를 정확히 보고한다.
3. Core/UI/OMP의 실행 상태가 일치하기 전 새 prompt·복원·분기 등 세션 변경을 허용하지 않는다. 재연결/재시작 시에는 해당 OMP 세션의 실행 상태와 최종 결과를 대조해 복구한다. GitHub 업로드처럼 외부 효과가 있는 요청을 자동으로 다시 보내지 않는다.
4. 회귀 fixture: 오류→재시도→도구 실행→최종 성공, 재시도 소진→최종 실패, 재시도 중 취소/프로세스 종료, 늦은 이벤트·중복 종료, restricted 오류, 실패/복구 후 세션 변경을 검증한다.
5. 새 서명 설치본에서 격리된 fixture로 VS2026 실사용 검증을 먼저 수행한다. 실제 NanumPDF는 기존 원본 OMP 최종 응답을 복구/표시하고 원격 상태를 확인해 중복 push 요청 없이 이어간다.

## 구현 결과

`chat.ts`의 native provider 오류는 잠정 오류로 보관하며 최종 settlement까지 턴을 유지하도록 수정했다.
재시도 성공 후 도구 이벤트·최종 답변·저장 transcript를 처리하고, 재시도 소진 시 최종 provider 오류를
표시한다. `auto_retry_end` 자체는 완료 신호로 처리하지 않는다. TurnProgress는 조용한 재시도 대기에도
`retrying` 상태를 유지한다. 기존 턴 소유권 검사가 유지되므로 재시도 중 새 prompt를 거부한다.

실제 OMP child fixture를 사용한 회귀 테스트에서 성공·최종 실패·취소·프로세스 종료·restricted 오류와
중복 완료 방지, 저장 transcript 및 다음 prompt 실행을 검증한다. 이번 수정은 실행 중인 설치 Core에
hot patch하지 않았다. 기존 UI에서 이미 잃은 답변을 과거 로그로 자동 복원하는 기능은 별도 작업이다.
NanumPDF 작업의 외부 효과를 다시 실행하지 않는다.

검증 결과: TypeScript strict 빌드, 전체 자동 회귀 123/123, 재빌드된 C#/Delphi adapter 통합
15/15 통과. 수정본 버전은 0.9.15다. USB 인증서 미검출로 서명 설치 빌드가 중단됐으며,
사용자 요청에 따라 설치파일 준비와 설치는 후속 작업으로 보류했다.
