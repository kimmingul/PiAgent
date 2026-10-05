# PiAgent 0.9.11 계정 상태 탐색 수정

로그인 제공자 조회 결과가 설정 전체 sheet를 교체하던 문제를 수정했다.
결과와 조회 오류를 계정 탭 안에 표시하며, 다섯 설정 탭과 저장/취소 버튼을 유지한다.
조회 중 다른 탭으로 이동해도 선택한 탭과 저장 전 설정값을 보존한다.
설정을 닫은 뒤 도착한 응답은 화면을 다시 열지 않는다.

Core 제어 결과를 전용 settings callback으로 전달한다. 기존 OMP 통신 및 인증 방식은 유지한다.
실제 WebView2에서 지연 응답, 탭 복귀, 미저장 값 보존, 100/150/200% 배율과 저장/취소를 검증했다.
검증 기록: artifacts/settings-account-preview/webview.log.
설정 스타일/버전/개발자 정보 수정은 0.9.10에서 이어진다.
실행 중인 IDE 설치본은 자동 교체하지 않는다.

계정 탭의 OMP 로그인 버튼과 채팅 /login, /LOGIN은 설정된 OMP의 login 터미널을 연다. 인증정보는 PiAgent UI로 전달하지 않으며, 로그인 완료 후 제공자 상태를 다시 조회한다.

최종 검증: 테스트 93/93 통과. 서명/타임스탬프/체크섬/포함 파일 해시 및 ARM64/x64 런타임 handshake 검증 통과. 서명 설치파일에서 추출한 UI의 WebView2 계정 탐색/로그인 실행 요청/저장·취소/배율/12회 창 전환 검증 통과. 실제 OMP login 터미널 실행 요청도 성공했으며, 사용자 인증 완료 여부는 검증하지 않았다. 기록: artifacts/settings-account-0.9.11-verification.json, artifacts/settings-account-preview/packaged-webview.log.
