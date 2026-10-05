# PiAgent 0.9.14 실사용 결함 수정

작성일: 2026-10-05. 대상: Windows ARM64, Visual Studio 2026, RAD Studio 13.2 64-bit.

`INSTALLED-ACCEPTANCE-0.9.14.md`에서 발견한 6개 결함을 수정했다. **서명한 수정본을 VS2026과 RAD13.2 64-bit에 설치하고 ARM64 Core도 교체했다.** 아래 후속 실사용 결과는 수정 전 검증 기록과 구분한다. 추가로 확인한 채팅 `/compact` 경로의 보완도 USB 재연결 후 재서명·설치하고 두 IDE의 실제 채팅에서 검증했다.

## 수정 내용

| 발견한 문제 | 구현한 변경 | 검증 |
|---|---|---|
| RAD 프로젝트 전환 후 이전 프로젝트에 연결됨 | IDE 스레드에서 500ms 간격으로 활성 프로젝트를 확인하여 자동 재연결. 프로젝트가 닫히면 연결 해제. 전환 중 기존 이벤트와 프로젝트 의존 작업을 차단하고 입력 초안을 보존 | 실제 Delphi Win64 worker와 Named Pipe Core로 승인 대기 중 프로젝트 전환, 새 root 연결, 해제·재연결 검증 |
| 짧은 세션 압축 거부 이유가 사라짐 | OMP의 알려진 `session too small` / `already compacted` 오류만 한국어로 안내. 그 외 원시 공급자 오류는 노출하지 않음 | 알려진 사유·알 수 없는 오류·비밀 문자열 비노출 회귀 |
| handshake Core 버전이 0.9.0으로 표시됨 | root package.json에서 빌드 시 버전 상수를 생성하고 handshake와 설정 정보에서 공유 | root 버전 일치, 패키지 Core의 인증 handshake 버전 확인 |
| 대화 분기·복원 안내가 같은 영어 문구 | 두 작업의 미리보기·완료 안내를 한국어로 구분. 원본 세션 보존과 초안 반환·자동 전송 없음 명시 | 분기·복원별 안내 회귀 |
| 전체 파일 diff와 checkpoint 중복 | 변경 줄 주변만 보여 주는 diff. BOM·줄바꿈·마지막 개행을 별도로 표시. 같은 turn의 정확히 일치하는 승인 journal은 observer가 재사용 | CRLF/BOM/EOF, 정확한 byte 복원, 추가 native 변경, 이전 turn과의 구분 검증 |
| 설정 화면에 새 메시지 버튼이 겹침 | sheet가 열린 동안 floating 새 메시지 버튼을 숨김. reference 채팅 CSS는 유지 | 실제 WebView2에서 설정 중 버튼 숨김 확인 |

diff는 검토용 표시이며 적용 가능한 patch를 의미하지 않는다. 적용·해시·복원은 기존의 원본 byte 데이터를 사용한다. 이미 저장된 과거 중복 checkpoint는 삭제하지 않으며, 새로 발생하는 동일 turn의 중복 생성을 방지한다.

## 검증 결과

증거 디렉터리: `artifacts/live-acceptance-0.9.14/evidence/`.

- `fixes-regression-final.log`: 자동 회귀 **111/111 PASS**, 실패·skip 없음.
- `fixes-rad-rebind.log`: 컴파일된 Delphi Win64 worker 통합 **1/1 PASS**. 실제 pipe와 격리 프로젝트 사용.
- `fixes-webview.log`: 실제 WebView2 **58개 PASS** 출력. mock host bridge를 사용하므로 설치 IDE 실사용 결과와 구분한다. 100/150/200% 설정 레이아웃, 12번 docking/tab/hide 전환 포함.
- `fixes-adapter-build.log`, `fixes-harness-sign.log`: VSIX 및 RAD Win64 BPL 빌드·USB 인증서 서명 검증 완료. 등록된 Windows 암호화 저장소를 사용했다.
- `fixes-bundle-runtime.log`: 패키지 Core를 Node 24.21.0 ARM64로 실행하여 인증 handshake·버전·capability negotiation·ping 통과.

## 설치본과 후속 실사용 확인

서명한 adapter를 포함한 후보: `D:/source/PiAgent/artifacts/piagent-2026-10-05T02-14-19-814Z`.

사용자가 두 IDE를 종료한 뒤 다음 명령으로 교체를 완료했다.

```powershell
& D:\source\PiAgent\scripts\install-acceptance-build.ps1 -CorePackage D:\source\PiAgent\artifacts\piagent-2026-10-05T02-14-19-814Z
```

설치 스크립트는 실행 중인 IDE가 있으면 중단한다. 기존 설치 receipt·VSIX 파일·RAD 등록 정보를 백업하고, 현재 설정된 OMP 실행 파일을 유지한다. OMP를 이전 bundled 버전으로 되돌리지 않는다. reference RADAgent와 사용자 NanumPDF는 수정하지 않았다.

설치 release: `%LOCALAPPDATA%/Programs/PiAgent/releases/0.9.14-acceptance-20261005025432`. 배포·검증 증거: `artifacts/installed-acceptance-20261005025432/`.

- `deployment.json`: Core·VSIX·RAD Win64 BPL 교체 경로와 이전 설치 백업 기록.
- `runtime.log`: 설치 ARM64 Node 24.21.0에서 인증 handshake·버전·capability·ping 성공.
- `installed-core-probe.json`: **실행 중인 새 설치 Core**의 버전 0.9.14, 설정 버전 0.9.14, ping, native OMP, 빈 세션 압축 실패의 한국어 사유 확인. 별도 test adapter이며 UI 검증과 구분한다.
- `installed-vsix-hashes.json`, `installed-hashes.json`: 설치된 DLL·UI와 원본 서명 후보의 일치 확인. 설치된 DLL/BPL Authenticode 상태 Valid. OMP 18.6.1 유지.
- 실제 RAD13.2 64-bit에서 FMX→VCL→FMX 전환 뒤 첫 전송 **이전에** workspace가 자동 갱신됨. VCL 전환 후 첫 질문 17+25 → 42 완료. 수동 재연결·두 번째 전송이 필요하지 않았다. 번호가 붙은 `rad-*.txt`에서 확인한다.
- 두 IDE의 실제 설정에서 수평 탭·버전·개발자·footer·겹침 없는 레이아웃 확인. `vs-settings`, `rad-settings-result` 기록 참조.
- VS의 분기 미리보기에서 한국어 분기 안내와 원본 보존 설명 확인. 적용 없이 거부하여 원본을 유지했다. 완료 안내는 자동 회귀로 검증했으며 이번 설치 후 live 완료 재실행은 하지 않았다.

프로젝트 닫기·분기/복원 완료·diff/journal의 모든 설치 IDE 시나리오와 기존 문서의 기타 PARTIAL/MANUAL 항목은 자동 회귀 및 위 확인만으로 전수 완료 처리하지 않는다. 별도 통합 설치파일·공식 릴리즈는 만들지 않았다.

## 추가 발견: 채팅 `/compact` 경로

설치본에서 `/compact`를 입력하면 native OMP prompt 경로로 전달되어 `Compaction failed: Nothing to compact (session too small)`가 영어 응답으로 표시됐다. 설정의 압축 버튼 RPC 경로와 다른 문제다.

보완 구현은 `/compact`와 추가 지침을 기존 `omp.control compact`로 전달한다. 완료·실패 안내를 채팅에도 표시하고, 응답/승인 중이거나 첨부·선택 영역이 있으면 명령을 거부하면서 입력 초안을 보존한다. 일반 모델 prompt로 보내지 않는다.

`compact-regression.log`: **112/112 PASS**. `compact-webview.log`: 실제 WebView2 **58개 PASS** 출력. `compact-adapters-unsigned.log`: 보완 VSIX/RAD Win64 빌드 통과.

최초 재서명 시 Windows `Cert:\CurrentUser\My\3CE49DE1124F325082FA90BDE4944756D1626251` 인증서가 조회되지 않아 실패했다 (`compact-adapters-build.log`). 사용자 USB 재연결 후 인증서가 복구되어 재서명에 성공했다 (`compact-final-sign.log`). 등록된 Windows 암호화 저장소를 사용했으며 PIN 재입력은 필요하지 않았다.

**최종 설치 완료:** `%LOCALAPPDATA%/Programs/PiAgent/releases/0.9.14-acceptance-20261005051004`. 후보 패키지: `artifacts/piagent-2026-10-05T05-09-54-755Z`. 최종 배포 증거: `artifacts/installed-acceptance-20261005051004/`.

- `deployment.json`: VSIX·RAD Win64 BPL·Core 교체 및 이전 설치 백업. OMP 실행 파일과 로그인 설정 유지.
- `runtime.log`, `installed-core-probe.json`: Node 24.21.0 ARM64의 인증 handshake·ping·버전과 실행 중인 설치 Core/native OMP의 한국어 압축 거부 사유 확인. OMP 18.6.1 유지.
- `installed-vsix-hashes.json`, `installed-rad-hashes.json`: 설치된 DLL·controller.js·BPL과 서명한 후보 파일 일치. VSIX DLL과 BPL Authenticode Valid; 전체 VSIX 서명·인증서 체인·timestamp 검증 통과.
- 실제 VS2026(NanumPDF)과 RAD13.2 64-bit(FMX 검증 프로젝트)의 채팅 입력창에서 `/compact` 실행. 두 IDE 모두 **“대화 기록이 아직 짧아 압축할 수 없습니다. 대화를 더 진행한 뒤 다시 시도해 주세요.”**를 표시하고 `연결됨` 상태로 복귀. 입력은 비워지고 다시 사용할 수 있다. 영어 assistant 응답이나 가짜 사용자 메시지는 추가되지 않는다. 번호가 붙은 `vs-compact-*`, `rad-compact-*` UI 기록 참조.

최종 설치본에는 기존 6개 수정과 추가 `/compact` 보완이 모두 반영됐다. 이 최종 확인은 짧은 세션의 명령 경로·한국어 안내·입력 복구 검증이다. 충분한 세션의 실제 압축 완료는 앞선 native OMP 검증 및 자동 회귀 기록과 구분하며, 이번에 별도 모델 호출로 반복하지 않았다. 두 IDE는 검증 후 실행 상태로 두었다.
