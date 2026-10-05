# PiAgent 0.9.14 설치본 실사용 검증

검증일: 2026-10-05. Windows ARM64, VS2026, RAD Studio 13.2 **64-bit**, native OMP 18.6.1.

## 판정

**전체 실사용 승인 보류.** 핵심 채팅·승인·파일 복원·메시지 분기·VCL/FMX 조회는 동작한다. 아래 결함과 실사용 미검증 항목이 있으므로 모든 기능 통과로 해석하면 안 된다. VS2022와 RAD32는 사용자 지정에 따라 이번 범위에서 제외했다. 과거 버전의 실사용 결과를 이번 버전의 PASS로 승계하지 않았다.

사용자 NanumPDF와 reference RADAgent 소스를 변경하지 않았다. 변경 승인 테스트는 `artifacts/live-acceptance-0.9.14/vs`의 Git 추적 파일만 대상으로 했다. RAD VCL/FMX는 별도 생성 프로젝트로 조회했다.

## 실행한 검증과 증거

증거 기준 경로: `D:/source/PiAgent/artifacts/live-acceptance-0.9.14/evidence/`.

| 검증 층 | 결과 | 증거 / 한계 |
|---|---|---|
| 현재 working tree 자동 회귀 | 105/105 PASS | `regression.log`; 설치 IDE 조작과 구분 |
| 설치 VSIX UI, 실제 WebView2 | PASS 출력 54개 | `installed-vsix-webview.log`; mock host bridge 사용 |
| 설치 RAD UI, 실제 WebView2 | PASS 출력 54개 | `installed-rad-webview.log`; mock host bridge 사용 |
| 설치 Core + 실제 native OMP | 25/25 PASS | `installed-native-compact.json`; 별도 test adapter와 격리 workspace |
| 실제 VS2026 화면 | 아래 행별 판정 | 번호가 붙은 `vs-*.txt` UI 상태 기록 |
| 실제 RAD13.2 64-bit 화면 | 아래 행별 판정 | 번호가 붙은 `rad-*.txt` UI 상태 기록 |

Core probe는 repository daemon을 새로 띄우지 않고 설치된 `piagent-dev` pipe에 인증하여 연결했다. 인증 토큰, 공급자 credential, native RPC의 원시 오류 프레임은 증거에 저장하지 않았다.

실제 설치 release: `%LOCALAPPDATA%/Programs/PiAgent/releases/0.9.14-20261005010910`. VSIX manifest/설정 footer 0.9.14, RAD 로드 BPL 서명 확인은 기존 `artifacts/deployment-0.9.14` 증거도 참조한다.

## 기능별 결과

LIVE = 실제 IDE + 설치 Core + native OMP. PROTOCOL = 설치 Core + 별도 test adapter + native OMP. HARNESS = 실제 설치 UI + mock host. PARTIAL은 전체 성공 판정이 아니다.

| 기능 | 판정 | 실제 관찰 / 남은 조건 |
|---|---|---|
| 인증 연결, handshake, capability, ping | LIVE / PROTOCOL PASS | 두 IDE 연결됨. 실제 pipe probe 성공 |
| 프로젝트 인식 VS | LIVE PASS | NanumPDF에서 별도 acceptance 솔루션으로 자동 변경 |
| 프로젝트 인식 RAD 최초 연결 | LIVE PASS | VCL root로 연결 |
| RAD VCL→FMX 전환 | UX FAIL / 보호 PASS | 즉시 갱신 안 됨. 새 세션도 이전 root. 첫 prompt는 차단·초안 보존·재연결, 두 번째 전송 성공 |
| 실제 모델 채팅 | LIVE PASS | VS 17+25 → 42, RAD 디자이너 응답 완료 |
| Markdown·도구·추론 표시 | LIVE + HARNESS PASS | 디자이너 도구 상세와 최종 구성 응답 표시 |
| BTW 명령·버튼·후속 질문 화면 | VS LIVE PASS | `/btw` 응답 42, 버튼 목록·기록, 메인 답변 유지. 삭제 실사용 미실행 |
| + 메뉴, 프로젝트 빌드 | VS LIVE PASS | 메뉴 열림, 실제 빌드 1 성공 / 0 실패 |
| + 파일·폴더 첨부, @, 선택 코드 | HARNESS / PARTIAL | 실제 IDE 파일 picker·폴더 추가·선택 캡처까지 이번 버전에서 미검증 |
| MCP·플러그인·확장 관리 | HARNESS / PARTIAL | bridge 렌더링 검증; 실제 설치·토글의 외부 효과 미검증 |
| 설정 표시 / 버전 / 개발자 | 양 IDE LIVE PASS | 수평 5개 탭·footer·버튼 정상; RAD 동일 값 저장하고 닫기 성공 |
| 계정 제공자 상태 | VS LIVE PASS | 상태 조회 후 탭과 footer 유지 |
| OAuth/device 로그인 | HARNESS / MANUAL | 기존 인증 상태로 실제 모델 호출 성공. 로그아웃·재로그인 자동 조작 안 함 |
| 역할·effort·모델 목록 | VS LIVE 조회 + PROTOCOL PASS | 역할 15, 모델 목록, 프로젝트 slow 저장·stale revision 거부·원값 복원 |
| 역할 프리셋 저장·적용·삭제 | HARNESS / PARTIAL | 실제 IDE 전체 lifecycle과 global 설정 변경 미검증 |
| 접근 모드 | HARNESS / MANUAL | 항상 묻기에서 실제 승인. 다른 보안 모드 UI 변경 자동 조작 안 함 |
| Fast·auto-compaction·auto-retry·cache·steering·follow-up·interrupt | PROTOCOL PASS / PARTIAL | 실제 native setter 응답과 상태 조회; 공급자별 Fast 효과·실제 retry 발생·큐 동작까지는 미검증 |
| 압축 | PROTOCOL PASS, 오류 안내 FAIL | 충분한 별도 synthetic 기록에서 실제 완료, busy prompt 거부. 짧은 세션은 generic 오류만 표시 |
| 하위 에이전트 | HARNESS + PROTOCOL / PARTIAL | 실제 빈 목록 조회; 활성 child의 지시·로그·중단 lifecycle 미검증 |
| Advisor·Memory·Prewalk boolean schema | PROTOCOL 조회 PASS / PARTIAL | 지원 값 읽기만 검증. 실제 메모리 backend·advisor 효과 미검증 |
| 새 세션 / 목록 / 저장·재개 | VS LIVE + PROTOCOL PASS | 원본 ALPHA/BETA 세션, restored, branch 별도 목록. native process 재개 transcript 확인 |
| 메시지 복원 | VS LIVE PASS | 승인 후 메시지 1 직전의 별도 세션, 원문 초안 반환, 자동 전송 없음. 원본 재개 시 ALPHA·BETA 보존 |
| 메시지 분기 | VS LIVE PASS / 안내 UX FAIL | branch 항목 별도 저장. 미리보기·결과 문구는 복원과 같은 영어 문구 |
| 다중 파일 승인·적용·복원 | VS LIVE PASS | Form1.Designer.cs 제목 + Form1.cs 주석 변경, 2파일 card 승인, checkpoint 복원. 두 파일 Git diff 비어 있음 |
| dirty buffer / 만료 / stale 변경 / 범위 밖 거부 | 회귀 PASS / PARTIAL | 이번 설치 IDE에서 모든 부정 사례 직접 재현하지 않음 |
| 사용량·비용 | PROTOCOL PASS / HARNESS | native usage 확인; provider 한도 실제 UI 전체 확인 미완료 |
| HTML export / copy / 파일 링크 | HARNESS / PARTIAL | 실제 IDE export 파일 저장·열기와 링크 이동 미검증 |
| 폼 디자이너 VCL | RAD LIVE 조회 PASS | EditorForm, TMainMenu/File/New/Open/Save, TPanel alTop, TMemo alClient, TStatusBar alBottom |
| 폼 디자이너 FMX | RAD LIVE 조회 PASS | TMainMenu, TopLayout Align=Top, DocumentMemo Align=Client, framework별 지원 작업 설명 |
| 폼 디자이너 속성 변경·참조·reparent | PARTIAL | 조회 성공과 지원 목록만 확인. 실제 변경·저장·복원 전 과정 이번 버전 미검증 |
| WinForms / WPF / WinUI 디자이너 | PARTIAL | WinForms fixture 빌드 성공; IDE 디자이너 host 작업은 이번 버전 미검증 |
| docking/tab/hide, 100/150/200% 설정 | HARNESS PASS | 설치 UI로 12번 전환, DOM·한글 초안 유지. 모든 실제 IDE docking 조합은 별도 필요 |
| Goal / full session tree·handoff / worktree / SSH·background 관리 / custom extension UI | N/A 미구현 | `OMP-FEATURE-IMPLEMENTATION.md`에 기재된 기존 미구현 범위; PASS 아님 |

## 발견한 문제와 수정 방향

1. **RAD 프로젝트 변경 감지 지연 (우선순위 높음)**: `PiAgent.ChatForm.pas`는 prompt일 때만 CurrentWorkspace/FWorkspace 차이를 검사한다. IDE project notifier 또는 idle workspace 감지로 즉시 재바인딩하고 전환 중 프로젝트 의존 버튼을 막아야 한다. 현재 prompt 보호는 정상이다. VCL→FMX 전환 후 첫 전송 거부를 `rad-fmx-first-send.txt`, 재연결을 `rad-fmx-reconnected.txt`에서 확인한다.
2. **압축 사유 손실**: `packages/piagent-omp/src/index.ts`의 generic RPC 오류 처리. 짧은 세션에 대한 native 이유는 `session-too-small`로 확인했다 (`compaction-diagnosis.json`). 원시 오류 전체를 노출하지 말고 안전한 알려진 사유를 allowlist로 번역한다. [OMP 원본 처리](https://github.com/can1357/oh-my-pi/blob/v18.6.1/packages/coding-agent/src/session/agent-session.ts).
3. **Core 버전 불일치**: `packages/piagent-protocol/src/index.ts` CORE_VERSION이 0.9.0. 설정·manifest는 0.9.14. 빌드 버전 단일 소스에서 handshake/설정/패키지 생성 필요.
4. **분기·복원 안내 동일 / 영어**: branch는 별도 세션으로 정상 생성되지만 승인·결과 문구는 Restored before message로 동일하다. 사용자 선택과 실제 결과에 맞게 branch/restore 설명을 분리·현지화한다.
5. **변경 검토 노이즈 (추가 원인 확인 필요)**: 두 줄의 의도 변경이 CRLF→LF 변환을 포함해 전체 파일 diff로 표시됨. 실제 변경과 EOL 변경을 구분해야 한다. 파일 변경 기록에 proposal/turn observer가 같은 batch를 중복 표시하는 것으로 관찰되어 ID/내용 관계를 추가 분석해야 한다. 둘 모두 복원 데이터 손상으로 확인된 것은 아니다.
6. **설정 위 새 메시지 버튼 겹침 (추가 재현 필요)**: VS 설정 화면 일부 상태에서 floating 새 메시지 버튼이 남아 보임. sheet 표시 시 chat overlay와 focus를 함께 정리하는 회귀 필요.

## 재현 명령

```powershell
npm test
node scripts/verify-installed-native.mjs artifacts/live-acceptance-0.9.14/fresh-probe artifacts/live-acceptance-0.9.14/evidence/fresh-probe.json --compact-fixture
```

probe는 **새 격리 test workspace**에만 실행한다. `--compact-fixture`는 그 workspace의 `.omp/config.yml`을 쓰므로 사용자 프로젝트/기존 설정 경로에 사용하지 않는다. role 저장은 프로젝트 scope이며 테스트 후 원값 복원한다.

초기 `installed-native.json`의 role FAIL은 반환 필드에 대한 검증 스크립트 오류였으며 수정 후 retest 통과했다. 초기·retest 압축 FAIL은 너무 짧은 세션으로 OMP가 거부한 결과다. 기록을 충분히 만든 최종 fixture의 25/25 결과와 구분해 원본 증거를 보존했다.

## 잔여 검증과 자동화 경계

현재 문서는 **전수 기능 목록 점검 및 실행한 검증 결과**이며, 위 PARTIAL/MANUAL 항목 때문에 실사용 전수 완료 인증서가 아니다. 수정 후 각 IDE에서 폼 변경·저장·복원, 첨부/선택/export, 활성 subagent와 retry/queue, dirty-buffer 부정 사례를 이어서 실제 검증해야 한다.

computer-use의 `SKILL.md`가 요구하는 guidance는 "Do not automate user authentication dialogs." 및 "Do not change ... any in-app security or privacy settings."를 명시한다. 따라서 재로그인과 접근 보안 모드 UI는 수동 검증 항목이다. confirmations는 "Delete data (cloud and local)"에 별도 확인을 요구하므로 기존 사용자 BTW/프리셋 삭제는 자동 실행하지 않았다. mock harness의 로그인/삭제/보안 선택 성공을 실제 인증 또는 보안 동작 성공으로 승격하지 않았다.

검증은 제품 소스 수정·재서명·재설치·커밋·푸시·릴리즈를 수행하지 않았다. 이번 추가물은 설치 Core 재현 probe, 압축 진단 스크립트, 이 검증 문서와 evidence이다.

## 후속 결함 수정 (2026-10-05)

위 문서는 수정 전 설치본의 검증 기록이다. 후속 요청에 따라 6개 결함의 소스 수정, ARM64 Core 검증, VSIX/RAD Win64 빌드·코드 서명을 완료했다. 자동 회귀 111/111, Delphi worker 통합 1/1, 실제 WebView2 PASS 출력 58개를 확인했다. 사용자 IDE 종료 후 설치본을 교체했고, 실제 RAD 양방향 VCL/FMX 자동 재연결과 첫 전송, 두 IDE 설정 화면, 실행 중인 새 Core 버전·압축 실패 한국어 사유를 확인했다. 추가로 발견한 채팅 `/compact` 경로도 보완하여 112/112 회귀가 통과했다. USB 인증서 재연결 후 재서명·최종 설치를 완료하고 두 IDE의 실제 `/compact` 한국어 안내와 입력 복구를 확인했다. 최종 release는 `0.9.14-acceptance-20261005051004`이다. 수정 전 FAIL/PARTIAL 기록은 그대로 보존한다. 변경 내용과 설치 상태는 [결함 수정 기록](ACCEPTANCE-FIXES-0.9.14.md)을 참고한다.
