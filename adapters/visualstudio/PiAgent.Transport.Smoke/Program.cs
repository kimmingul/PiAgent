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
if (mode == "chat" || mode == "context")
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
    var session = (string?)(await client.RequestAsync("chat.open", new JObject(), cancellation.Token))["sessionId"];
    var prompt = new JObject { ["sessionId"] = session, ["message"] = "hello" };
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
    Console.WriteLine(new JObject { ["text"] = answer, ["cancelled"] = true }.ToString(Formatting.None)); return;
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
Console.WriteLine((await client.InitializeAsync("visual-studio", version, $"csharp-smoke-{Environment.ProcessId}", CancellationToken.None)).ToString(Formatting.None));
Console.WriteLine((await client.PingAsync("PiAgent 안녕 🚀", CancellationToken.None)).ToString(Formatting.None));
