using System;
using System.Threading;
using System.IO;
using System.Text;
using PiAgent.Transport;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Threading.Tasks;

Console.OutputEncoding = new UTF8Encoding(false);
var name = args.Length > 0 ? args[0] : "piagent-dev";
var version = args.Length > 1 ? args[1] : "2022";
using var client = new PipeAdapterClient(name);
using var cancellation = new CancellationTokenSource();
var mode = args.Length > 2 ? args[2] : "normal";
if (mode == "credential") { Console.WriteLine(client.AuthenticationCredentialPath); return; }
if (mode == "bootstrap") { cancellation.CancelAfter(30000);await CoreRuntime.EnsureRunningAsync(name,cancellation.Token);Console.WriteLine("Core bootstrap connected");return; }
if(mode=="suspend"){
    cancellation.CancelAfter(15000);await client.InitializeAsync("visual-studio",version,"suspend-smoke",cancellation.Token);
    var ping=client.PingAsync("sleep-fixture",cancellation.Token);await Task.Delay(500);client.SuspendRequestTimeouts(true);
    await Task.Delay(6000);client.SuspendRequestTimeouts(false);await ping;
    Console.WriteLine("{\"survivedSuspension\":true}");return;
}
if (mode == "slow-ack") {
    cancellation.CancelAfter(20000);
    await client.InitializeAsync("visual-studio",version,"slow-ack",cancellation.Token,chat:true);
    var opened=await client.RequestAsync("chat.open",new JObject(),cancellation.Token);
    var watch=System.Diagnostics.Stopwatch.StartNew();
    var reply=await client.RequestAsync("chat.prompt",new JObject {["sessionId"]=opened["sessionId"],["message"]="slow-ack"},cancellation.Token);
    await client.PingAsync("still-connected",cancellation.Token);
    await client.RequestAsync("chat.close",new JObject {["sessionId"]=opened["sessionId"]},cancellation.Token);
    Console.WriteLine(new JObject {["accepted"]=reply["accepted"],["elapsedMs"]=watch.ElapsedMilliseconds,["connected"]=true}.ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));return;
}
if (mode == "controls")
{
    cancellation.CancelAfter(60000);
    var hello = await client.InitializeAsync("visual-studio", version, "controls-smoke", cancellation.Token, chat:true, writes:true);
    if (!hello["capabilities"]!.ToString().Contains("workspace.bind.v1") || !hello["capabilities"]!.ToString().Contains("chat.approval.v1")) throw new IOException("Control capabilities unavailable");
    var opened = await client.RequestAsync("chat.open", new JObject { ["workspaceUri"] = args[3] }, cancellation.Token);
    var saved = (string?)opened["savedSessionId"];
    var workspace = (string?)opened["workspaceUri"];
    var modes = new JArray();
    foreach (var access in new[] { "write", "yolo", "plan", "always-ask" }) {
        opened = await client.RequestAsync("chat.setApproval", new JObject { ["sessionId"] = opened["sessionId"], ["mode"] = access }, cancellation.Token);
        if ((string?)opened["approvalMode"] != access || (string?)opened["savedSessionId"] != saved || (string?)opened["workspaceUri"] != workspace) throw new IOException("Control lost session/workspace");
        modes.Add(access);
    }
    var extensions = await client.RequestAsync("chat.extensions", new JObject { ["sessionId"] = opened["sessionId"], ["action"] = "listExtensions" }, cancellation.Token);
    await client.RequestAsync("chat.close", new JObject { ["sessionId"] = opened["sessionId"] }, cancellation.Token);
    Console.WriteLine(new JObject { ["workspaceUri"] = workspace, ["modes"] = modes, ["plugins"] = extensions["plugins"], ["savedSessionPreserved"] = true }.ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>())); return;
}
if (mode == "ui-services")
{
    cancellation.CancelAfter(30000);
    await client.InitializeAsync("visual-studio", version, "ui-services-smoke", cancellation.Token, chat:true, writes:true);
    var opened=await client.RequestAsync("chat.open",new JObject {["workspaceUri"]=args[3]},cancellation.Token);
    var sid=opened["sessionId"];
    async Task<JObject> Call(string method,JObject? fields=null) {var parameters=fields??new JObject();parameters["sessionId"]=sid;return await client.RequestAsync(method,parameters,cancellation.Token);}
    var prefs=await Call("chat.preferences");var values=(JObject)prefs["values"]!;values["fontSize"]=17;
    var saved=await Call("chat.preferences",new JObject {["values"]=values});if((int?)saved["values"]?["fontSize"]!=17)throw new IOException("Preferences not applied");
    var files=await Call("workspace.files");if(files["items"] is not JArray)throw new IOException("Files missing");
    var export=await Call("chat.export");if(!File.Exists((string)export["path"]!))throw new IOException("Export missing");
    var side=await Call("btw.ask",new JObject {["text"]="side question"});if((bool?)side["accepted"]!=true)throw new IOException("BTW rejected");
    await Call("btw.cancel",new JObject {["topicId"]=side["topicId"]});
    var topics=await Call("btw.list");if(topics["items"] is not JArray)throw new IOException("BTW list missing");
    await Call("btw.delete",new JObject {["topicId"]=side["topicId"]});
    var commands=await Call("omp.control",new JObject {["command"]="get_available_commands",["fields"]=new JObject()});if(commands["commands"] is not JArray)throw new IOException("Commands missing");
    await Call("chat.close");Console.WriteLine("{\"preferences\":true,\"files\":true,\"export\":true,\"btw\":true,\"commands\":true}");return;
}
if (mode == "changes")
{
    var approval = new TaskCompletionSource<JObject>(TaskCreationOptions.RunContinuationsAsynchronously);
    var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    client.Notification += frame => {
        var data = (JObject)frame["params"]!;
        if ((string?)data["kind"] == "approval_requested") approval.TrySetResult((JObject)data["approval"]!);
        if ((string?)data["kind"] == "completed") completed.TrySetResult(true);
        if ((string?)data["kind"] == "error") { var error = new IOException((string?)data["text"]); approval.TrySetException(error); completed.TrySetException(error); }
    };
    cancellation.CancelAfter(20000);
    await client.InitializeAsync("visual-studio", version, "approval-smoke", cancellation.Token, chat:true, writes:true);
    var opened = await client.RequestAsync("chat.open", new JObject(), cancellation.Token);
    if ((bool?)opened["writeEnabled"] != true) throw new IOException("Write capability unavailable");
    var session = (string?)opened["sessionId"];
    await client.RequestAsync("chat.prompt", new JObject { ["sessionId"] = session, ["message"] = "propose-edit" }, cancellation.Token);
    var preview = await approval.Task.WaitAsync(cancellation.Token);
    if (!((string?)preview["diff"] ?? "").Contains("+int Double")) throw new IOException("Missing preview");
    var applied = await client.RequestAsync("changes.decide", new JObject { ["sessionId"] = session, ["proposalId"] = preview["proposalId"], ["revision"] = preview["revision"], ["decision"] = "approve" }, cancellation.Token);
    await completed.Task.WaitAsync(cancellation.Token);
    var restore = await client.RequestAsync("changes.previewRestore", new JObject { ["sessionId"] = session, ["checkpointId"] = applied["checkpointId"] }, cancellation.Token);
    var result = await client.RequestAsync("changes.restore", new JObject { ["sessionId"] = session, ["checkpointId"] = restore["checkpointId"], ["revision"] = restore["revision"] }, cancellation.Token);
    Console.WriteLine(new JObject { ["applied"] = applied["applied"], ["restored"] = result["restored"] }.ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>())); return;
}
if (mode == "chat" || mode == "context" || mode == "workspace")
{
    var completed = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
    var cancelled = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    var text = new StringBuilder();
    client.Notification += frame => {
        var data = (JObject)frame["params"]!;
        switch ((string?)data["kind"]) {
            case "delta": text.Append((string?)data["text"]); break;
            case "completed": completed.TrySetResult(text.ToString()); break;
            case "cancelled": cancelled.TrySetResult(true); break;
            case "error": completed.TrySetException(new IOException((string?)data["text"])); break;
        }
    };
    cancellation.CancelAfter(10000);
    await client.InitializeAsync("visual-studio", version, "chat-smoke", cancellation.Token, chat: true, selectionContext: mode == "context");
    var opened = await client.RequestAsync("chat.open", new JObject(), cancellation.Token);
    if (mode == "workspace" && (bool?)opened["readOnly"] != true) throw new IOException("Workspace capability not enabled");
    var session = (string?)opened["sessionId"];
    var prompt = new JObject { ["sessionId"] = session, ["message"] = mode == "workspace" ? "workspace-read" : "hello" };
    if (mode == "context") prompt["context"] = new JObject {
        ["documentUri"] = "file:///D:/workspace/Example.cs", ["language"] = "CSharp",
        ["selection"] = new JObject { ["text"] = "// 안녕 🚀", ["startLine"] = 1, ["startColumn"] = 1, ["endLine"] = 1, ["endColumn"] = 9 }
    };
    await client.RequestAsync("chat.prompt", prompt, cancellation.Token);
    await client.PingAsync("during-chat", cancellation.Token);
    var answer = await completed.Task.WaitAsync(cancellation.Token);
    var turn = (string?)(await client.RequestAsync("chat.prompt", new JObject { ["sessionId"] = session, ["message"] = "wait" }, cancellation.Token))["turnId"];
    await client.RequestAsync("chat.cancel", new JObject { ["sessionId"] = session, ["turnId"] = turn }, cancellation.Token);
    await cancelled.Task.WaitAsync(cancellation.Token);
    await client.RequestAsync("chat.close", new JObject { ["sessionId"] = session }, cancellation.Token);
    Console.WriteLine(new JObject { ["text"] = answer, ["cancelled"] = true }.ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>())); return;
}
if (mode == "cancel") cancellation.CancelAfter(100);
if (mode != "normal")
{
    try
    {
        await client.InitializeAsync("visual-studio", version, "failure-test", cancellation.Token);
        throw new Exception("Expected adapter failure");
    }
    catch (Exception error) when ((mode == "cancel" && cancellation.IsCancellationRequested
        && (error is OperationCanceledException || error is ObjectDisposedException || error is IOException))
        || (mode == "badframe" && error is InvalidDataException))
    { Console.WriteLine("expected-failure: " + mode); return; }
}
try
{
    await client.PingAsync("before-hello", CancellationToken.None);
    throw new Exception("Ping must require handshake");
}
catch (InvalidOperationException) { }
Console.WriteLine((await client.InitializeAsync("visual-studio", version, $"csharp-smoke-{Environment.ProcessId}", CancellationToken.None)).ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));
Console.WriteLine((await client.PingAsync("PiAgent 안녕 🚀", CancellationToken.None)).ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));
