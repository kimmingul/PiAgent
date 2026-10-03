using System;
using System.Threading;
using System.IO;
using System.Text;
using PiAgent.Transport;
using Newtonsoft.Json;

Console.OutputEncoding = new UTF8Encoding(false);
var name = args.Length > 0 ? args[0] : "piagent-dev";
var version = args.Length > 1 ? args[1] : "2022";
using var client = new PipeAdapterClient(name);
using var cancellation = new CancellationTokenSource();
var mode = args.Length > 2 ? args[2] : "normal";
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
