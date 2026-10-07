# 한국어 / 영어 지원

**한국어** · [English](LOCALIZATION.en.md) · [문서](README.md)

앱의 **설정 → 표시 → 언어** 기본값은 `자동`이다. 한국어 시스템에서는 한국어, 나머지는 영어를
사용한다. `한국어` / `English`를 직접 선택하면 시스템보다 우선하고 현재 프로젝트의 비공개
`preferences.json`에 저장한다. **적용**은 창을 유지하고, **저장하고 닫기**는 저장 성공 후 닫는다.
실패하면 설정 창과 입력을 유지한다. 앱 재실행 시 저장한 언어를 다시 읽는다.

PiAgent의 설정, 계정, 모델 역할, 프리셋, 실행 제어, Git, 세션 목록, 복원과 승인 안내를 두 언어로
표시한다. 기존 원본 채팅 UI의 번역 파일을 함께 적용한다. 알려진 PiAgent 메시지를 번역하며
사용자가 입력한 코드, 모델 답변, 외부 제공자·도구의 원문과 비밀정보는 번역하지 않는다.
원본 채팅의 다른 언어는 유지하되 PiAgent에서 추가한 부분은 영어로 표시할 수 있다.

설치·제거 창은 오른쪽 위에서 한국어/English를 선택한다. 자동 기본값은 앱과 같다.
무인 실행에서도 `--language ko`, `--language en`, `--language auto`로 지정할 수 있다.
언어 전환은 IDE 선택과 기존 설정을 바꾸지 않는다. 제거 바로가기는 설치 때 선택한 언어를 전달한다.

홈페이지는 URL의 `lang` 값, 저장된 선택, 시스템 기본값 순으로 결정한다.
[한국어](https://kimmingul.github.io/PiAgent/?lang=ko) / [English](https://kimmingul.github.io/PiAgent/?lang=en).
브라우저 저장소가 차단되어도 직접 링크와 버튼은 작동한다. README의 언어 링크와
[문서 목록](README.md)에서 같은 내용의 번역본을 찾을 수 있다.

구현 검증 명령:

0.9.19 전체 회귀 **148/148**, C#/Delphi adapter 통합 **17/17**을 통과했다.
서명 설치 패키지에서 실제 WebView **75 PASS**: 영어 설정·승인 설명, 한국어 적용과 미전송 입력 보존을 확인했다.
RAD13.2 64-bit의 설치된 0.9.19에서 한국어 시스템 기본값과 영어 설정 저장·화면 전환을 직접 확인했다.
RAD Studio를 완전히 종료·재실행한 후에도 저장한 영어 선택과 영어 화면이 유지됨을 확인했다.
설치 창도 두 언어의 배치와 IDE 선택 보존을 확인했다.

```powershell
npm test
npm run test:adapters
dotnet run --project installer/PiAgent.Setup.Tests -c Release
node scripts/test-website.mjs
node scripts/test-docs.mjs
```

언어별 문구와 매개변수, 시스템 기본값, 명시적 선택, 번역 요청 순서를 검사한다.
실제 WebView 테스트는 설정의 저장 응답, 전체 탭 번역과 언어 적용 중 초안·인증 입력·승인 카드
보존을 검사한다. 설치 창은 두 언어의 화면 배치와 선택 유지 여부를 별도로 확인한다.
