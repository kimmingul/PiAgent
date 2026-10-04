using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Threading;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PiAgent.Transport;
namespace PiAgent.Vsix;

public sealed class ChatControl : UserControl, IDisposable
{
    private readonly JoinableTaskCollection jobs;
    private readonly JoinableTaskFactory factory;
    private const string Page = "https://piagent.local/chat.html";
    private readonly ChatWebView browser = new ChatWebView();
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private readonly DispatcherTimer heartbeat = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
    private PipeAdapterClient? client;
    private string? sessionId;
    private string? turnId;
    private JObject? selectionContext;
    private JObject? approval, restorePreview;
    private string? workspaceUri;
    private string currentApprovalMode="always-ask";
    private EnvDTE.SolutionEvents? solutionEvents;
    private bool workspaceBinding, approvalModes;
    private bool initialized, connecting, pageReady, disposed;
    public ChatControl()
    {
        jobs = ThreadHelper.JoinableTaskFactory.Context.CreateCollection(); factory = ThreadHelper.JoinableTaskFactory.Context.CreateFactory(jobs); Content = browser; Loaded += OnLoaded;
        heartbeat.Tick += (sender, args) => factory.RunAsync(async () => {
            var active = client;
            if (active == null || sessionId == null || disposed) return;
            try { await SynchronizeWorkspaceAsync(); await active.PingAsync("heartbeat", lifetime.Token); }
            catch (Exception error) { if (ReferenceEquals(client, active)) Disconnect(error.Message); }
        }).FileAndForget("PiAgent/Heartbeat");
    }
    private void OnLoaded(object sender, RoutedEventArgs args) =>
        factory.RunAsync(InitializeBrowserAsync).FileAndForget("PiAgent/WebView");
    private async Task InitializeBrowserAsync()
    {
        if (initialized || disposed) return; initialized = true;
        try
        {
            var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PiAgent", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, data);
            if (disposed) return;
            await browser.EnsureCoreWebView2Async(environment);
            if (disposed) return;
            var folder = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!, "ui");
            browser.CoreWebView2!.SetVirtualHostNameToFolderMapping("piagent.local", folder, CoreWebView2HostResourceAccessKind.DenyCors);
            browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            browser.CoreWebView2.NavigationStarting += (s, e) => { if (e.Uri != Page) e.Cancel = true; };
            browser.CoreWebView2.NewWindowRequested += (s, e) => e.Handled = true;
            browser.CoreWebView2.DownloadStarting += (s, e) => e.Cancel = true;
            browser.CoreWebView2.WebMessageReceived += OnMessage;
            await factory.SwitchToMainThreadAsync(lifetime.Token);
            var dte=Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
            solutionEvents=dte?.Events.SolutionEvents;
            if(solutionEvents!=null){solutionEvents.Opened+=SolutionOpened;solutionEvents.BeforeClosing+=SolutionClosing;}
            browser.Source = new Uri(Page);
        }
        catch (Exception error) { if (!disposed) Content = new TextBlock { Text = "PiAgent WebView2: " + error.Message, TextWrapping = TextWrapping.Wrap }; }
    }
    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args) =>
        factory.RunAsync(() => HandleMessageAsync(args)).FileAndForget("PiAgent/ChatMessage");
    private async Task HandleMessageAsync(CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (disposed || args.Source != Page) return;
        try
        {
            if (args.WebMessageAsJson.Length > 400000) throw new InvalidDataException("Message exceeds limit");
            var message = JObject.Parse(args.WebMessageAsJson);
            switch ((string?)message["action"])
            {
                case "ready": pageReady = true; break;
                case "setApproval":
                    if(client==null||sessionId==null||turnId!=null||approval!=null)return;
                    AcceptSession(await client.RequestAsync("chat.setApproval",new JObject {["sessionId"]=sessionId,["mode"]=message["mode"]},lifetime.Token));break;
                case "attachFiles":case "addFolder":
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    if(turnId!=null)return;
                    var picker=new Microsoft.Win32.OpenFileDialog {InitialDirectory=new Uri(CurrentWorkspaceUri()).LocalPath,Multiselect=(string?)message["action"]=="attachFiles",CheckFileExists=(string?)message["action"]=="attachFiles",FileName=(string?)message["action"]=="addFolder"?"이 폴더 선택":"",ValidateNames=(string?)message["action"]!="addFolder"};
                    if(picker.ShowDialog()==true) {
                        var items=new JArray();foreach(var selected in picker.FileNames){var path=(string?)message["action"]=="addFolder"?Path.GetDirectoryName(selected)!:selected; items.Add(new JObject {["path"]=path,["name"]=Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar))});}
                        Post(new JObject {["type"]="attachments",["items"]=items});
                    }break;
                case "listExtensions":case "manageExtensions":case "togglePlugin":case "toggleMcpServer":
                    if(client==null||sessionId==null||turnId!=null)return;
                    var extensions=await client.RequestAsync("chat.extensions",new JObject {["sessionId"]=sessionId,["action"]=message["action"],["id"]=message["id"],["enabled"]=message["enabled"]},lifetime.Token);
                    if((string?)message["action"]=="manageExtensions") {
                        await factory.SwitchToMainThreadAsync(lifetime.Token);
                        foreach(var config in (extensions["configFiles"] as JArray??new JArray())) (Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE)?.ItemOperations.OpenFile((string)config!);
                    }
                    extensions["type"]="extensions";Post(extensions);
                    if((string?)message["action"]=="togglePlugin")AcceptSession(await client.RequestAsync("chat.setApproval",new JObject {["sessionId"]=sessionId,["mode"]=currentApprovalMode},lifetime.Token));
                    break;
                case "compile":
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    (Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE)?.Solution.SolutionBuild.Build(false);break;
                case "designerDecide":
                    if(client == null || sessionId == null) return;
                    await client.RequestAsync("designer.decide",new JObject { ["sessionId"]=sessionId,["proposalId"]=message["proposalId"],["approved"]=message["approved"] },lifetime.Token); break;
                case "ompRespond":
                    if(client == null || sessionId == null) return;
                    await client.RequestAsync("omp.respond",new JObject { ["sessionId"]=sessionId,["requestId"]=message["requestId"],["answer"]=message["answer"] },lifetime.Token); break;
                case "ompControl":
                    if (client == null || sessionId == null) return;
                    var controlReply = await client.RequestAsync("omp.control", new JObject {
                        ["sessionId"] = sessionId, ["command"] = message["command"], ["fields"] = message["fields"] ?? new JObject()
                    }, lifetime.Token);
                    Post(new JObject { ["type"] = "ompControl", ["command"] = message["command"], ["data"] = controlReply }); break;
                case "captureSelection":
                    if (turnId != null) return;
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    selectionContext = null;
                    Post(new JObject { ["type"] = "selection", ["context"] = null });
                    selectionContext = SelectionContext.Capture();
                    Post(new JObject { ["type"] = "selection", ["context"] = selectionContext.DeepClone() }); break;
                case "clearSelection":
                    if (turnId != null) return;
                    selectionContext = null; Post(new JObject { ["type"] = "selection", ["context"] = null }); break;
                case "connect": await ConnectAsync(); break;
                case "reset":
                    if (client == null || sessionId == null || turnId != null || connecting) return;
                    await client.RequestAsync("chat.close", new JObject { ["sessionId"] = sessionId }, lifetime.Token);
                    sessionId = null; await OpenAsync(); break;
                case "listSessions":
                    if (client == null || turnId != null) return;
                    var sessions = await client.RequestAsync("sessions.list", new JObject(), lifetime.Token);
                    Post(new JObject { ["type"] = "sessions", ["sessions"] = sessions["sessions"] }); break;
                case "resumeSession":
                    if (client == null || sessionId == null || turnId != null || approval != null) return;
                    await client.RequestAsync("chat.close", new JObject { ["sessionId"] = sessionId }, lifetime.Token);
                    sessionId = null; await OpenAsync((string?)message["savedSessionId"]); break;
                case "usage":
                    if (client == null || sessionId == null || turnId != null) return;
                    var usage = await client.RequestAsync("chat.usage", new JObject { ["sessionId"] = sessionId }, lifetime.Token);
                    Post(new JObject { ["type"] = "usage", ["data"] = usage }); break;
                case "prompt":
                    if (client == null || sessionId == null || turnId != null) throw new IOException("Session unavailable or busy");
                    await SynchronizeWorkspaceAsync();
                    var parameters = new JObject { ["sessionId"] = sessionId, ["message"] = message["message"],["attachments"]=message["attachments"]??new JArray() };
                    var attached = selectionContext;
                    // Only the host-captured snapshot can cross the pipe; WebView cannot supply arbitrary context.
                    if (attached != null) parameters["context"] = attached.DeepClone();
                    await client.RequestAsync("chat.prompt", parameters, lifetime.Token);
                    if (ReferenceEquals(selectionContext, attached)) {
                        selectionContext = null; Post(new JObject { ["type"] = "selection", ["context"] = null });
                    }
                    break;
                case "cancel":
                    if (client == null || sessionId == null || turnId == null || (string?)message["turnId"] != turnId) return;
                    await client.RequestAsync("chat.cancel", new JObject { ["sessionId"] = sessionId, ["turnId"] = turnId }, lifetime.Token); break;
                case "decideChange":
                    if (client == null || sessionId == null || approval == null || (string?)message["proposalId"] != (string?)approval["proposalId"]) return;
                    var decision = (string?)message["decision"];
                    if (decision != "approve" && decision != "reject") throw new IOException("Invalid decision");
                    if (decision == "approve") { await factory.SwitchToMainThreadAsync(lifetime.Token); EnsureTargetsSaved(approval); }
                    await client.RequestAsync("changes.decide", new JObject { ["sessionId"] = sessionId, ["proposalId"] = approval["proposalId"], ["revision"] = approval["revision"], ["decision"] = decision }, lifetime.Token); break;
                case "listCheckpoints":
                    if (client == null || sessionId == null || turnId != null) return;
                    var history = await client.RequestAsync("changes.list", new JObject { ["sessionId"] = sessionId }, lifetime.Token);
                    Post(new JObject { ["type"] = "checkpoints", ["items"] = history["checkpoints"] }); break;
                case "previewRestore":
                    if (client == null || sessionId == null || turnId != null) return;
                    restorePreview = await client.RequestAsync("changes.previewRestore", new JObject { ["sessionId"] = sessionId, ["checkpointId"] = message["checkpointId"] }, lifetime.Token);
                    Post(new JObject { ["type"] = "restorePreview", ["data"] = restorePreview.DeepClone() }); break;
                case "restoreChange":
                    if (client == null || sessionId == null || turnId != null || restorePreview == null || (string?)message["checkpointId"] != (string?)restorePreview["checkpointId"]) return;
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    EnsureTargetsSaved(restorePreview);
                    var restored = await client.RequestAsync("changes.restore", new JObject { ["sessionId"] = sessionId, ["checkpointId"] = restorePreview["checkpointId"], ["revision"] = restorePreview["revision"] }, lifetime.Token);
                    restorePreview = null; Post(new JObject { ["type"] = "restored", ["warning"] = restored["warning"] }); break;
            }
        }
        catch (Exception error) { Post(new JObject { ["type"] = "operationError", ["message"] = error.Message }); }
    }
    private void EnsureTargetsSaved(JObject view)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        if (view["files"] is JArray files) {
            foreach (var file in files) EnsureTargetSaved((string?)file["path"]);
        } else EnsureTargetSaved((string?)view["path"]);
    }
    private void EnsureTargetSaved(string? relativePath)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        if (workspaceUri == null || relativePath == null) throw new IOException("Workspace unavailable");
        var root = Path.GetFullPath(new Uri(workspaceUri).LocalPath).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(Path.Combine(root, relativePath));
        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException("Invalid workspace file");
        var dte = Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
        if (dte == null) throw new IOException("IDE document state unavailable");
        foreach (EnvDTE.Document document in dte.Documents)
            if (string.Equals(document.FullName, target, StringComparison.OrdinalIgnoreCase) && !document.Saved)
                throw new IOException("대상 파일의 편집기 변경 내용을 먼저 저장한 뒤 새 변경안을 요청해 주세요.");
    }
    private async Task ConnectAsync()
    {
        if (connecting || sessionId != null) return; connecting = true;
        try
        {
            var previous = client; client = null; previous?.Dispose();
            var pipeName = Environment.GetEnvironmentVariable("PIAGENT_PIPE_NAME") ?? "piagent-dev";
            await CoreRuntime.EnsureRunningAsync(pipeName, lifetime.Token);
            var active = new PipeAdapterClient(pipeName);
            client = active;
            active.Notification += frame => {
                factory.RunAsync(async () => {
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    if (!ReferenceEquals(client, active) || disposed || frame["params"] is not JObject data) return;
                    if ((string?)data["sessionId"] != sessionId) return;
                    if ((string?)data["kind"] == "omp_event" && data["frame"] is JObject designerRequest && (string?)designerRequest["type"] == "designer_request") {
                        var reply = new JObject { ["sessionId"] = sessionId, ["requestId"] = designerRequest["id"] };
                        try { reply["result"] = DesignerTools.Execute((string)designerRequest["operation"]!, designerRequest["args"] as JObject ?? new JObject(), workspaceUri); }
                        catch(Exception error) { reply["error"] = error.Message; }
                        await active.RequestAsync("designer.reply",reply,lifetime.Token); return;
                    }
                    switch ((string?)data["kind"]) {
                        case "started": turnId = (string?)data["turnId"]; break;
                        case "approval_requested": approval = data["approval"] as JObject; break;
                        case "approval_resolved": approval = null; break;
                        case "completed": case "cancelled": case "error": turnId = null; break;
                        case "closed": sessionId = null; turnId = null; break;
                    }
                    Post(new JObject { ["type"] = "event", ["data"] = data.DeepClone() });
                }).FileAndForget("PiAgent/ChatEvent");
            };
            active.Disconnected += error => {
                factory.RunAsync(async () => {
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    if (!disposed && ReferenceEquals(client, active)) Disconnect(error.Message);
                }).FileAndForget("PiAgent/ChatDisconnect");
            };
            var hello = await active.InitializeAsync("visual-studio", "VS-Chat", Guid.NewGuid().ToString("N"), lifetime.Token, chat: true, selectionContext: true, writes: true, designers:true);
            workspaceBinding = (hello["capabilities"] as JArray)?.ToString().Contains("workspace.bind.v1") == true;
            approvalModes = (hello["capabilities"] as JArray)?.ToString().Contains("chat.approval.v1") == true;
            await OpenAsync(); heartbeat.Start();
        }
        catch (Exception error) { Disconnect(error.Message); }
        finally { connecting = false; }
    }
    private async Task OpenAsync(string? savedId = null)
    {
        await factory.SwitchToMainThreadAsync(lifetime.Token);
        var parameters = new JObject();
        if(workspaceBinding)parameters["workspaceUri"]=CurrentWorkspaceUri();
        if (savedId != null) parameters["savedSessionId"] = savedId;
        var result = await client!.RequestAsync("chat.open", parameters, lifetime.Token);
        AcceptSession(result);
    }
    private void AcceptSession(JObject result)
    {
        sessionId = (string?)result["sessionId"] ?? throw new InvalidDataException("Missing session ID"); turnId = null;
        currentApprovalMode=(string?)result["approvalMode"]??"always-ask";
        workspaceUri = (string?)result["workspaceUri"]; approval = null; restorePreview = null;
        selectionContext = null; Post(new JObject { ["type"] = "selection", ["context"] = null });
        result["type"] = "session"; result["selectionEnabled"] = true; result["attachmentsEnabled"] = true; if(!approvalModes)result.Remove("approvalModes"); Post(result);
    }
    private void SolutionClosing() {if(!disposed)Disconnect("솔루션이 닫혔습니다. 새 솔루션을 열면 다시 연결합니다.");}
    private void SolutionOpened() {if(!disposed&&pageReady)factory.RunAsync(ConnectAsync).FileAndForget("PiAgent/SolutionOpened");}
    private string CurrentWorkspaceUri()
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var dte=Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
        if(dte?.Solution.IsOpen!=true||string.IsNullOrWhiteSpace(dte.Solution.FullName))throw new IOException("솔루션을 먼저 열어 주세요. Core 저장소로 대신 연결하지 않습니다.");
        return new Uri(Path.GetDirectoryName(Path.GetFullPath(dte.Solution.FullName))!).AbsoluteUri;
    }
    private async Task SynchronizeWorkspaceAsync()
    {
        if(!workspaceBinding||client==null||sessionId==null)return;
        await factory.SwitchToMainThreadAsync(lifetime.Token);
        var current=CurrentWorkspaceUri();
        if(string.Equals(current,workspaceUri,StringComparison.OrdinalIgnoreCase))return;
        if(turnId!=null||approval!=null)throw new IOException("솔루션이 변경되었습니다. 현재 응답을 중지한 뒤 새 대화를 시작해 주세요.");
        await client.RequestAsync("chat.close",new JObject {["sessionId"]=sessionId},lifetime.Token);sessionId=null;await OpenAsync();
    }
    private void Post(JObject message)
    {
        if (!disposed && pageReady && browser.CoreWebView2 != null)
            browser.CoreWebView2.PostWebMessageAsJson(message.ToString(Formatting.None, Array.Empty<JsonConverter>()));
    }
    private void Disconnect(string message)
    {
        heartbeat.Stop(); sessionId = null; turnId = null;
        approval = null; restorePreview = null; workspaceUri = null;
        var previous = client; client = null; previous?.Dispose();
        Post(new JObject { ["type"] = "disconnected", ["message"] = message });
    }
    public void Dispose()
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        if (disposed) return; disposed = true; heartbeat.Stop(); lifetime.Cancel();
        if(solutionEvents!=null){solutionEvents.Opened-=SolutionOpened;solutionEvents.BeforeClosing-=SolutionClosing;}
        var previous = client; client = null; previous?.Dispose(); browser.Dispose(); jobs.JoinTillEmptyAsync().FileAndForget("PiAgent/ChatShutdown");
    }
}
