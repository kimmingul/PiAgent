# Windows installation (0.10.0)

[한국어](INSTALLATION.md) · **English** · [Documentation](README.md)

New to OMP or AI coding tools? Start with [first-time setup](GETTING-STARTED.en.md).
It includes an installation diagram and completion checks from IDE preparation to your first answer.
Current setup automatically registers RAD13.2; RAD11/12 require separate builds with their own SDKs.

Updated: 2026-10-09 KST. The default distribution is the signed `dist/PiAgent-Setup-0.10.0.exe`.
Select Core, RAD13.2 32/64-bit, VS2022 (17.14+)/2026 and optional installation of OMP if absent.
Previously installed adapters that are not selected are retained; deselection does not uninstall them.

| Location | Contents |
|---|---|
| `%LOCALAPPDATA%\Programs\PiAgent\releases\<release>` | Core, private Node/.NET runtimes, adapters and UI output |
| `%LOCALAPPDATA%\Programs\PiAgent\install-receipt.json` | Current release and IDE registration/recovery information |
| Current release's `core/settings.json` | OMP path, pipe, workspace, profile and execution settings |
| `%USERPROFILE%\.piagent\security\<pipe>` | Authentication files, workspace sessions and lifecycle diagnostics |

ARM64 uses native ARM64 runtimes. BPLs match the IDE's Win32/Win64 bitness; they are not ARM64 BPLs.
Unified-setup VS/RAD adapters automatically start or reuse Core when opening chat.
VS: Tools → PiAgent: Open Chat. RAD: View/Tools → PiAgent.
See the [unified installer guide](UNIFIED-INSTALLER.md) for selection, uninstall and upgrade behavior.

The earlier 0.9.18 RAD validation receipt points to `0.9.18-20261007162727` and records VS2022 (17.14+)/2026 and RAD32/64
registrations. Core and RAD were selectively upgraded to remove duplicate BPL registrations.
[0.10.0](RELEASE-0.10.0.en.md) includes session recovery and designer diagnostics fixes.
Building/publishing a release does not automatically replace the installed version.
Current live validation prioritizes VS2026/RAD13.2 64-bit; other IDE registrations are not evidence of a live PASS.

For permission-related RAD designer messages, follow [approval and edit-restriction guidance](RAD-DESIGNER-DIAGNOSTICS.en.md).
Close all RAD IDEs before upgrading and select the relevant RAD32/64 components.
Setup removes previous PiAgent370.bpl entries in each registration location and registers one new version.

## Manual archive installation (older distribution)

The 0.8.1 archive examples below are for maintaining/recovering older manual installations.
Do not mix these paths with unified-setup runtime paths. For the current distribution use the [unified installer](UNIFIED-INSTALLER.md).

Since VSIX 0.9.3, adapter authentication uses an explicit `PIAGENT_AUTH_FILE`, or
`%USERPROFILE%/.piagent/security/<pipe>/token`. This avoids AppData package redirection;
ACLs and mutual HMAC authentication remain enforced. Do not create authentication files manually or broaden permissions.
Unified-setup VSIX automatically starts/reuses Core. If connection fails, examine the reported path/error and retry through settings.

Core supports Windows x64/ARM64, Node.js 24.21.0+ in the 24 LTS line and .NET 8+ runtime.
Both architectures use the same JS/AnyCPU distribution. Approved writes require Git and a standalone
repository with a HEAD commit. Chat requires a separate OMP executable and login configuration.
VS/RAD WebViews require WebView2 Runtime. No Node native addon or Rust is used.

1. Extract PiAgent-0.8.1-windows.zip to an empty directory.
2. Run the following in PowerShell. Administrator privileges are not needed.

```powershell
& .\scripts\install-core.ps1 -Omp "$env:LOCALAPPDATA\omp\omp.exe" -Workspace 'D:\project' -AllowWrites
```

Omit `-AllowWrites` for read-only access. The default pipe is `piagent-dev`; change it with `-PipeName`.
Explicitly select `-OmpProfile native -AllowWrites` for validation using OMP's native tools/extensions.
Direct native-tool writes are not automatically included in PiAgent's approved-change records.
The default `-InstallRoot` is `$env:LOCALAPPDATA\PiAgent\runtime`, with separate version directories.
The script checks the entire SHA-256 manifest and refuses to overwrite an existing installation.
The manifest verifies integrity, not publisher identity or a signature; verify the archive's source as well.

```powershell
& "$env:LOCALAPPDATA\PiAgent\runtime\0.8.1\scripts\start-core.ps1"
```

Edit the installation's settings.json to change Node/OMP/pipe/workspace. Stop the foreground daemon with Ctrl+C.
The manual scripts do not register a service/startup entry, change PATH or download Node/.NET/OMP.
IDE and Core bitness can differ. x86 Core runtime distribution is outside the supported scope.

VS2022 (17.14+)/2026: install `adapters/visualstudio/PiAgent.Vsix.vsix` for each instance and restart the IDE.
The VSIX declares amd64/arm64. Open Tools → PiAgent: Open Chat and connect.
Test profiles use VSIXInstaller `/rootSuffix:PiAgentTest /instanceIds:<id>`;
after testing, `/RootSuffix PiAgentTest /UpdateConfiguration` applies only to that profile.

RAD Studio 13.2: use PiAgent370.bpl from adapters/radstudio/Win32 or Win64 to match the IDE.
Keep that directory's ui/ and WebView2Loader.dll beside the BPL. Add the BPL through
Component → Install Packages → Add, then open View → PiAgent or Tools → PiAgent; both open the same chat window.
Other compiler/package suffixes require rebuilding with the target RAD SDK. IDE runtime/design packages are not redistributed.
For registry-based test profiles, the 64-bit IDE uses `Known Packages x64`.
Updating only `Known Packages` can leave an old x64 BPL loaded; check the actual loaded path.
On Windows ARM64, RAD uses the installed Win32/Win64 IDE through compatibility execution; no ARM64 BPL is provided.
A [separate RAD registry profile](https://docwiki.embarcadero.com/RADStudio/Athens/en/IDE_Command_Line_Switches_and_Options)
can be launched with `bds.exe -rPiAgentValidation07`. Existing RADAgent profiles/packages are preserved.
Live validation prioritizes VS2026 and RAD13.2; final VS2022 validation remains deferred.

Set `PIAGENT_PIPE_NAME` before starting the IDE when using another endpoint.
Start the daemon first in a manual-archive-only environment; unified-setup adapters support automatic startup.

For upgrades, install the new version, stop the old Core normally and use the new launcher.
Replace the VSIX with the new file. In RAD, close the IDE or unload the old BPL before registering the new BPL.
Do not overwrite a running BPL.

```powershell
& .\scripts\uninstall-core.ps1 -InstallDirectory "$env:LOCALAPPDATA\PiAgent\runtime\0.7.0"
```

Stop Core first. Uninstall removes only the version directory verified by its receipt;
credentials, saved sessions and Git checkpoints are preserved. Unregister VSIX/BPL through each IDE's extension/package manager.
An earlier recoverable version can be reinstalled, but new batch checkpoints are hidden by old adapters.
Actual host/test boundaries are recorded in [VALIDATION.md](VALIDATION.md).

The historical 0.9.0 GUI harness validation installation used `harness-validation/runtime/0.9.0`,
pipe `piagent-harness09`, and included only Win64. Current build-adapters.ps1 defaults to Win64;
unified installer builds include both IDE bitnesses. Core x64/ARM64 support is separate from BPL IDE bitness.
Framework skills/catalogs are bundled with Core and delivered to OMP through inspection results,
without global skill installation. See [GUI-HARNESS.md](GUI-HARNESS.md) for the detailed scope.
