# 프로젝트의 로컬 Git 관리와 마지막 세션 재개

0.9.15 개발본, 2026-10-06 KST. 설치된 PC runtime에는 아직 반영하지 않았다.

## Git 안내

프로젝트 연결 시 Core가 Git 상태를 확인한다. Git이 없거나 HEAD가 없는 저장소에서도
native 채팅 연결을 유지하며 파일 checkpoint 미지원 안내를 표시한다. 상위 저장소는
기존 관리 상태를 유지하고 중첩 init을 제안하지 않는다. Git worktree/연결된 .git은
현재 standalone checkpoint 대상이 아니므로 별도 안내한다.

안내의 **로컬 Git 설정** 또는 **설정 → 고급 → 로컬 Git 관리**에서 미리보기를 연다.
포함 파일, 제외 후보 및 기존/변경 후 .gitignore를 확인하고 작성자 이름·이메일을 입력한 뒤
**확인 · 초기화 및 첫 커밋**을 눌러야 변경이 실행된다. **나중에**로 안내를 숨길 수 있다.

- 기존 .gitignore를 보존하며 VS/RAD/Node 빌드·캐시·인증 파일 제외 규칙을 추가한다.
- 첫 커밋은 표시된 파일과 .gitignore만 포함한다. 링크·큰 파일·비밀정보 의심 후보는 제외한다.
  탐지는 완전하지 않으므로 사용자 검토가 필요하다. 이미 staged 파일이 있으면 자동 처리를 거부한다.
- 미리보기 후 파일이 바뀌면 재검토를 요구한다. preview ID는 해당 연결/작업영역 소유다.
- Git이 없는 프로젝트는 main 브랜치로 초기화한다. 기존 unborn 저장소의 브랜치는 보존한다.
- 작성자는 해당 커밋에만 지정한다. 전역 설정 변경, remote 등록, GitHub 연결·push는 하지 않는다.
- Git hooks/fsmonitor/서명 실행을 비활성화한 격리된 Git 명령을 사용한다. 사용자 custom filters가
  설정된 unborn 저장소는 수동 처리를 요구한다.
- 첫 커밋 후 현재 연결의 checkpoint를 활성화한다. 이후 agent 턴 checkpoint와 일반 사용자
  커밋은 별개이며, checkpoint의 기존 추적 UTF-8 파일 범위 제한은 유지된다.

## 대화 재개

VS/RAD 최초 연결 및 프로젝트 전환은 `chat.open {resumeLast:true, workspaceUri}`를 사용한다.
Core는 workspace별 비공개 SessionStore에서 마지막으로 성공적으로 연 세션을 기억한다.
새 대화 버튼은 이 옵션을 보내지 않으므로 새 세션을 만든다. 저장 세션을 직접 선택하면
그 세션이 다음 연결의 마지막 대화가 된다.

기존 버전으로 생성되어 마지막 포인터가 없으면 최신 resumable 저장 세션을 사용한다.
대화 재개는 transcript와 OMP 저장 파일을 열며 이전 prompt/도구를 자동으로 재실행하지 않는다.
다른 연결이 소유한 세션이나 손상된 포인터는 오류로 안내하며 임의의 새 세션으로 숨기지 않는다.
중단된 active.lock의 임의 삭제나 인증정보 조작은 하지 않는다.

이번 구현에서 사용자 NanumPDF 프로젝트를 init/commit하거나 현재 IDE 세션을 변경하지 않았다.
검증용 임시 프로젝트만 사용했다.

검증: strict 빌드, 전체 자동 회귀 128/128, 재빌드 adapter 통합 15/15, WebView2 smoke 66개 통과.
후속 링크/파일 검사 보강 후 Git bootstrap 및 자동 재개 5개 테스트도 재실행해 통과했다.
