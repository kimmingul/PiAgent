using System;
using System.ComponentModel.Design;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using PiAgent.Transport;

namespace PiAgent.Vsix;

[PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
[ProvideMenuResource("Menus.ctmenu", 1)]
[ProvideToolWindow(typeof(ChatToolWindow))]
[ProvideOptionPage(typeof(EditorOptions),"PiAgent","Editor Suggestions",0,0,true)]
[ProvideAutoLoad(UIContextGuids80.SolutionExists,PackageAutoLoadFlags.BackgroundLoad)]
[Guid("38557171-e01d-4d7b-9842-3b435c5eed83")]
public sealed class PiAgentPackage : AsyncPackage
{
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private int running;
    private int acceptanceAutorun;

    protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
    {
        await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        ((EditorOptions)GetDialogPage(typeof(EditorOptions))).LoadSettingsFromStorage();
        if (await GetServiceAsync(typeof(IMenuCommandService)) is OleMenuCommandService commands)
        {
            if (IdeAcceptanceHarness.Enabled) commands.AddCommand(new MenuCommand((sender, args) =>
                JoinableTaskFactory.RunAsync(async () => await IdeAcceptanceHarness.RunAsync(lifetime.Token)).FileAndForget("PiAgent/FixtureAcceptance"),
                new CommandID(new Guid("e648642e-3b01-454a-a5f5-77ab0b763a90"), 0x0106)));
            var editorCommands=new[]{"completion","next-edit","accept","dismiss"};
            for(var index=0;index<editorCommands.Length;index++){
                var action=editorCommands[index];
                commands.AddCommand(new MenuCommand((sender,args)=>JoinableTaskFactory.RunAsync(async()=>await EditorSuggestions.CommandAsync(action,lifetime.Token)).FileAndForget("PiAgent/EditorCommand"),new CommandID(new Guid("e648642e-3b01-454a-a5f5-77ab0b763a90"),0x0102+index)));
            }
            commands.AddCommand(new MenuCommand((sender, args) =>
            {
                if (Interlocked.CompareExchange(ref running, 1, 0) == 0)
                    JoinableTaskFactory.RunAsync(CheckConnectionAsync).FileAndForget("PiAgent/Connection");
            }, new CommandID(new Guid("e648642e-3b01-454a-a5f5-77ab0b763a90"), 0x0100)));
            commands.AddCommand(new MenuCommand((sender, args) =>
                JoinableTaskFactory.RunAsync(async () => {
                    await ShowToolWindowAsync(typeof(ChatToolWindow), 0, true, lifetime.Token);
                }).FileAndForget("PiAgent/Chat"),
                new CommandID(new Guid("e648642e-3b01-454a-a5f5-77ab0b763a90"), 0x0101)));
        }
        if (IdeAcceptanceHarness.Enabled && Environment.GetEnvironmentVariable("PIAGENT_VS_ACCEPTANCE_AUTORUN") == "1")
            KnownUIContexts.SolutionExistsAndFullyLoadedContext.WhenActivated(() => {
                if (!lifetime.IsCancellationRequested && Interlocked.Exchange(ref acceptanceAutorun, 1) == 0)
                    JoinableTaskFactory.RunAsync(async () => {
                        // Yield after native solution activation, then revalidate the explicit fixture.
                        await Task.Delay(500, lifetime.Token);
                        await IdeAcceptanceHarness.RunAsync(lifetime.Token);
                    }).FileAndForget("PiAgent/FixtureAcceptanceAutorun");
            });
    }

    private async Task CheckConnectionAsync()
    {
        string message;
        try
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(lifetime.Token);
            var shell = await GetServiceAsync(typeof(SVsShell)) as IVsShell;
            string ideVersion = "Visual Studio";
            if (shell != null && ErrorHandler.Succeeded(shell.GetProperty((int)__VSSPROPID5.VSSPROPID_ReleaseVersion, out var version)))
                ideVersion = Convert.ToString(version) ?? ideVersion;
            var name = Environment.GetEnvironmentVariable("PIAGENT_PIPE_NAME") ?? "piagent-dev";
            await CoreRuntime.EnsureRunningAsync(name, lifetime.Token);
            // Ensure the complete transport operation starts away from the IDE UI thread.
            message = await Task.Run(async () =>
            {
                using (var client = new PipeAdapterClient(name))
                {
                    await client.InitializeAsync("visual-studio", ideVersion, Guid.NewGuid().ToString("N"), lifetime.Token);
                    await client.PingAsync("PiAgent 안녕 🚀", lifetime.Token);
                    return "PiAgent: handshake/capability/ping OK\r\n";
                }
            }, lifetime.Token);
        }
        catch (Exception error) { message = $"PiAgent connection failed: {error.Message}\r\n"; }
        finally { Interlocked.Exchange(ref running, 0); }
        if (lifetime.IsCancellationRequested) return;
        await JoinableTaskFactory.SwitchToMainThreadAsync(lifetime.Token);
        if (await GetServiceAsync(typeof(SVsOutputWindow)) is IVsOutputWindow output)
        {
            var paneId = new Guid("2ce7c409-e530-4d61-af8a-5f245f7c6622");
            output.CreatePane(ref paneId, "PiAgent", 1, 0);
            output.GetPane(ref paneId, out var pane);
            pane?.OutputStringThreadSafe(message);
            pane?.Activate();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) lifetime.Cancel();
        base.Dispose(disposing);
    }
}
