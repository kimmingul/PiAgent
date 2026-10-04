using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using PiAgent.Transport;
internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        using var client = new PipeAdapterClient(args.Length > 0 ? args[0] : "piagent-dev");
        if (args.Length > 1 && args[1] == "--bootstrap") {
            using var bootDeadline = new CancellationTokenSource(30000);
            await CoreRuntime.EnsureRunningAsync(args[0], bootDeadline.Token);
        }
        Console.WriteLine("CLR " + Environment.Version + "; token file exists: " + File.Exists(client.AuthenticationCredentialPath));
        try {
            var length = File.ReadAllText(client.AuthenticationCredentialPath).Length;
            Console.WriteLine("Credential readable; length " + length);
            using var deadline = new CancellationTokenSource(15000);
            await client.InitializeAsync("test-ide", "netfx-regression", Guid.NewGuid().ToString("N"), deadline.Token);
            await client.PingAsync("netfx", deadline.Token);
            Console.WriteLine("PASS .NET Framework authenticated handshake/ping"); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }
}
