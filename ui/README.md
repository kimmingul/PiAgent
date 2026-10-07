# RADAgent UI compatibility

0.9.15 user-requested changes: activity.js/activity.css add a native details/summary fold for the
task list while retaining its original colors and renderer. Original provenance hashes remain in
reference-files.json; these two adapted files join the documented integration exceptions.
Git bootstrap uses a compact dismissible banner and the existing sheet. Git preview and first
commit require explicit user confirmation. IDE reconnect resumes the last workspace session;
New conversation still creates a fresh one.

Current documentation: 2026-10-08, PiAgent 0.9.17. Settings retain five areas and show the generated
package version and developer Kim Min-Gul (김민걸, mgkim@jbnu.ac.kr). Account/provider/login views
remain inside settings; native credentials are OMP-owned. Long-running turns display activity and
preserve the actual termination reason without a fixed ten-minute turn limit.
See [current validation](../docs/VALIDATION.md) for distinctions between mock WebView checks and live IDE use.

PiAgent reuses the HTML structure, CSS, renderer modules and provider icons from the local
`D:\source\RADAgent\src\chat` reference snapshot (2026-10-04). That downloaded reference has
no Git metadata. `reference-files.json` records the source SHA-256 values. RADAgent is never modified.
Its MIT license and icon notices are included in every adapter UI payload.

Do not redesign this interface or expose protocol/debug operations as permanent buttons.
Preserve the reference layout, typography, colors, menus, composer and inline approval cards.
Future capabilities must use the original interaction points, rather than add a feature dashboard.

## Integration boundary

- `chat.html`: original structure; PiAgent title, local-only CSP and ESM bridge added.
- `chat.js`: outbound hook, safe schema-2 rich history and acknowledged clipboard/BTW callbacks.
- `composer.js`: negotiated queue capability and bounded workspace autocomplete/error recovery.
- `clicks.js`: native copy acknowledgement; `plusmenu.js`: actual toggle results and distinct manage actions.
- `btw.js`: list pagination and success acknowledgements for notes/follow-up drafts.
- `approval.js`: failed plan execution restores original card actions and displays the actual host error.
- Other original JS/CSS/assets: unchanged. Reference hashes are preserved as original provenance; changed modules are documented here.
- `bridge.ts`: WebView transport, locale loading and original sheet-based list host.
- `controller.ts`: strict TypeScript translation between RADAgent UI frames and PiAgent host actions.
- `settings.ts`: original sheet entry point and five settings areas; `contracts.ts`: original 33 action inventory.
- No Core or IDE-specific business logic is placed in the renderer.

Chat connects automatically. The title opens saved sessions; + in the top bar starts a new session.
The context ring opens usage. Changes appear as inline approval cards. File restore is available
from `/restore` or the settings sheet, requires a preview and approval, and restores files only.
`/selection` captures IDE selection; click its original composer chip to include it in a question.
An unchecked chip never attaches code. Failed submissions retain the original draft.

OMP model/thinking selection, approvals, independent BTW, preferences, attachments, export, files/links/copy,
queue/retry/subagent controls now connect through explicit Core/adapter endpoints. Controls are enabled from
negotiated session flags. Settings save and submitted drafts are acknowledged before local success is shown.
Native credentials stay OMP-owned. See [implementation/limits](../docs/CHAT-UI-IMPLEMENTATION.md) for preset/account
settings delegation, bounded file checkpoint coverage and the installed IDE acceptance matrix.

Original message hover actions now use negotiated `chat.timeline.v1`: preview and approve a restore/branch,
preserve the source conversation, reopen the context before that message and return its text as a draft.
This differs from file-only `/restore`. Unsupported snapshot files are not silently claimed as restored.

`markdown.js` retains the original renderer and styling; file-reference recognition additionally accepts
C#/VB/XAML/project and FMX references (case-insensitive), with extension boundaries and original line navigation.
Original provenance hashes remain in `reference-files.json`; this integration change is excluded from the byte-retention guard.
The bridge replays current status/capability gates after preference translations so dynamic titles and busy state survive settings.

## Verification

Settings use a scoped `settings.css` and retain the original five areas. Horizontal accessible tabs,
scrolling content and footer actions are checked in real WebView2 at 100/150/200% zoom. Core supplies
the package version; the developer identity is shown in the footer and Advanced, with a compact footer
on small viewports. Original reference CSS bytes remain untouched.

`npm test` tests bridge state transitions and asset completeness. Build PiAgent.WebView.Smoke
and run `--ui <extracted-VSIX-ui-folder>` to test the actual bundled page in WebView2, including
CSP, Markdown, safe text rendering, original approval cards and 12 docking transitions.
Both VSIX and RAD Studio BPL packaging include the full UI asset tree plus compiled bridge/controller/interactions/settings/contracts.
OMP 실행 관리는 기존 고급 탭 안에서 기능·상태 조회, Fast/압축/재시도/캐시/queue 모드,
하위 에이전트 기록·지시·중단 및 발견된 boolean 기능 설정을 제공한다.
모델 역할 탭은 전역·프로젝트 scope와 전역 프리셋 관리를 제공한다.
구현·미구현 범위와 검증은 `docs/OMP-FEATURE-IMPLEMENTATION.md`를 따른다.
