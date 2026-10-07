# Korean / English support

[한국어](LOCALIZATION.md) · **English** · [Documentation](README.md)

The default under **Settings → Display → Language** is `Automatic`: Korean on Korean systems and English
elsewhere. Explicit `한국어` / `English` selections override the system and are saved in the current project’s
private `preferences.json`. **Apply** keeps the window open; **Save and close** closes after a successful save.
A failed save retains the settings window and input. Saved language preferences are read again on restart.

PiAgent settings, accounts, model roles, presets, execution controls, Git, session lists, restore and approval
guidance support both languages alongside the original chat UI’s language files. Known PiAgent messages are
translated. User code, model replies, external provider/tool text and secrets are not translated. Other original
chat languages remain available; PiAgent’s added screens may use English fallback.

Installation and uninstallation windows offer Korean/English selection at the top right, with the same system
default. Unattended commands accept `--language ko`, `--language en` or `--language auto`. Changing language
keeps IDE selections and existing settings intact. The uninstall shortcut passes the installation’s chosen language.

Website language priority is the URL’s `lang` parameter, saved selection, then system default.
[Korean](https://kimmingul.github.io/PiAgent/?lang=ko) / [English](https://kimmingul.github.io/PiAgent/?lang=en).
Direct links and buttons also work with blocked browser storage. Use the README language links and
[documentation index](README.md) to find matching translated guides.

Validation commands:

0.9.19 passed **148/148** regression tests and **17/17** C#/Delphi adapter integration tests.
The signed installer's real WebView passed **75 checks**, including English settings/approval guidance,
applying Korean and preserving unsent input. Installed 0.9.19 in RAD13.2 64-bit was inspected directly:
Korean system defaults, saving English and translating the open settings window. Both installer layouts
and preserved IDE selections were also verified directly. After fully closing and restarting RAD Studio,
the saved English choice and English UI were retained.

```powershell
npm test
npm run test:adapters
dotnet run --project installer/PiAgent.Setup.Tests -c Release
node scripts/test-website.mjs
node scripts/test-docs.mjs
```

Checks cover message/placeholder parity, system defaults, explicit choices and translation request ordering.
Real WebView tests cover settings save acknowledgement, all settings tabs and preservation of chat drafts,
authentication input and approval cards during language changes. Both installer layouts and preserved selections
are inspected separately.
