# VS2026 Core 연결 끊김 수정

검증일: 2026-10-05. Windows ARM64, PiAgent 0.9.14, VS2026.

## 원인과 재현

VS의 PiAgent 화면에서 `Core disconnected during frame`을 확인했다. IDE와 Core
프로세스는 살아 있었으므로 이 메시지를 Core 프로세스 충돌로 해석하면 안 된다.
`PipeAdapterClient.ReadExactAsync`는 frame 사이 EOF에도 같은 문구를 표시한다.

설치된 Core는 마지막 IDE 요청으로부터 30초가 지나면, 정상 인증·handshake를
마친 연결까지 `Pipe read/idle deadline exceeded`로 닫고 연결 소유의 OMP를
정리하는 결함이 있었다. VS의 20초 heartbeat는 `DispatcherTimer`로 동작하고
UI 스레드에서 workspace 동기화 후 ping하므로 UI 작업 지연에 영향을 받는다.

실제 설치된 `piagent-dev`에서 인증·handshake 후 32초 동안 아무 요청도 보내지
않았을 때 후속 ping이 `Pipe disconnected`로 실패했다. 사용자가 겪은 시점의
Core stderr는 저장되어 있지 않아 당시 닫힘 이유를 로그로 소급 확정할 수는
없지만, 정상 사용 중 동일한 연결 끊김을 만드는 위 결함은 설치본에서 재현했다.

## 수정

`packages/piagent-daemon/src/index.ts`에서 정상 handshake를 마친 연결의
frame 사이 idle timeout을 제거했다. heartbeat는 상태 확인용이며 연결 유지의
필수 조건이 아니다. OMP가 조용히 실행 중이거나 IDE가 빌드·디자이너 작업 중이어도
무요청 시간 때문에 대화를 취소하지 않는다.

다음 제한은 유지한다.

- 인증·handshake의 절대 제한 10초와 초기 읽기 제한.
- 부분 header/body의 frame 읽기 제한 30초. 조금씩 bytes를 보내도 연장하지 않는다.
- frame 크기, 출력 대기열, in-flight 요청 수와 write deadline.
- 실제 EOF·잘못된 frame·명시적 연결 종료 시 정리.

새 회귀 테스트는 인증된 연결의 idle·silent active turn 생존과 idle 후 부분 frame
전송·미완성 frame timeout·다른 연결의 정상 동작을 확인한다. 기존 코드에서는
첫 테스트가 `Pipe disconnected`로 실패했고, 수정 후 전체 114개가 통과했다.

## 설치와 검증

Core만 별도 release로 교체했다. VS2026를 종료하거나 사용자 NanumPDF 소스를
수정하지 않았다. 기존 서명된 VSIX/BPL/pipe host, ARM64 Node 24.21.0,
OMP 18.6.1, 로그인 정보, 영속 대화 저장소를 유지했다. 이전 release와 설치 기록은
복구용으로 보존했다. 새로운 통합 설치파일 또는 GitHub 릴리즈를 만들지는 않았다.

현재 Core:
`%LOCALAPPDATA%\Programs\PiAgent\releases\0.9.14-idle-fix-20261005081410`.
제품 버전은 호환되는 private hotfix로 0.9.14를 유지한다.

- TypeScript strict build 통과.
- 전체 자동 회귀 테스트 114/114 통과, skip/fail 없음.
- 설치된 ARM64 Node에서 인증·capability·ping 검증 통과.
- 수정 설치본에서 동일한 32초 무요청 후 ping 성공.
- 실행 중인 VS2026에서 재연결 완료, NanumPDF workspace 바인딩 확인.
- 가장 최근의 기존 저장 대화를 다시 열어 작업 목록·선택 모델과 연결 상태 확인.
  중단된 모델 실행이나 사용자 프롬프트를 자동 재전송하지 않았다.

증거는 `artifacts/idle-disconnect-before.json`과
`artifacts/idle-disconnect-fix/`의 `regression.log`, `installed-idle-after.json`,
`deployment.json`, `vs-resumed.txt`, `vs-resumed.png`,
`20261005081410/runtime.log`, `live-handshake.log`, `core.err.log`에 있다.
32초 무요청 검증은 heartbeat를 보내지 않는 별도 실제 pipe 연결로 실행했다.
VS의 실제 빌드 중 UI 스레드 지연 상황 자체를 다시 만들지는 않았다.
