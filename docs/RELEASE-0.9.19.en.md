# PiAgent 0.9.19 — Korean and English

[한국어](RELEASE-0.9.19.md) · **English** · [Documentation](README.md)

Signed prerelease dated 2026-10-08. [Installer and SHA-256](https://github.com/kimmingul/PiAgent/releases/tag/v0.9.19).

Choose Korean or English under **Settings → Display → Language**, saved in private settings for the
current project. The default `Automatic` uses Korean on Korean Windows and English everywhere else.
VS/RAD send the Windows display language to the UI, so the system default remains correct even when
WebView’s browser language differs. Existing Japanese, German and French choices remain available;
PiAgent’s added screens fall back to English for these languages.

Fixed Korean labels are translated in settings, accounts and authentication controls, model roles and
presets, execution controls, Git management, saved sessions and approval guidance. Applying a language
updates open labels while keeping the selected tab, unsent authentication input, chat draft and approval
state. Request ordering prevents a late startup translation from overwriting a saved language.
Only known PiAgent guidance is translated; model replies, code, external tool text and authentication data
are not automatically translated.

The installer offers Korean/English selection at the top right. Its default also uses Korean on Korean
Windows and English otherwise. Installation/uninstallation guidance, progress, PiAgent errors and
shortcuts are translated. The uninstall command retains the selected language, and upgrading in a
different language replaces known PiAgent shortcuts without duplicating them.
`--language auto|ko|en` works with the UI, diagnostics, unattended installation and uninstallation.

The website supports direct `?lang=ko|en` links and remembers the selected language. Body text, metadata,
accessibility labels and user/installation guide links switch together. Selection works with blocked storage.
README, installation guides, unified setup, RAD designer diagnostics and current release notes have
Korean/English routes. The distribution payload includes the main translated guides. Historical development
and diagnostic records may retain their original language.

Validation is recorded in [language support](LOCALIZATION.en.md). Existing-property VCL/FMX live validation
and form designer limits remain as documented in [0.9.18](RELEASE-0.9.18.en.md).
The language update does not complete the outstanding VS2022 or RAD32 live acceptance work.
