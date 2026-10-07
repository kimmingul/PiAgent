# PiAgent website

Static product landing page, inspired by the layout and Windows styling of
https://kimmingul.github.io/NanumCsvViewer/. The PiAgent IDE UI is not redesigned.

- Files: `index.html`, `style.css`, `app.js`, original RADAgent `icon.ico`.
- Korean/English switch, system/light/dark appearance, responsive layouts, keyboard focus and reduced-motion support.
- No analytics, external fonts, runtime API requests or build dependencies.
- Illustrative preview is labeled; features and validation limits reflect PiAgent 0.9.18, including abandoned session recovery.
- Public source, releases and website repository: `kimmingul/PiAgent`.
- Canonical homepage: https://kimmingul.github.io/PiAgent/.
- Signed installer downloads are public and do not require repository access.

The `.github/workflows/pages.yml` workflow validates and publishes only `website/`
using GitHub Pages. It runs for website changes on the default `codex/omp-chat`
branch, or manually through Actions. Pages uses the GitHub Actions source.
Project source and diagnostic artifacts are not included in the website artifact.
