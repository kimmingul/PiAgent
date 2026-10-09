using System;
using System.Linq;
using System.IO;
using System.Reflection;
using System.Diagnostics;
using System.Runtime.InteropServices;
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
using Microsoft.Win32;
using PiAgent.Transport;
namespace PiAgent.Vsix;

public sealed class ChatControl : UserControl, IDisposable
{
    [DllImport("user32.dll")] private static extern bool FlashWindow(IntPtr hwnd,bool invert);
    [DllImport("kernel32.dll")] private static extern ushort GetUserDefaultUILanguage();
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
    private JObject? approval, restorePreview, messageRestorePreview;
    private string? workspaceUri;
    private string currentApprovalMode="always-ask";
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string,CancellationTokenSource> ideOperations = new();
    private EnvDTE.SolutionEvents? solutionEvents;
    private bool workspaceBinding, approvalModes, ideCatalogEnabled;
    private string? lastCatalogRevision;
    private bool initialized, connecting, pageReady, disposed;
    private bool recovering, suspended;
    private int recoveryEpoch;
    public ChatControl()
    {
        jobs = ThreadHelper.JoinableTaskFactory.Context.CreateCollection(); factory = ThreadHelper.JoinableTaskFactory.Context.CreateFactory(jobs); Content = browser; Loaded += OnLoaded;
        SystemEvents.PowerModeChanged += PowerChanged;
        heartbeat.Tick += (sender, args) => factory.RunAsync(async () => {
            var active = client;
            if (active == null || sessionId == null || disposed || suspended) return;
            try { await SynchronizeWorkspaceAsync(); await active.PingAsync("heartbeat", lifetime.Token); await PublishCatalogAsync(); }
            catch (Exception error) { if (ReferenceEquals(client, active)) { Disconnect(error.Message); await RecoverAsync(); } }
        }).FileAndForget("PiAgent/Heartbeat");
    }
    private void PowerChanged(object sender, PowerModeChangedEventArgs args)
    {
        var sleep = args.Mode == PowerModes.Suspend;
        if (!sleep && args.Mode != PowerModes.Resume) return;
        client?.SuspendRequestTimeouts(sleep);
        factory.RunAsync(async () => {
            await factory.SwitchToMainThreadAsync(lifetime.Token);
            if (disposed) return;
            suspended = sleep;
            if (sleep) { heartbeat.Stop(); return; }
            var active = client;
            if (active != null && sessionId != null) {
                try { await active.PingAsync("resume", lifetime.Token); heartbeat.Start(); return; }
                catch (Exception error) { if (!ReferenceEquals(client, active)) return; Disconnect(error.Message); }
            }
            await RecoverAsync();
        }).FileAndForget("PiAgent/PowerResume");
    }
    private async Task RecoverAsync()
    {
        await factory.SwitchToMainThreadAsync(lifetime.Token);
        if (disposed || suspended || recovering || !pageReady) return;
        string workspace;
        try { workspace = CurrentWorkspaceUri(); } catch { return; }
        var epoch = recoveryEpoch; recovering = true;
        try {
            foreach (var delay in new[] { 1000, 3000, 10000 }) {
                await Task.Delay(delay, lifetime.Token); await factory.SwitchToMainThreadAsync(lifetime.Token);
                if (disposed || suspended || epoch != recoveryEpoch || sessionId != null) return;
                try { if (CurrentWorkspaceUri() != workspace) return; } catch { return; }
                if (connecting) continue;
                await ConnectAsync();
                if (sessionId != null) return;
            }
        } finally { recovering = false; }
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
        string? action=null;JToken? requestId=null,requestFields=null,requestCommand=null;
        var ownerSession=sessionId;
        try
        {
            if (args.WebMessageAsJson.Length > 400000) throw new InvalidDataException("Message exceeds limit");
            var message = JObject.Parse(args.WebMessageAsJson);
            action=(string?)message["action"];requestId=message["id"]?.DeepClone();
            requestFields=message["fields"]?.DeepClone();requestCommand=message["command"]?.DeepClone();
            switch ((string?)message["action"])
            {
                case "notify":if(!browser.IsKeyboardFocusWithin)FlashWindow(Process.GetCurrentProcess().MainWindowHandle,true);break;
                case "openFile":
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    var requested=(string?)message["path"]??throw new IOException("Missing file path");
                    var rootPath=new Uri(CurrentWorkspaceUri()).LocalPath;
                    var filePath=Path.GetFullPath(requested.StartsWith("file:",StringComparison.OrdinalIgnoreCase)?new Uri(requested).LocalPath:Path.IsPathRooted(requested)?requested:Path.Combine(rootPath,requested));
                    if(!filePath.StartsWith(Path.GetFullPath(rootPath).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!File.Exists(filePath))throw new IOException("File must exist inside the current solution workspace");
                    var ide=Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE??throw new IOException("IDE unavailable");
                    ide.ItemOperations.OpenFile(filePath);
                    var line=(int?)message["line"]??0;if(line>0&&ide.ActiveDocument?.Selection is EnvDTE.TextSelection textSelection)textSelection.GotoLine(line,false);break;
                case "openUrl":
                    var url=(string?)message["url"]??"";if(!Uri.TryCreate(url,UriKind.Absolute,out var uri)||(uri.Scheme!="https"&&uri.Scheme!="http"))throw new IOException("Only HTTP(S) URLs can be opened");
                    Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});break;
                case "copy":
                    await factory.SwitchToMainThreadAsync(lifetime.Token);var copy=(string?)message["text"]??"";if(copy.Length>1000000)throw new IOException("Clipboard text exceeds limit");Clipboard.SetText(copy);Post(new JObject {["type"]="copied",["id"]=requestId});break;
                case "listFiles":case "export":case "preferences":case "btw":case "btwList":case "btwStop":case "btwDelete":case "queuePrompt":
                    if(client==null||sessionId==null)throw new IOException("Core session unavailable");
                    var uiParams=new JObject {["sessionId"]=sessionId};string method;
                    switch(action) {
                        case "listFiles":method="workspace.files";break;
                        case "export":method="chat.export";break;
                        case "preferences":method="chat.preferences";if(message["values"]!=null)uiParams["values"]=message["values"];break;
                        case "btw":method="btw.ask";uiParams["text"]=message["text"];if(message["topicId"]?.Type==JTokenType.String)uiParams["topicId"]=message["topicId"];break;
                        case "btwList":method="btw.list";if(message["offset"]!=null)uiParams["offset"]=message["offset"];break;
                        case "btwStop":method="btw.cancel";uiParams["topicId"]=message["topicId"];break;
                        case "btwDelete":method="btw.delete";uiParams["topicId"]=message["topicId"];break;
                        default:method="omp.control";uiParams["command"]=message["command"];uiParams["fields"]=new JObject {["message"]=message["message"]};break;
                    }
                    var uiReply=await client.RequestAsync(method,uiParams,lifetime.Token);
                    if(action=="export") {
                        await factory.SwitchToMainThreadAsync(lifetime.Token);var save=new Microsoft.Win32.SaveFileDialog {Filter="HTML|*.html",FileName="PiAgent-conversation.html"};if(save.ShowDialog()==true)File.Copy((string)uiReply["path"]!,save.FileName,true);
                    } else if(action=="btw")Post(new JObject {["type"]="btwAccepted",["id"]=requestId,["ownerSessionId"]=ownerSession});
                    else if(action=="queuePrompt")Post(new JObject {["type"]="queueAccepted",["id"]=requestId,["ownerSessionId"]=ownerSession});
                    else if(action!="btwStop") {uiReply["type"]=action=="listFiles"?"files":action=="preferences"?"preferences":"btwList";uiReply["ownerSessionId"]=ownerSession;Post(uiReply);}
                    break;
                case "ready": pageReady = true; Post(new JObject {["type"]="hostLocale",["systemLanguage"]=(GetUserDefaultUILanguage() & 0x3ff)==0x12 ? "ko" : "en"}); break;
                case "proceedPlan":
                    if(client==null||sessionId==null)throw new IOException("Core unavailable");AcceptSession(await client.RequestAsync("chat.proceedPlan",new JObject {["sessionId"]=sessionId,["path"]=message["path"]},lifetime.Token));break;
                case "setApproval":
                    if(client==null||sessionId==null||turnId!=null||approval!=null)return;
                    AcceptSession(await client.RequestAsync("chat.setApproval",new JObject {["sessionId"]=sessionId,["mode"]=message["mode"]},lifetime.Token));break;
                case "addFolder":
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    if(client==null||sessionId==null||turnId!=null)throw new IOException("Wait for an idle Core session");
                    using(var folderPicker=new System.Windows.Forms.FolderBrowserDialog {Description="OMP 작업영역에 폴더 추가",SelectedPath=new Uri(CurrentWorkspaceUri()).LocalPath}) {
                        if(folderPicker.ShowDialog()==System.Windows.Forms.DialogResult.OK){var added=await client.RequestAsync("chat.addFolder",new JObject {["sessionId"]=sessionId,["path"]=folderPicker.SelectedPath},lifetime.Token);added["type"]="folderAdded";added["ownerSessionId"]=ownerSession;Post(added);}
                    }break;
                case "attachFiles":
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    if(turnId!=null)return;
                    var picker=new Microsoft.Win32.OpenFileDialog {InitialDirectory=new Uri(CurrentWorkspaceUri()).LocalPath,Multiselect=true,CheckFileExists=true};
                    if(picker.ShowDialog()==true) {
                        var items=new JArray();foreach(var selected in picker.FileNames){items.Add(new JObject {["path"]=selected,["name"]=Path.GetFileName(selected)});}
                        Post(new JObject {["type"]="attachments",["items"]=items,["ownerSessionId"]=ownerSession});
                    }break;
                case "listExtensions":case "manageExtensions":case "togglePlugin":case "toggleMcpServer":
                    if(client==null||sessionId==null||turnId!=null)return;
                    var extensions=await client.RequestAsync("chat.extensions",new JObject {["sessionId"]=sessionId,["action"]=message["action"],["id"]=message["id"],["enabled"]=message["enabled"]},lifetime.Token);
                    if(ownerSession!=sessionId)break;
                    if((string?)message["action"]=="manageExtensions") {
                        await factory.SwitchToMainThreadAsync(lifetime.Token);
                        foreach(var config in (extensions["configFiles"] as JArray??new JArray())) (Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE)?.ItemOperations.OpenFile((string)config!);
                    }
                    extensions["type"]="extensions";extensions["ownerSessionId"]=ownerSession;Post(extensions);
                    if((string?)message["action"]=="togglePlugin")AcceptSession(await client.RequestAsync("chat.setApproval",new JObject {["sessionId"]=sessionId,["mode"]=currentApprovalMode},lifetime.Token));
                    break;
                case "compile":
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    var build=(Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE)?.Solution.SolutionBuild??throw new IOException("Solution unavailable");build.Build(true);Post(new JObject {["type"]="buildResult",["success"]=build.LastBuildInfo==0,["failedProjects"]=build.LastBuildInfo});break;
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
                    Post(new JObject { ["type"] = "ompControl", ["command"] = message["command"], ["fields"]=requestFields,["data"] = controlReply,["ownerSessionId"]=ownerSession }); break;
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
                case "deleteEmptySession":
                    if (client == null || turnId != null || (bool?)message["confirmed"] != true) return;
                    var deleted = await client.RequestAsync("sessions.deleteEmpty", new JObject { ["savedSessionId"] = message["savedSessionId"], ["confirmed"] = true }, lifetime.Token);
                    Post(new JObject { ["type"] = "sessionDeleted", ["savedSessionId"] = deleted["savedSessionId"] }); break;
                case "resumeSession":
                    if (client == null || sessionId == null || turnId != null || approval != null) return;
                    await client.RequestAsync("chat.close", new JObject { ["sessionId"] = sessionId }, lifetime.Token);
                    sessionId = null; await OpenAsync((string?)message["savedSessionId"]); break;
                case "usage":
                    if (client == null || sessionId == null || turnId != null) return;
                    var usage = await client.RequestAsync("chat.usage", new JObject { ["sessionId"] = sessionId }, lifetime.Token);
                    Post(new JObject { ["type"] = "usage", ["data"] = usage,["ownerSessionId"]=ownerSession }); break;
                case "prompt":
                    if (client == null || sessionId == null || turnId != null) throw new IOException("Session unavailable or busy");
                    await SynchronizeWorkspaceAsync();
                    if(sessionId!=ownerSession)throw new IOException("솔루션이 변경되었습니다. 초안을 새 프로젝트에서 다시 보내 주세요.");
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
                case "gitSetup":
                    if(action=="gitSetup"){
                        if(client==null||sessionId==null||turnId!=null)throw new IOException("Finish the current response before Git setup");
                        var gitParams=new JObject {["sessionId"]=sessionId};
                        foreach(var key in new[]{"op","previewId","revision","name","email"})if(message[key]!=null)gitParams[key]=message[key]!.DeepClone();
                        var gitReply=await client.RequestAsync("chat.git",gitParams,lifetime.Token);
                        if(ownerSession==sessionId)Post(new JObject {["type"]="gitSetup",["op"]=message["op"],["data"]=gitReply});break;
                    }
                    if (client == null || sessionId == null || turnId != null) return;
                    var history = await client.RequestAsync("changes.list", new JObject { ["sessionId"] = sessionId }, lifetime.Token);
                    Post(new JObject { ["type"] = "checkpoints", ["items"] = history["checkpoints"],["ownerSessionId"]=ownerSession }); break;
                case "previewRestore":
                    if (client == null || sessionId == null || turnId != null) return;
                    var pendingPreview = await client.RequestAsync("changes.previewRestore", new JObject { ["sessionId"] = sessionId, ["checkpointId"] = message["checkpointId"] }, lifetime.Token);
                    if(ownerSession!=sessionId)break;restorePreview=pendingPreview;
                    Post(new JObject { ["type"] = "restorePreview", ["data"] = restorePreview.DeepClone(),["ownerSessionId"]=ownerSession }); break;
                case "previewMessageRestore":
                    if(client==null||sessionId==null||turnId!=null)throw new IOException("Finish the current response before message restore");
                    var timelinePreview=await client.RequestAsync("chat.previewMessageRestore",new JObject {["sessionId"]=sessionId,["seq"]=message["seq"],["branch"]=message["branch"]??false},lifetime.Token);
                    if(ownerSession!=sessionId)break;messageRestorePreview=timelinePreview;
                    Post(new JObject {["type"]="messageRestorePreview",["data"]=timelinePreview,["ownerSessionId"]=ownerSession});break;
                case "restoreMessage":
                    if(client==null||sessionId==null||messageRestorePreview==null||(string?)message["messageRestoreId"]!=(string?)messageRestorePreview["messageRestoreId"])throw new IOException("Message preview unavailable");
                    await factory.SwitchToMainThreadAsync(lifetime.Token);EnsureTargetsSaved(messageRestorePreview);
                    if(ownerSession!=sessionId)throw new IOException("Conversation changed during message restore");
                    var restoredMessage=await client.RequestAsync("chat.restoreMessage",new JObject {["sessionId"]=sessionId,["messageRestoreId"]=messageRestorePreview["messageRestoreId"],["revision"]=messageRestorePreview["revision"]},lifetime.Token);
                    AcceptSession(restoredMessage);break;
                case "restoreChange":
                    if (client == null || sessionId == null || turnId != null || restorePreview == null || (string?)message["checkpointId"] != (string?)restorePreview["checkpointId"]) return;
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    EnsureTargetsSaved(restorePreview);
                    var restored = await client.RequestAsync("changes.restore", new JObject { ["sessionId"] = sessionId, ["checkpointId"] = restorePreview["checkpointId"], ["revision"] = restorePreview["revision"] }, lifetime.Token);
                    restorePreview = null; Post(new JObject { ["type"] = "restored", ["warning"] = restored["warning"] }); break;
                default:throw new IOException("Unsupported UI action: "+action);
            }
        }
        catch (Exception error) { Post(new JObject { ["type"] = "operationError", ["message"] = error.Message,["action"]=action,["id"]=requestId,["command"]=requestCommand,["fields"]=requestFields,["ownerSessionId"]=ownerSession }); }
    }
    private void EnsureTargetsSaved(JObject view)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        if (view["checkedPaths"] is JArray checkedPaths)
            foreach (var path in checkedPaths) EnsureTargetSaved((string?)path);
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
            var designerRetirement = new DesignerRequestRetirement();
            var ideRetirement = new DesignerRequestRetirement();
            client = active;
            active.Notification += frame => {
                // This runs on the pipe reader before waiting for a busy UI thread.
                if (frame["params"] is JObject incoming && (string?)incoming["kind"] == "omp_event" &&
                    incoming["frame"] is JObject cancellation) {
                    var cancellationType=(string?)cancellation["type"];
                    if(cancellationType=="designer_cancel"){
                        if (!designerRetirement.Retire((string?)incoming["sessionId"], (string?)cancellation["id"])) active.Dispose();return;
                    }
                    if(cancellationType=="ide_cancel"){
                        var cancelledSession=(string?)incoming["sessionId"];var cancelledId=(string?)cancellation["id"];
                        if(!ideRetirement.Retire(cancelledSession,cancelledId)){active.Dispose();return;}
                        if(ideOperations.TryGetValue(cancelledSession+"\0"+cancelledId,out var runningOperation))try{runningOperation.Cancel();}catch(ObjectDisposedException){}
                        return;
                    }
                }
                factory.RunAsync(async () => {
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    if (!ReferenceEquals(client, active) || disposed || frame["params"] is not JObject data) return;
                    if ((string?)data["sessionId"] != sessionId) return;
                    if ((string?)data["kind"] == "omp_event" && data["frame"] is JObject designerRequest && (string?)designerRequest["type"] == "designer_request") {
                        var designerSession = (string?)data["sessionId"]; var designerId = (string?)designerRequest["id"];
                        if (!designerRetirement.TryBegin(designerSession, designerId)) return;
                        var reply = new JObject { ["sessionId"] = sessionId, ["requestId"] = designerRequest["id"] };
                        try { reply["result"] = DesignerTools.Execute((string)designerRequest["operation"]!, designerRequest["args"] as JObject ?? new JObject(), workspaceUri); }
                        catch(Exception error) { reply["error"] = error.Message; }
                        if (!designerRetirement.IsRetired(designerSession, designerId) && ReferenceEquals(client, active))
                            await active.RequestAsync("designer.reply",reply,lifetime.Token);
                        return;
                    }
                    if ((string?)data["kind"] == "omp_event" && data["frame"] is JObject ideFrame) {
                        var requestId=(string?)ideFrame["id"];
                        if ((string?)ideFrame["type"]=="ide_request" && requestId!=null) {
                            var ideSession=(string?)data["sessionId"];if(!ideRetirement.TryBegin(ideSession,requestId))return;
                            using var operation=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                            var operationKey=ideSession+"\0"+requestId;ideOperations[operationKey]=operation;
                            if(ideRetirement.IsRetired(ideSession,requestId))operation.Cancel();
                            var reply=new JObject {["sessionId"]=sessionId,["requestId"]=requestId};
                            try {operation.Token.ThrowIfCancellationRequested();IdeCatalog.ValidateExpected(ideFrame["expectedState"] as JObject,workspaceUri!);var result=await IdeTools.ExecuteAsync((string)ideFrame["operation"]!,ideFrame["args"] as JObject??new JObject(),workspaceUri!,operation.Token);if(System.Text.Encoding.UTF8.GetByteCount(result.ToString(Newtonsoft.Json.Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>()))>240*1024)throw new IOException("IDE snapshot exceeds 240 KiB; narrow the query");reply["result"]=result;}
                            catch(Exception error) {reply["error"]=error is OperationCanceledException?"IDE operation cancelled":error.Message;}
                            finally {ideOperations.TryRemove(operationKey,out _);}
                            if(!operation.IsCancellationRequested&&!ideRetirement.IsRetired(ideSession,requestId)&&ReferenceEquals(client,active))await active.RequestAsync("ide.reply",reply,lifetime.Token);
                            return;
                        }
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
                designerRetirement.Close();
                ideRetirement.Close();
                foreach(var runningOperation in ideOperations.Values)try{runningOperation.Cancel();}catch(ObjectDisposedException){}
                factory.RunAsync(async () => {
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    if (!disposed && ReferenceEquals(client, active)) { Disconnect(error.Message); await RecoverAsync(); }
                }).FileAndForget("PiAgent/ChatDisconnect");
            };
            var hello = await active.InitializeAsync("visual-studio", "VS-Chat", Guid.NewGuid().ToString("N"), lifetime.Token, chat: true, selectionContext: true, writes: true, designers:true, ideTools:true);
            workspaceBinding = (hello["capabilities"] as JArray)?.ToString().Contains("workspace.bind.v1") == true;
            approvalModes = (hello["capabilities"] as JArray)?.ToString().Contains("chat.approval.v1") == true;
            ideCatalogEnabled=(hello["capabilities"] as JArray)?.Values<string>().Contains("ide.catalog.v1")==true;
            await OpenAsync(resumeLast:true); heartbeat.Start();
        }
        catch (Exception error) { Disconnect(error.Message); }
        finally { connecting = false; }
    }
    private async Task OpenAsync(string? savedId = null,bool resumeLast=false)
    {
        await factory.SwitchToMainThreadAsync(lifetime.Token);
        var parameters = new JObject();
        if(workspaceBinding)parameters["workspaceUri"]=CurrentWorkspaceUri();
        if(ideCatalogEnabled&&parameters["workspaceUri"]!=null)parameters["ideCatalog"]=IdeCatalog.Capture((string)parameters["workspaceUri"]!);
        if (savedId != null) parameters["savedSessionId"] = savedId;
        else if(resumeLast)parameters["resumeLast"]=true;
        var result = await client!.RequestAsync("chat.open", parameters, lifetime.Token);
        AcceptSession(result);
        lastCatalogRevision=(string?)result["ideCatalog"]?["revision"];
    }
    private async Task PublishCatalogAsync()
    {
        await factory.SwitchToMainThreadAsync(lifetime.Token);
        if(!ideCatalogEnabled||client==null||sessionId==null||workspaceUri==null||turnId!=null||approval!=null)return;
        var catalog=IdeCatalog.Capture(workspaceUri);var revision=(string?)catalog["revision"];
        if(revision==lastCatalogRevision)return;
        await client.RequestAsync("ide.catalog",new JObject{["sessionId"]=sessionId,["catalog"]=catalog},lifetime.Token);lastCatalogRevision=revision;
    }
    private void AcceptSession(JObject result)
    {
        sessionId = (string?)result["sessionId"] ?? throw new InvalidDataException("Missing session ID"); turnId = null;
        currentApprovalMode=(string?)result["approvalMode"]??"always-ask";
        workspaceUri = (string?)result["workspaceUri"]; approval = null; restorePreview = null;messageRestorePreview=null;
        selectionContext = null; Post(new JObject { ["type"] = "selection", ["context"] = null });
        result["type"] = "session"; result["selectionEnabled"] = true; result["attachmentsEnabled"] = true; if(!approvalModes)result.Remove("approvalModes"); Post(result);
    }
    private void SolutionClosing() {recoveryEpoch++;if(!disposed)Disconnect("솔루션이 닫혔습니다. 새 솔루션을 열면 다시 연결합니다.");}
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
        await client.RequestAsync("chat.close",new JObject {["sessionId"]=sessionId},lifetime.Token);sessionId=null;await OpenAsync(resumeLast:true);
    }
    private void Post(JObject message)
    {
        if (!disposed && pageReady && browser.CoreWebView2 != null)
            browser.CoreWebView2.PostWebMessageAsJson(message.ToString(Formatting.None, Array.Empty<JsonConverter>()));
    }
    private void Disconnect(string message)
    {
        foreach(var operation in ideOperations.Values.ToArray())operation.Cancel();
        heartbeat.Stop(); sessionId = null; turnId = null;
        approval = null; restorePreview = null;messageRestorePreview=null; workspaceUri = null;
        var previous = client; client = null; previous?.Dispose();
        Post(new JObject { ["type"] = "disconnected", ["message"] = message });
    }
    public void Dispose()
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        if (disposed) return; disposed = true; heartbeat.Stop(); lifetime.Cancel();
        SystemEvents.PowerModeChanged -= PowerChanged;
        foreach(var operation in ideOperations.Values)operation.Cancel();
        if(solutionEvents!=null){solutionEvents.Opened-=SolutionOpened;solutionEvents.BeforeClosing-=SolutionClosing;}
        var previous = client; client = null; previous?.Dispose(); browser.Dispose(); jobs.JoinTillEmptyAsync().FileAndForget("PiAgent/ChatShutdown");
    }
}
