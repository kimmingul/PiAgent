# PiAgent 0.9.12 계정 로그인 UI

계정 탭에서 OMP 제공자 목록과 로그인 상태를 보여주고 제공자별 로그인/다시 로그인 버튼을 제공한다.
/login 및 /LOGIN은 계정 탭을 연다. 일반 로그인 동작은 터미널을 띄우지 않는다.
인증 URL, 장치 코드 안내 및 OAuth 코드/반환 URL 입력 요청은 계정 탭 안에서 표시한다.
공식 인증 페이지는 사용자가 인증 페이지 열기 버튼을 눌러 기본 브라우저에서 연다.

로그인은 대화와 분리된 일회성 OMP rpc-ui 프로세스에서 실행한다. 로그인 시작 RPC는 즉시 반환하고
요청/결과는 기존 이벤트 통로를 이용하므로 RAD worker의 직렬 요청 처리와 충돌하지 않는다.
취소는 인증 프로세스만 종료한다. ID는 로그인별 UUID namespace로 분리하며 만료된 입력을 거부한다.
코드 입력과 인증 URL은 대화/session 기록에 저장하지 않는다. 완료/취소 시 인증 입력과 링크를 제거한다.
완료 시 제공자 상태와 사용 가능한 모델/현재 상태를 다시 조회한다.
OMP가 RPC에서 지원하지 않는 비밀 입력 제공자는 터미널 인증이 필요하다는 메시지를 표시한다.

검증: 프로세스 fixture 성공/취소/실패/중복/만료 입력, Controller routing,
WebView2 계정 내 코드 입력/제출/완료/탭 유지/100·150·200% 배율 및 기존 docking regression.
설치된 OMP 18.6.1의 실제 openai-codex 인증 URL 발생과 취소까지 검증했다.
실제 사용자 계정의 인증 완료는 수행하지 않았다.
로그: artifacts/account-oauth-real-omp.log, artifacts/account-oauth-preview/webview.log.

최종 테스트 97/97 통과. 서명 설치파일의 인증서·타임스탬프·SHA256·포함 파일 해시 및 ARM64/x64 런타임 실행 검증 통과. 추출한 실제 포함 UI의 WebView2 검증 통과(설정 탭 유지, 인증 코드 제출, 완료 후 입력 제거, 기존 저장/취소, 배율 및 docking). 계정 화면 PNG를 직접 확인했다. 실제 설치된 IDE에서 사용자 OAuth 인증 완료는 수행하지 않았다. 검증 기록: artifacts/account-oauth-0.9.12-verification.json, artifacts/account-oauth-installer-tests.log, artifacts/account-oauth-preview/packaged-webview.log.
