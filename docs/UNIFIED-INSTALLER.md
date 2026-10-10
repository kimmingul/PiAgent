# PiAgent unified Windows installer

[한국어](UNIFIED-INSTALLER.ko.md) · **English** · [Documentation](README.md)

Documentation updated: 2026-10-11. Check the final signed 0.11.2 scoped prerelease asset against its own `.exe.sha256` and [validation history](VALIDATION.md). Prior signed 0.11.1 package checks and unsigned working-tree 240-minute runs do not certify this new package. Normal-profile installation/recovery is a separate condition; published 0.11.0 signing/installation receipts retain their original versions.
The earlier 0.9.18 RAD validation receipt points to `0.9.18-20261007162727` and records VS2022 (17.14+)/2026 and RAD32/64 registrations.
Core and RAD32/64 were upgraded; old duplicate RAD BPL registrations were consolidated.
The local Core fix is documented in [session recovery](SESSION-RECOVERY-FIX.md); release publication does not install the new setup automatically.
Registration is separate from live validation: signed 0.11.1 VS2026 WPF 8/8 and isolated RAD13.2 Win32/Win64 VCL 11/11 and FMX 9/9 fixtures passed. Later automated 240-minute IDE runs on unsigned source passed 3/3. Validation of new signed 0.11.2 assets and normal-profile installation are separate.
The signed setup includes the idle/long-turn fixes; [validation history](VALIDATION.md) records remaining limits.

Output: `dist/PiAgent-Setup-0.11.2.exe`. Asset path: `releases/download/v0.11.2/PiAgent-Setup-0.11.2.exe`; check the [release asset](https://github.com/kimmingul/PiAgent/releases/tag/v0.11.2) and SHA-256. A single self-contained setup supports Windows
x64 and ARM64. The setup executable uses Windows x64 compatibility on ARM64; installed
Node.js, .NET and OMP use the host's native architecture. No system PATH or runtime is replaced.

The native WPF setup detects installed IDEs and offers independent selections:

Use the **한국어 / English** selector at the top right. The default is Korean on Korean Windows and
English elsewhere. Guidance, progress, PiAgent errors, shortcuts and uninstall messages use the selected
language. The uninstall shortcut retains that language. `--language auto`, `--language ko` or
`--language en` may be added to UI, diagnostic or unattended commands below.
In the app, **Settings → Display → Language** defaults to `Automatic`: Korean on Korean systems,
English otherwise. Explicit choices are saved in the current project's private preferences.

- RAD Studio 13.2 / Delphi 37.0, 32-bit IDE (Win32 BPL)
- RAD Studio 13.2 / Delphi 37.0, 64-bit IDE (Win64 BPL)
- Visual Studio 2022 (17.14+), every detected supported instance
- Visual Studio 2026, every detected supported instance

Missing IDEs are disabled. Detected IDEs are selected by default; deselect any of them,
or select only Core. Close selected IDEs before installing. VS installation uses each
instance's VSIXInstaller with `/shutdownprocesses` after checking that IDE windows are closed,
so leftover ServiceHub processes do not cause error 2004. Completed instances are recorded;
rerunning repairs selected components, including a same-version VSIX. Previously installed
components that are deselected are retained; use uninstall to remove the installation.
Core upgrades preserve the existing pipe, OMP executable, workspace, write setting
and OMP profile; the bundled Node path is updated to the new release. Invalid saved
settings stop the upgrade instead of silently resetting the access policy.
RAD registers packages in the
correct HKCU Known Packages / Known Packages x64 key. Only PiAgent package entries are
replaced; previous PiAgent RAD entries are recorded and restored on uninstall if still present.
RADAgent registrations and files are never changed. Other RAD compiler versions are unsupported.

The installer searches PATH, standard OMP locations and existing PiAgent-managed OMP installs.
An existing native OMP executable is reused. If none is found, the user can optionally install
the latest official release from `can1357/oh-my-pi`, selected for x64/ARM64 and checked against
GitHub's SHA-256 asset digest. This option requires internet access. An error stops installation
with a recovery receipt; it never silently reports success without the selected OMP component.
OMP authentication is performed by the user through the OMP shortcut. Token login data are not copied.

Core, both RAD adapters, VSIX and private Node.js/.NET runtimes are embedded, so basic installation
does not require internet. Node 24.21.0 and .NET 8 runtime archives are verified against official
checksums during the build. Their licenses are included. WebView2 Runtime is a separate IDE
prerequisite; existing installations on this PC already have it. Git is required only for approved
workspace writes. Initial Core settings are read-only, with no workspace and no login autorun.

Per-user destination: `%LOCALAPPDATA%/Programs/PiAgent`. No administrator rights are requested.
Start Menu contains PiAgent Core, OMP (if available), and uninstall shortcuts. The VSIX and RAD
adapter automatically start the installed Core when opening chat
(RAD View/Tools > PiAgent, VS Tools > PiAgent: Open Chat). Configure workspace
and write permissions in the installed `core/settings.json` only when needed.

Windows Installed Apps lists PiAgent. Uninstallation requires closing selected IDEs and this
installation's Core. External OMP, user credentials and saved sessions in `%USERPROFILE%/.piagent/security`
are preserved; the OMP download owned by this setup is removed with its installation.
The uninstall worker runs from a temporary copy of the setup, so it can remove the installation.

Build:

```powershell
& .\scripts\build-installer.ps1
```

The default build signs adapters, VSIX, Core broker and setup, then emits SHA-256 sidecars.
`-NoSign` creates explicitly named `-unsigned-preview.exe` for local validation only.
`-SkipAdapterBuild` reuses previous outputs and is intended for development iterations.
Signed builds reject an unsigned BPL, broker, VSIX or embedded first-party VSIX DLL even
when adapter compilation is skipped. Run `scripts/test-installer.ps1` to verify the setup,
complete embedded payload and authenticated Core handshake/ping using bundled runtimes.
Payload extraction validates every file's SHA-256 before registration. Partial installation
is recorded for removal using `PiAgent-Setup.exe --uninstall` from the distribution file.

Diagnostic commands (no IDE or registry changes):

```powershell
PiAgent-Setup.exe --inspect C:\temp\piagent-detection.json
PiAgent-Setup.exe --verify-payload C:\temp\piagent-new-empty-folder
```

Explicit unattended installation (changes IDE registrations; Core is always included):

```powershell
PiAgent-Setup.exe --install-components core,rad64,vs26
```

Allowed components: `core,rad32,rad64,vs22,vs26,omp`. OMP is downloaded only if absent
and `omp` is selected. Exit code 0 means completion; errors return 1 and write
`%TEMP%/PiAgent-setup-error.txt`. Progress is in `%TEMP%/PiAgent-setup-install.log`.
Individual VSIX logs are in the installation root as `vsix-<instanceId>.log`.

The preview build must not be represented as signed or as completing live IDE testing.
Earlier 0.11.0 scoped VS2022 VB 5/5, WinUI3 source 7/7 and WinForms 8/8 passed; this does not certify all workloads. The signed 0.11.1 RAD Win32 BPL passed VCL/FMX fixtures in an isolated 32-bit IDE, not normal-profile acceptance. See [supported scope](IDE-AGENT-INTEGRATION.en.md).
