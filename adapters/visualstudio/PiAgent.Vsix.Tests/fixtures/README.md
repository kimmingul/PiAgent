# Visual Studio designer acceptance fixtures

`MtpConsole` is a separate .NET 10 `MSTest.Sdk/4.1.0` CLI/TRX fixture. Its
`global.json` explicitly opts into Microsoft.Testing.Platform. It is not an
`IdeAcceptanceHarness` marker and does not certify Test Explorer integration.
From that fixture directory, restore dependencies and run:

```powershell
dotnet restore MtpConsole.csproj
dotnet test --project MtpConsole.csproj --no-restore --framework net10.0 --results-directory ./results-pass -- --report-trx --report-trx-filename results.trx
```

The normal run must report two executed/passing tests. Run the same command in
an isolated child process with `PIAGENT_MTP_MODE=fail` and a different result
directory to require one failed test, exit code 2, and a failing TRX. Preserve
the caller's environment. `--list-tests` should discover both names; display
names are not guaranteed unique. PiAgent requires explicit `framework` and
rejects MTP filters/runsettings, multiple assembly discovery blocks, truncated
output and zero/unparsed tests. CLI success alone is not a test pass.

Use an experimental VS profile with the candidate extension. Bind Core to the fixture directory, open its solution, and save all documents before tools run.

- `Wpf/Wpf.sln`: open `MainWindow.xaml`. Inspect reports `wpf-xaml` and source buffer backend. Create a Button under Grid (component ID 1), bind Click with `create:true`, apply the concrete preview, build, run, then preview/restore checkpoint and build again. Verify original bytes/comments/spacing/Unicode and generated code-behind source restoration. Source edits do not claim live visual designer control.
- `WinFormsFramework/WinFormsFramework.sln`: open `MainForm.cs` in the Form Designer. Inspect must expose an actual public `IDesignerHost` and standard types before structural tools appear. Create Button under root MainForm, bind Click with handler creation, save/build/run; preview/restore checkpoint and reopen designer. Verify exact original `.cs`, `.Designer.cs`, `.resx` bytes. If the IDE offers no public host, record unavailable; do not claim native authoring passed.
- `VisualBasicConsole/VisualBasicConsole.sln`: .NET 8 VB console without package dependencies. Its marker tests context/build, a two-file `Add` rename/apply/native Undo, stale preview refusal and debugger start/pause/threads/stop. `dotnet .../VisualBasicConsole.dll --verify` checks the result and exits; the ordinary startup remains alive for debugger acceptance. Its `global.json` selects a .NET 9 SDK feature band compatible with VS2022 17.14 rather than the machine's newer .NET 10 SDK.
- `WinUI3SourceLibrary/WinUI3SourceLibrary.sln`: a real WinUI XAML library using the locally verified `Microsoft.WindowsAppSDK.WinUI` 2.3.9 component and InteractiveExperiences 2.1.9. The marker tests C# rename/native Undo, source-only WinUI create/bind/delete and exact source restoration. It builds the generated C#/XBF against Windows SDK reference package 10.0.19041.57 and targets ARM64. There is no application startup, so debugger/runtime/visual-designer acceptance is deliberately absent. It requires those packages to be available, not fabricated WinUI API stubs. On this host, offline `dotnet restore --source "$env:USERPROFILE\.nuget\packages"` and both SDK 9.0.315 and VS2022 MSBuild builds passed; actual IDE acceptance is still separate.
- `NativeCppConsole/NativeCppConsole.sln`: native MSVC console with an explicit `Debug|x64` marker, v143 toolset and Windows SDK 10.0.26100.0. It verifies actual VC project identity in context, targeted native build, debugger start/pause/threads/stop; it contains no Roslyn refactor or managed profiling assertions. `bin/x64/Debug/NativeCppConsole.exe --verify` checks the two-file calculation and exits; ordinary startup stays alive for the native debugger. VS2022 MSBuild with installed MSVC 14.44.35207 builds its EXE/PDB and the verification exits successfully. On this host, VS2026 has compiler binaries but lacks the desktop VC project platform targets/component, so VS2026 native C++ acceptance requires that workload before it can be claimed. Fixture preparation does not install it.

For both fixtures, alter an owned file after preview or after apply: stale apply/restore must refuse and preserve the alteration. Native undo and persisted source-journal restore are separate acceptance checks. Test partial failures and re-preview checkpoint before retrying.

## Gated direct SDK receipt

Copy a fixture's top-level source files into a new dedicated directory (omit bin/obj). The marker `piagent-vs-acceptance.fixture.json` opts into source mutations for tests. In the process that launches the experimental IDE set:

```powershell
$env:PIAGENT_VS_ACCEPTANCE = '1'
$env:PIAGENT_VS_ACCEPTANCE_ROOT = 'D:\Temp\PiAgentVsWpfFixture'
& 'C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\devenv.exe' 'D:\Temp\PiAgentVsWpfFixture\Wpf.sln' /RootSuffix PiAgentIntelligence /Command PiAgent.RunIdeAcceptance
```

If `/Command` is too early during startup, wait for solution load and use the Command Window: `PiAgent.RunIdeAcceptance`. The equivalent DTE command GUID is `{e648642e-3b01-454a-a5f5-77ab0b763a90}`, ID `0x0106`; `DTE.Commands.Raise` can invoke it after loading. The command is registered only in an opted-in IDE process; its code rechecks exact solution-directory/root equality, the fixture marker and linked ancestors before running. It is never an agent tool and grants no production approval bypass.

The receipt `piagent-vs-acceptance.receipt.json` is written after each case. It contains catalog/context, targeted native build, two-file rename preview/apply/native undo with safe cleanup, stale-preview refusal, debugger start/pause/threads/stop, and designer create/bind/delete with independent byte-exact checkpoint restores. A marker may add `testProject` for structured VSTest/TRX verification. A missing public native designer backend records a failed case, not a native-authoring pass. Harness source cleanup refuses unknown changes; a failed cleanup must be reviewed before a rerun.

For an experimental profile with an old command cache, set `PIAGENT_VS_ACCEPTANCE_AUTORUN=1` before launching the IDE without `/Command`. The package schedules a one-shot run after `KnownUIContexts.SolutionExistsAndFullyLoadedContext` activation and a brief asynchronous yield; the same opt-in/root/marker checks still apply. It never repeats for another solution in that IDE process. Omit both acceptance environment flags for normal use.

For VS2022 compatibility, the observed installation is `C:\Program Files\Microsoft Visual Studio\2022\Community`, instance `8967bed4`, version 17.14.37411.7. Its existing isolated `PiAgentTest` profile is `17.0_8967bed4PiAgentTest`; its old 0.7.0 registration is not evidence for the current candidate. Root-owned installation can use that installation's `VSIXInstaller.exe /quiet /rootSuffix:PiAgentCompatibility /instanceIds:8967bed4 <candidate.vsix>`, then the same installation's `devenv.exe /RootSuffix PiAgentCompatibility /UpdateConfiguration` before launch. A VS2022 suffix is independent of the same-named VS2026 suffix. Close only the owned target profile before changing its registration; do not use an installer option that shuts down other IDE instances while the VS2026 soak runs. Copy top-level fixture source files including `global.json` and marker to a dedicated root, set the three acceptance environment variables, and launch its solution with that VS2022 executable. Installation/profile commands are instructions for the acceptance owner, not actions performed by fixture preparation.

The next-stage opt-in marker fields are `testProject` (a loaded VSTest project path), `publishProject` (a loaded C#/VB project path for a fresh local `dotnet publish` output) and `profile:true` (restart the fixture under its VS debugger, then collect CPU, GC and a GC comparison, each requested for two seconds). Profiling requires the official `dotnet-trace` tool and the bundled analyzer; missing prerequisites fail the requested case. It captures an idle fixture app, which proves integration and does not measure improvement. Publishing executes project build targets and never runs a remote publish profile.

Optional marker `configuration` and `platform` select the exact native targeted build (including soak builds); defaults remain `Debug` and `Any CPU`. The C++ fixture uses `x64`, matching its solution and project configurations. `expectedProjectKind` adds an actual context assertion for the VC project kind. Copy all top-level C++ fixture files to a fresh isolated root, set the same three acceptance environment variables, and open its solution in the owned VS2022 experimental profile. A successful direct MSBuild/`--verify` run is preparation evidence, not the native IDE receipt.

Each designer operation verifies the specific created/deleted control or saved event hookup plus generated handler. Before restore, exact generated files are retained under `piagent-designer-stages/<operation>-<id>/*.snapshot`, with a manifest mapping to original paths. The extra suffix prevents SDK projects from compiling these copies. The receipt retains stage evidence even if a postcondition or restore fails; copy snapshots over a fresh fixture's corresponding files to independently build/run that stage.

For an automated native soak, add `soakMinutes:240` and optionally `soakBuild:true`. After ordinary acceptance, the same opted-in IDE revalidates the fixture root/marker/solution and samples public native context/catalog every five seconds, with a targeted build initially and every ten minutes. `piagent-vs-soak.receipt.json` updates each sample and records completion only after the requested duration. Cancellation, a changed solution or a failed guard stops it. This is an automated observation/build soak, not four hours of human usage or editor model inference. Use a dedicated experimental IDE process so another acceptance run does not change its solution.
