# 세션 저장·재개와 사용량 (0.7.0)

Secure Core를 --omp로 실행하고 VS/RAD Chat에서 연결하면 새 대화가 자동 저장된다.
저장된 대화 → 항목 선택 → 재개를 누른다. 진행 중인 응답이나 승인 검토를 먼저 끝낸다.
새 대화는 기존 저장본을 보존하고 별도 세션을 만든다. IDE가 정상 종료하거나 연결이 끊기면
Core가 OMP를 종료한 뒤 transcript를 저장하고 lease lock을 해제한다.

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

동시 재개는 `active.lock`으로 거절한다. 강제 종료 후 lock이 남으면 모든 관련 Core/OMP 종료 여부를
확인하고 전체 세션 폴더를 백업·검사한 뒤 lock을 수동으로 제거한다. 손상된 JSONL을 자동 고치지 않는다.
승인 대기 중 연결 종료는 제안을 취소한다. 재개 시 이전 approval을 다시 실행하지 않는다.
파일 checkpoint는 workspace Git에 별도로 보관된다. 복원 후 새 대화를 시작하는 것을 권장한다.

사용량 · 비용을 펼치거나 사용량 새로고침을 누른다. 연결과 턴 완료 후에도 자동 갱신한다.
OMP get_session_stats가 반환한 현재 세션 토큰·USD 비용·premium requests를 표시한다.
계정 한도는 별도 `omp usage --json --provider` 결과이며 60초 동안 캐시한다. 조회는 30초 이내로 제한된다.
토큰이 없거나 조회가 실패하면 정보 없음으로 표시한다. 누락된 값을 0으로 만들지 않는다.
USD 비용은 OMP가 보고한 세션 비용이며 구독 요금이나 실제 청구액 추정이 아니다.

OMP switch_session/new_session/get_state/get_session_stats와 usage 방식은 RADAgent의 RpcClient,
ChatSession, ChatUsage 및 ChatUsageParse 구현을 참고했다. 기존 RADAgent 저장소는 변경하지 않았다.
