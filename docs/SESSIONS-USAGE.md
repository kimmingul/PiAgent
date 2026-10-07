# 세션 저장·재개와 사용량 (0.9.17)

문서 갱신: 2026-10-08. 메시지별 분기·복원은 원본 대화를 보존하고 별도 세션을 열며,
대상 메시지 텍스트는 자동 전송하지 않고 초안으로 반환한다. 파일만 되돌리는 `/restore`와 구분한다.
복원 가능한 파일 범위/제외 항목은 [timeline 계약](../PROTOCOL.md)과
[메시지 검증](MESSAGE-TIMELINE-AND-INSTALLED-ACCEPTANCE.md)을 따른다.
고정 10분 턴 종료는 제거됐으며 조용한 실행 자체로 실패 판정하지 않는다.
실제 종료/오류와 진행 상태는 [장시간 lifecycle](LONG-RUNNING-TURN-FIX.md)에 기록했다.

Secure Core를 --omp로 실행하고 VS/RAD Chat에서 연결하면 새 대화가 자동 저장된다.
상단 대화 제목을 눌러 목록에서 재개할 대화를 고른다. 진행 중인 응답이나 승인 검토를 먼저 끝낸다.
새 대화는 기존 저장본을 보존하고 별도 세션을 만든다. IDE가 정상 종료하거나 연결이 끊기면
Core가 OMP를 종료한 뒤 transcript를 저장하고 lease lock을 해제한다.

프로젝트 재연결 시 마지막 선택 대화를 재개한다. 대화 목록의 빈 세션에는
`삭제` 버튼을 표시하며 `삭제 확인`을 눌러야 삭제한다. 취소하면 세션을 보존한다.
사용 중인 세션, 화면/OMP 대화 기록, BTW 대화, 계획, 메시지 분기·복원 기록 또는
알 수 없는 추가 파일이 있는 세션은 삭제하지 않는다. 화면 기록이 잘린 대화도 보호한다.
현재 열린 빈 세션은 다른 대화로 전환한 뒤 삭제한다. 최근 선택 세션을 삭제하면 다음 연결에서
남아 있는 재개 가능 대화를 선택하며, 없으면 새 대화를 만든다. 삭제는 되돌릴 수 없다.

저장 위치는 pipe credential의 private 부모 아래 `sessions/<workspace hash>/<saved UUID>/`다.
workspace가 없으면 OMP cwd로 구분한다. 다른 pipe/private 부모나 workspace에서 같은 목록을 공유하지 않는다.
credential 폴더의 현재 사용자 DACL을 상속하며 MSIX LocalAppData 가상화 경로는 실제 경로로 해석한다.
`session.json`에는 제목·시간·표시 transcript·OMP 파일 basename이 있고 `omp/`에는 모델의 JSONL이 있다.
JSONL에는 질문, 첨부 코드, 모델 응답과 도구 결과가 포함될 수 있으므로 credential과 함께 개인 데이터로 취급한다.
파일을 원격으로 전송하거나 commit하지 않는다. UI는 saved UUID만 받고 로컬 경로를 지정할 수 없다.

표시 기록은 200개/serialized JSON 256 KiB로 제한한다. 모델의 OMP 기록과 별개이며 화면 기록을
잘라도 모델 기록을 다시 작성하지 않는다. 64 MiB를 넘는 OMP JSONL은 재개하지 않는다.
저장소는 최대 1,000개 대화, 목록은 최근 50개다. 자동 삭제하지 않는다.
정상 종료한 Core/OMP가 모두 없음을 확인한 뒤 해당 세션 디렉터리를 백업하여 수동 관리한다.

2026-10-07 세션 복구 수정: 동시 재개는 Windows named pipe 소유권과 `active.lock`으로 거절한다.
잠금에는 Core PID, OMP PID와 시작 중 여부를 원자적으로 기록한다. 새 Core는 OS 잠금을 획득하고
이전 Core/OMP가 모두 종료됐음을 확인한 경우에만 남은 잠금을 복구한다. 복구 경쟁 중에도 한 연결만
세션을 열 수 있으며, 실제 사용 중인 세션은 계속 보호한다. PID 생존 확인 실패는 보수적으로 차단한다.
이전 버전의 빈 잠금, 손상·링크된 잠금, OMP 생성 중 강제 종료로 소유 정보가 불완전한 잠금은
자동 제거하지 않는다. 이 경우 관련 Core/OMP 종료 여부를 확인하고 세션 폴더를 백업·검사한 뒤
잠금을 수동으로 제거한다. 손상된 JSONL을 자동 고치거나 중단된 프롬프트를 자동 재전송하지 않는다.
설정 읽기·프로세스 생성 실패와 시작 중 연결 종료도 시작 작업의 정리를 기다린 뒤 잠금을 해제한다.
승인 대기 중 연결 종료는 제안을 취소한다. 재개 시 이전 approval을 다시 실행하지 않는다.
파일 checkpoint는 workspace Git에 별도로 보관된다. 복원 후 새 대화를 시작하는 것을 권장한다.

입력창 아래 컨텍스트 원형 표시를 누르면 사용량 패널이 열린다. 연결과 턴 완료 후에도 자동 갱신한다.
OMP get_session_stats가 반환한 현재 세션 토큰·USD 비용을 원본 패널에 표시한다(premium requests 값은 API에서 제공한다).
계정 한도는 별도 `omp usage --json --provider` 결과이며 60초 동안 캐시한다. 조회는 30초 이내로 제한된다.
토큰이 없거나 조회가 실패하면 정보 없음으로 표시한다. 누락된 값을 0으로 만들지 않는다.
USD 비용은 OMP가 보고한 세션 비용이며 구독 요금이나 실제 청구액 추정이 아니다.

OMP switch_session/new_session/get_state/get_session_stats와 usage 방식은 RADAgent의 RpcClient,
ChatSession, ChatUsage 및 ChatUsageParse 구현을 참고했다. 기존 RADAgent 저장소는 변경하지 않았다.
