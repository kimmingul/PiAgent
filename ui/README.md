# RADAgent UI compatibility

PiAgent reuses the HTML structure, CSS, renderer modules and provider icons from the local
`D:\source\RADAgent\src\chat` reference snapshot (2026-10-04). That downloaded reference has
no Git metadata. `reference-files.json` records the source SHA-256 values. RADAgent is never modified.
Its MIT license and icon notices are included in every adapter UI payload.

Do not redesign this interface or expose protocol/debug operations as permanent buttons.
Preserve the reference layout, typography, colors, menus, composer and inline approval cards.
Future capabilities must use the original interaction points, rather than add a feature dashboard.

## Integration boundary

- `chat.html`: original structure; PiAgent title, local-only CSP and ESM bridge added.
- `chat.js`: original renderer; one outbound `piagentPost` hook added.
- `composer.js`: capability guard disables unsupported mid-turn queueing without changing layout.
- Other original JS/CSS/assets: unchanged.
- `bridge.ts`: WebView transport, locale loading and original sheet-based list host.
- `controller.ts`: strict TypeScript translation between RADAgent UI frames and PiAgent host actions.
- No Core or IDE-specific business logic is placed in the renderer.

Chat connects automatically. The title opens saved sessions; + in the top bar starts a new session.
The context ring opens usage. Changes appear as inline approval cards. File restore is available
from `/restore` or the settings sheet, requires a preview and approval, and restores files only.
`/selection` captures IDE selection; click its original composer chip to include it in a question.
An unchecked chip never attaches code. Failed submissions retain the original draft.

OMP model/thinking selection is connected when omp.controls.v1 is negotiated. OMP select/confirm/input/editor
requests use the original card styles through interactions.ts. Approval modes other than always-ask, BTW,
attachments, export, plugins and MCP controls are not yet fully connected through PiAgent Core. Their original controls
remain in place but disabled. Mid-turn steering/queueing is not supported; Enter leaves the draft unsent
without clearing the draft. No direct RPC passthrough or automatic approval is introduced.

## Verification

`npm test` tests bridge state transitions and asset completeness. Build PiAgent.WebView.Smoke
and run `--ui <extracted-VSIX-ui-folder>` to test the actual bundled page in WebView2, including
CSP, Markdown, safe text rendering, original approval cards and 12 docking transitions.
Both VSIX and RAD Studio BPL packaging include the full UI asset tree plus compiled bridge/controller/interactions.
