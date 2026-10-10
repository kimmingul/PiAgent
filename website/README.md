# PiAgent website

[한국어](#한국어) · [English](#english)

## 한국어

홈페이지의 **처음 설치하기**에는 6단계 순서 도식, 단계별 완료 기준, AI 연결별 준비 사항과
오류 확인 위치가 있다. [한국어 초보자 안내](../docs/GETTING-STARTED.ko.md)와
[English guide](../docs/GETTING-STARTED.en.md), 문서 ZIP 다운로드를 연결한다.

NanumCsvViewer의 배치와 Windows 스타일을 참고한 PiAgent의 정적 홈페이지다.
PiAgent IDE UI의 디자인은 유지한다.

- `index.html`, `style.css`, `app.js`, 기존 RADAgent `icon.ico`를 사용한다.
- 한국어/영어를 선택하고 선택을 저장한다. `?lang=ko`, `?lang=en`으로 직접 연결할 수 있다.
- 명시적인 URL 언어, 저장된 선택, 시스템 언어 순으로 적용한다. 한국어 시스템은 한국어, 그 외에는 영어다.
- 본문과 메타 설명, 접근성 이름, 문서 링크를 함께 전환한다. 저장소 차단 시에도 전환한다.
- 시스템/밝은/어두운 테마, 반응형 배치, 키보드 포커스와 reduced-motion을 지원한다.
- 분석 도구나 외부 폰트, 런타임 API 요청, 빌드 의존성이 없다.
- 화면 예시는 실제 지원 범위와 구분하여 표시한다.
- 0.11.2 사전 릴리즈의 기능 범위만 설명한다. 미서명 작업 트리의 격리 IDE 자동 240분 시험은 3/3 통과했으며 새 서명 설치파일의 장시간 시험과 구분한다. Copilot/KAI 실측 비교는 수행하지 않았다.
- 공개 저장소와 릴리즈: `kimmingul/PiAgent`. 주소: https://kimmingul.github.io/PiAgent/.
- 0.11.2 홈페이지 변경은 연결한 설치파일·문서 ZIP·SHA256 파일이 릴리즈에 게시된 뒤 배포한다.

`.github/workflows/pages.yml`이 기본 `codex/omp-chat` 브랜치의 홈페이지 변경을 검증하고
`website/`만 GitHub Pages에 게시한다. Actions에서 수동 실행할 수도 있다.
제품 소스나 진단 산출물은 홈페이지 게시물에 포함하지 않는다.

## English

**First-time setup** includes a six-stage diagram, completion checks, AI-specific preparation and
troubleshooting. It links the [English guide](../docs/GETTING-STARTED.en.md),
[Korean guide](../docs/GETTING-STARTED.ko.md) and downloadable documentation ZIP.

Static product landing page, inspired by the layout and Windows styling of
https://kimmingul.github.io/NanumCsvViewer/. The PiAgent IDE UI is not redesigned.

- Files: `index.html`, `style.css`, `app.js`, original RADAgent `icon.ico`.
- Korean/English switch with persisted selection and direct `?lang=ko` / `?lang=en` links.
- Language priority: explicit URL, saved choice, system default (Korean on Korean systems; English otherwise).
- Body text, metadata, accessibility labels and documentation links switch together; switching also works with blocked storage.
- System/light/dark appearance, responsive layouts, keyboard focus and reduced-motion support.
- No analytics, external fonts, runtime API requests or build dependencies.
- Illustrative preview is labeled; feature descriptions and limits are scoped to the PiAgent 0.11.2 prerelease. Automated isolated IDE 240-minute runs passed 3/3 on unsigned working-tree binaries, separately from long-duration testing of the new signed installer. Matched Copilot/KAI measurements have not been performed.
- Public source, releases and website repository: `kimmingul/PiAgent`.
- Canonical homepage: https://kimmingul.github.io/PiAgent/.
- Signed installer downloads are public and do not require repository access. Publish the 0.11.2 page update only after its setup, documentation ZIP and SHA256 assets are available at the linked release URLs.

The `.github/workflows/pages.yml` workflow validates and publishes only `website/`
using GitHub Pages. It runs for website changes on the default `codex/omp-chat`
branch, or manually through Actions. Pages uses the GitHub Actions source.
Project source and diagnostic artifacts are not included in the website artifact.
