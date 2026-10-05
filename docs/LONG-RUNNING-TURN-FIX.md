# 장시간 작업 강제 종료 수정

검증일: 2026-10-05. Windows ARM64, VS2026, native OMP 18.6.1.

현재 상태 갱신: 2026-10-06. 아래 private hotfix/acceptance release 경로는 순차 배포 이력이다.
현재 설치 receipt는 `0.9.14-20261005095258` release를 가리킨다.

## 설치본 실제 장시간 개발 관찰

사용자가 서명 통합 설치본을 설치한 뒤 VS2026에서 NanumPDF와 이전 저장 대화를 열었다.
2026-10-05 18:58:30 KST에 이어서 구현·빌드·검증하는 요청을 한 번 전송했고,
21:35:54 KST에 실제 UI 최종 응답 및 Core `completed` 이벤트를 확인했다.
경과 시간은 9,443,987ms(약 2시간 37분)다.

- Core sessionId: `5e517bf8-7ebf-4442-889f-a80d64567fcb`.
- turnId: `5a0c812f-b583-41ff-85e5-b4625118649f`.
- 주기 관찰에서 실행·도구·하위 에이전트 활동과 GUI smoke 실행을 구분했다.
  10분을 넘긴 후에도 작업이 유지됐으며 해당 턴의 연결 끊김/최종 실패는 관찰하지 않았다.
- 최종 화면에서 작업 목록 완료 표시, 최종 설명, 입력 가능 상태와 종료 시간을 확인했다.
  모니터링 자동화는 완료 확인 후 PAUSED로 변경했다.
- 중복 요청·중단·재시작이나 인증/접근 설정 변경 없이 관찰했다.
- NanumPDF의 최종 안내는 도형·잉크·서명 등 일부 마우스 조작을 추가 확인하도록 권장했다.
  이 결과는 PiAgent 장시간 작업 완료의 근거이며 NanumPDF 또는 PiAgent 전체 기능의
  실사용 전수 PASS가 아니다. 단순 프로세스 생존이나 무응답을 성공 근거로 쓰지 않았다.

근거 로그: `%USERPROFILE%\.piagent\security\piagent-dev\lifecycle.jsonl`.
로그는 크기 제한으로 회전하므로 이 문서는 관찰 시점의 기록이며 영구 로그 보존을 보장하지 않는다.

## 확인한 원인

NanumPDF 대화에서 17:31:52에 시작한 작업이 17:41:52에 종료됐다.
`ChatSession.prompt()`는 진행 상황과 관계없이 600,000ms 뒤
`Turn deadline exceeded`를 발생시키고 OMP 세션을 닫았다. 도구와 하위
에이전트가 정상 실행 중이어도 정확히 10분에 종료되는 PiAgent 결함이다.
이전의 Named Pipe idle 30초 종료 문제는 `CORE-IDLE-DISCONNECT-FIX.md`에서
별도로 수정했으며 이번 설치본에도 유지한다.

## 변경 내용

- 턴 전체의 고정 시간 제한을 제거했다. 조용한 모델·도구·하위 에이전트 때문에
  자동 종료하지 않는다. 요청 ACK, 개별 도구·승인, 명시적 취소의 제한은 유지한다.
- 15초마다 실행·도구·하위 에이전트·승인/입력 대기·취소 상태와 경과 시간을
  `chat.event`의 `activity`로 보낸다. 2분간 새 진행 소식이 없는 경우 안내만 한다.
- 세션 종료 시 실제 오류 문구를 보존한다. UI는 오류를 대화에 남기며 OMP 세션
  종료를 Named Pipe 연결 끊김과 구분한다. 기존 RADAgent 레이아웃을 유지한다.
- 이전 OMP 프로세스의 늦은 이벤트가 새 세션에 들어가지 않도록 차단했다.
- Core 시작/완료/실패/종료 및 단계·경과 시간·마지막 진행 후 시간·도구 수를
  제한된 lifecycle 로그에 기록한다. 프롬프트, 인증 정보, 도구 인자는 기록하지 않는다.
  로그 I/O 실패가 대화를 중단시키지 않으며 파일은 약 1MiB씩 두 개로 회전한다.
- 재연결 후 저장 대화를 다시 열 수 있다. 중단된 프롬프트나 파일 변경 작업을
  자동 재전송하지 않는다.

## 검증 결과

- TypeScript strict build 통과.
- 전체 자동 회귀 118/118 통과, skip/fail 없음.
- 최종 오류 메시지 정리 이후 장시간 회귀 4/4 및 chat 회귀 9/9 재확인.
  ACK timeout, 비정상 OMP 종료, 응답 없는 취소의 제한 시간도 포함한다.
- 실제 631초 테스트 통과: 인증된 Named Pipe 두 연결에서 하나는 도구/하위 에이전트
  이벤트를 보내며 정상 완료했고, 다른 하나는 모델 출력을 전혀 보내지 않아도
  살아 있었다. heartbeat 요청 없이 실행했으며 이후 ping과 사용자 취소가 성공했다.
  이 테스트의 OMP는 결정적 fixture로, 실제 모델의 장시간 개발 완료를 의미하지 않는다.
- WebView2 UI smoke의 PASS 57개. 11분 상태 표시, 종료 사유 보존, JS/CSP 오류 없음,
  12회 도킹/탭/숨김 전환을 포함한다. host bridge는 테스트용이다.
- 설치된 ARM64 Node 24.21.0에서 인증·capability negotiation·ping 통과.
- 실행 중인 VS2026 재연결 후 NanumPDF 프로젝트와 저장 대화(작업 목록 3/12),
  선택 모델, 연결됨 상태를 확인했다. NanumPDF 개발 프롬프트는 재전송하지 않았다.

## 설치 상태와 남은 배포

Core는 다음 private hotfix로 설치하고 실행했다. 제품 버전은 0.9.14를 유지한다.

`%LOCALAPPDATA%\Programs\PiAgent\releases\0.9.14-long-running-20261005090454`

설치 파일 해시와 검증한 컴파일 결과가 일치한다. 기존 서명된 VSIX/BPL, pipe host,
ARM64 런타임, OMP 설정 및 저장 대화를 유지하고 이전 release와 receipt를 보존했다.
진행 중인 OMP가 없음을 확인한 뒤 Core만 교체했다.

후속 배포(2026-10-05 18:19 KST): USB 인증서 연결 후 VSIX 및 RAD32/64 BPL,
pipe host의 서명과 타임스탬프를 검증했다. PIN은 기존 Windows 암호화 저장소를
사용하여 재입력 없이 서명했다. VS2026를 정상 종료한 뒤 새 UI를 포함한 VSIX와
RAD13.2 64비트 BPL을 설치했다. VS2022 설치본은 교체하지 않았다.

당시 전체 설치 release:
`%LOCALAPPDATA%\Programs\PiAgent\releases\0.9.14-acceptance-20261005091856`.
새 경과 시간과 상세 종료 사유 표시도 이 설치본에 포함된다.
배포 증거는 `artifacts/installed-acceptance-20261005091856/deployment.json`,
서명 빌드 기록은 `artifacts/long-running-fix/build-signed-adapters.log`에 있다.

후속 검증: 설치된 VS2026 UI의 `controller.js` 및 RAD64 UI 파일 해시가 검증한
컴파일 결과와 일치한다. VS2026에서 NanumPDF 저장 대화(작업 목록 3/12)와 모델을
다시 열고 연결됨 상태를 확인했다. RAD13.2 64비트에서는 기존 FMX Acceptance
프로젝트를 열어 PiAgent 화면 렌더링과 프로젝트 바인딩·연결됨 상태를 확인했다.
이 후속 확인은 UI 로드/연결 검증이며 실제 모델 개발을 다시 실행한 것은 아니다.
기록: `vs-signed-ui.txt`, `rad64-signed-ui.txt`.

서명된 통합 설치파일: `dist/PiAgent-Setup-0.9.14.exe` (2026-10-05 18:21 KST).
설치파일의 서명/타임스탬프와 전체 내장 파일 해시 검증을 통과했다. 내장 Node
24.21.0의 ARM64 및 x64에서 인증 handshake/capability/ping이 성공했고,
설정 보존·변조 파일·경로 이탈·미설치 IDE 거부 테스트가 통과했다.
검증 로그: `artifacts/long-running-fix/verify-signed-installer.log`.
SHA256: `8abeaad9202a84549ca741e3bbc9a02f0f6b4a4182e2b348aaf591c799f5b3f6`.
GitHub 릴리즈 게시나 commit/push는 이 후속 배포에서 수행하지 않았다.

증거: `artifacts/long-running-fix/`의 `regression.log`, `targeted.log`,
`chat-final.log`, `long-run.log`, `webview.log`, `webview.err.log`,
`deployment.json`, `vs-resumed.txt` 및 `20261005090454/`의
`runtime.log`, `live-handshake.log`, `core.err.log`.

진단 로그: `%USERPROFILE%\.piagent\security\piagent-dev\lifecycle.jsonl`.
다른 인증 파일 경로를 지정한 경우 해당 파일의 부모 디렉터리에 기록한다.
