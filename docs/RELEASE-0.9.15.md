# PiAgent 0.9.15 — Provider 재시도 턴 유지

2026-10-06 KST 수정본. GitHub 공개 사전 릴리즈는 아직 0.9.14다.

Native OMP의 assistant `message_end(error)` 뒤 자동 재시도가 이어질 때 PiAgent가 턴을
조기 종료하던 결함을 수정했다. 개별 provider 오류를 보관하고 최종 `session_settled` /
`prompt_result`에서 완료·실패를 판정한다. 재시도 성공 후 도구·최종 답변·저장 transcript를
처리하고 소진 시 최종 provider 오류를 표시한다. 재시도 중 새 prompt를 거부하고 취소는 유지한다.
실제 프로세스 종료와 restricted 모드 오류는 기존 종료 계약을 유지한다.

로컬 Git 미관리/첫 커밋 없는 프로젝트에 초기화 안내와 미리보기·사용자 확인 첫 커밋을 추가했다.
프로젝트 재연결은 마지막 선택 대화를 재개하며 새 대화 버튼은 명시적으로 새 세션을 만든다.
[동작과 제한](LOCAL-GIT-AND-RESUME.md).

대화 목록에서 사용하지 않는 빈 세션을 확인 후 삭제할 수 있다. 사용 중인 세션과
화면/OMP/BTW 대화 기록·계획·분기·복원 데이터가 있는 세션은 Core에서 삭제를 거부한다.
삭제 성공 후 목록을 갱신하고 자동 재개는 삭제된 세션을 건너뛴다.

채팅 상단 작업목록에 접기/펼치기를 추가했다. 제목 줄을 클릭하거나 키보드로 선택해
Enter/Space를 누르면 목록을 접을 수 있고, 완료 개수는 한 줄에 남는다. 접힌 상태에서도
진행률 갱신을 유지하고 WebView 저장소가 허용되면 선택을 기억한다. 펼친 목록은 내부 스크롤로
높이를 제한한다. 공용 WebView UI 변경이므로 VS/RAD 모두 같은 동작을 사용한다.

TypeScript strict 빌드와 전체 회귀 134/134 통과. 새 테스트는 실제 OMP child fixture를 통해
재시도 성공/소진, 취소, crash, restricted 오류, 중복 완료 방지, 저장 transcript 및 다음 prompt를 검증했다.
0.9.15 adapter를 서명 없이 검증용으로 재빌드한 뒤 C#/Delphi Named Pipe 통합 15/15도 통과했다.
이 검증용 adapter는 PC의 IDE에 설치하지 않았다.
Git bootstrap/자동 재개 테스트 5개, 빈 세션 삭제·보호·RPC·패키징 테스트 6개와
실제 RAD 패키지 UI를 사용한 WebView2 smoke 67개 검증을 통과했다.
공용 UI가 import하는 Git 모듈을 VSIX/RAD 패키지에 포함하도록 누락도 수정했다.
Git 없는 workspace의 Named Pipe 연결과 확인 후 checkpoint 활성화도 포함한다.

2026-10-06 사용자 요청에 따라 미서명 설치본 `dist/PiAgent-Setup-0.9.15-unsigned-preview.exe`를
이 ARM64 PC에 설치했다. [설치·연결 검증](LOCAL-PREVIEW-0.9.15.md).
서명 설치파일 `dist/PiAgent-Setup-0.9.15.exe`는 아직 준비하지 않았다.
이전 서명 시도는 USB 인증서가 Windows CurrentUser/My에 발견되지 않아 중단됐다.
DPAPI PIN 등록 파일의 존재 여부만 확인했으며 PIN을 출력하거나 재입력하지 않았다.
서명 배포는 후속 작업으로 보류했다.
향후 인증서 재연결 후 서명 빌드 및 installer payload/runtime 검증을 완료해야 한다.
기존 대화는 보존했으며 사용자 프로젝트에는 수정하지 않았다.
과거 조기 종료로 이미 누락된 답변을 자동으로 재생하거나 GitHub 작업을 다시 실행하지 않는다.

[진단 근거](PROVIDER-RETRY-DIAGNOSIS-20261006.md) · [설치](INSTALLATION.md).
