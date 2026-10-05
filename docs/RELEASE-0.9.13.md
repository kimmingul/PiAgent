# PiAgent 0.9.13 OMP 역할 및 effort 설정

OMP v18.6.1의 공식 config/model-roles.ts 역할 정의를 기준으로 기본 역할과 모델 종류를 제공한다.
실행된 OMP config get modelRoles/modelTags/cycleOrder에서 사용자 정의 역할과 현재 값을 읽는다.
모델 및 effort 선택은 omp models --json --kind all 출력의 selector/kind/thinking 값을 사용한다.
추론 effort를 임의로 추가하지 않으며 미설정은 OMP 기본값을 따른다.

모델 역할 탭에서 역할별 모델/effort 또는 역할 별칭을 선택하고 전용 저장/변경 취소를 사용한다.
저장은 omp config set modelRoles JSON --json을 통해 OMP 전역 config.yml에 반영한다.
기존 전역값과 다른 설정은 보존한다. 프로젝트·환경변수는 전역보다 우선할 수 있다.
저장 전 revision으로 외부 변경을 검사하고 지원하지 않는 모델 종류/effort 및 alias cycle을 거부한다.
현재 대화 모델 선택과 분리되며 새 대화에서 저장한 역할을 적용한다.
상단 PiAgent 설정 적용 버튼은 표시/접근 설정용이고 역할 설정 저장은 OMP 설정용이다.

실제 설치 OMP 18.6.1에서 역할 15개/모델 160개/effort 제공 모델 95개 조회를 검증했다.
실제 사용자 전역 설정은 검증을 위해 변경하지 않았다. 저장/보존/거부 검증은 별도 fixture에서 수행했다.
공식 기준: https://github.com/can1357/oh-my-pi/blob/v18.6.1/packages/coding-agent/src/config/model-roles.ts
새 OMP에서 기본 역할 규칙이 바뀌면 기준 정의를 업데이트해야 한다. 사용자 정의 역할은 동적 조회한다.

최종 테스트 98/98 통과. WebView2에서 실제 포함 UI의 역할 effort 선택·저장 요청·오류 및 설정 탭 유지 검증 통과. unsigned preview의 포함 파일/SHA256/ARM64·x64 실행 검증 통과. USB 인증서가 Cert CurrentUser My에서 발견되지 않아 서명 빌드는 중단됐다. dist/PiAgent-Setup-0.9.13-unsigned-preview.exe는 검증용이며 서명 배포본이 아니다. 현재 IDE 설치본은 교체하지 않았다.
