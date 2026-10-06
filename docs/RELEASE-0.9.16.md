# PiAgent 0.9.16 — 전송 준비 지연과 절전 복귀 연결 복구

2026-10-06. 서명 통합 설치본과 아래 검증을 완료한 사전 릴리즈다.

VS/RAD의 `chat.prompt` 준비 요청은 60초까지 기다린다. 기존 VS 5초 제한은 NanumPDF의
Git 스냅샷 준비(20.099초)보다 짧아 정상 요청도 연결을 끊었다. Git index를 한 번에 조회하도록
수정한 후 동일한 프로젝트·373개 포함/14개 제외 결과를 255ms에 얻었다. 파일 형식/충돌/링크/
용량 제한은 유지하며 복원 적용 시 현재 Git 추적 상태를 다시 검사한다.

VS adapter는 Windows Suspend 이벤트에서 RPC 시간 제한을 멈추고 Resume에서 재설정한다.
복귀 시 ping으로 연결을 확인하며 끊긴 경우 1/3/10초 간격으로 최대 세 번 같은 프로젝트의
마지막 대화 연결을 복구한다. 솔루션 변경·종료·adapter 종료는 복구를 중단한다.
메시지는 자동 재전송하지 않는다. 실패 진단에는 RPC 이름과 시간 제한을 표시하며 입력 내용은
기록하지 않는다. 실제 Windows 절전 전체 주기는 설치 후 수동 검증이 필요하다.

0.9.15 로컬 개발본의 provider 재시도, 작업목록 접기, 로컬 Git 초기화, 마지막 대화 자동 재개,
빈 세션 삭제와 공용 UI 패키징 수정도 포함한다. VS transport의 Git/빈 세션 삭제 요청 허용 목록
누락을 수정했다. 기존 데이터는 유지한다. [0.9.15 변경 사항](RELEASE-0.9.15.md).

TypeScript strict 빌드 및 회귀 135/135, C#/Delphi adapter 통합 17/17,
실제 패키지 WebView 67개가 통과했다. 380개 파일 snapshot의 Git 프로세스 호출 수와 내용,
비정상 index entry 제외, 6.5초 prompt ACK 뒤 연결 유지, 7초 대기 중 timeout 일시 정지를
검증했다. Windows 전체 절전 주기를 실제 OS에서 반복한 검증과는 구분한다.

설치파일: `dist/PiAgent-Setup-0.9.16.exe`. USB 인증서로 코드서명·타임스탬프를 검증한다.
이 PC의 기존 실행 중인 VS/NanumPDF에는 릴리즈 빌드만으로 자동 설치하지 않는다.

통합 setup, VSIX 및 내부 assembly, RAD Win32/Win64 BPL, PipeHost의 인증서 서명과
타임스탬프 검증을 통과했다. 내장 payload 전체 해시, ARM64/x64 Node 24.21.0 인증 연결·ping,
설치 프로그램 안전성 테스트를 통과했다. PIN은 기존 Windows 암호화 저장소를 통해 사용했다.

Setup SHA256: `05a9512c4310300ddcff357e1536e0c52478e2cf6ebb67a3e2a12f319feb97bc`.
설치 전 VS/RAD를 종료한다. 현재 PC의 설치본은 0.9.15 미서명 preview이므로
이번 수정의 실사용에는 새 설치본으로 업데이트해야 한다.
