using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text.RegularExpressions;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
namespace PiAgent.Transport;

/// <summary>Windows runtime discovery/bootstrap, with no IDE or project-specific behavior.</summary>
public static class CoreRuntime
{
    private static readonly SemaphoreSlim Startup = new SemaphoreSlim(1, 1);
    private static async Task<bool> ListeningAsync(string name, CancellationToken cancellation)
    {
        using var probe = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous);
        try { await probe.ConnectAsync(100, cancellation).ConfigureAwait(false); return true; }
        catch (TimeoutException) { return false; }
        catch (IOException) { return false; }
    }
    private static string Quote(string value)
    {
        var result = new StringBuilder("\""); var slashes = 0;
        foreach (var character in value) {
            if (character == '\\') { slashes++; continue; }
            result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            result.Append(character); slashes = 0;
        }
        result.Append('\\', slashes * 2); return result.Append('"').ToString();
    }
    public static async Task EnsureRunningAsync(string pipeName, CancellationToken cancellation)
    {
        if (!Regex.IsMatch(pipeName, @"\A[a-zA-Z0-9_-]{1,128}\z")) throw new ArgumentException("Invalid pipe name");
        await Startup.WaitAsync(cancellation).ConfigureAwait(false);
        try {
            using var client = new PipeAdapterClient(pipeName);
            if (await ListeningAsync(pipeName, cancellation).ConfigureAwait(false)) {
                if (!File.Exists(client.AuthenticationCredentialPath)) throw new IOException("기존 Core가 이전 인증 경로를 사용하고 있습니다. PiAgent Core를 종료한 뒤 다시 연결해 주세요.");
                return;
            }
            var local = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var root = Path.GetFullPath(Path.Combine(local, "Programs", "PiAgent"));
            var receiptPath = Path.Combine(root, "install-receipt.json");
            if (!File.Exists(receiptPath)) throw new IOException("PiAgent Core 설치를 찾지 못했습니다. 통합 설치파일로 Core를 설치해 주세요.");
            var receipt = JObject.Parse(File.ReadAllText(receiptPath));
            var release = Path.GetFullPath((string?)receipt["Release"] ?? "");
            if ((string?)receipt["Product"] != "PiAgent.Setup.38557171-e01d-4d7b-9842-3b435c5eed83" ||
                !release.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Core 설치 기록이 올바르지 않습니다.");
            var runtime = Path.Combine(release, "core");
            var settings = JObject.Parse(File.ReadAllText(Path.Combine(runtime, "settings.json")));
            var node = Path.GetFullPath((string?)settings["node"] ?? "");
            if (!node.StartsWith(release + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(node)) throw new IOException("설치된 Node.js를 찾지 못했습니다.");
            var args = new List<string> { Path.Combine(runtime, "core.mjs"), "--pipe", pipeName, "--auth-file", client.AuthenticationCredentialPath };
            if ((string?)settings["omp"] is string omp && !string.IsNullOrWhiteSpace(omp)) { args.Add("--omp"); args.Add(omp); }
            if ((string?)settings["workspace"] is string workspace && !string.IsNullOrWhiteSpace(workspace)) { args.Add("--workspace"); args.Add(workspace); args.Add("--cwd"); args.Add(workspace); }
            if ((bool?)settings["allowWrites"] == true) args.Add("--allow-writes");
            args.Add("--omp-profile"); args.Add((string?)settings["ompProfile"] ?? "restricted");
            var arch = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE", EnvironmentVariableTarget.Machine) == "ARM64" ? "arm64" : "x64";
            var dotnet = Path.Combine(release, "runtimes", arch, "dotnet");
            var start = new ProcessStartInfo(node) { Arguments = string.Join(" ", args.ConvertAll(Quote)), WorkingDirectory = runtime, UseShellExecute = false, CreateNoWindow = true };
            start.EnvironmentVariables["PATH"] = dotnet + ";" + Environment.GetEnvironmentVariable("PATH");
            start.EnvironmentVariables.Remove("PIAGENT_DEV_PIPE");
            using var process = Process.Start(start) ?? throw new IOException("PiAgent Core를 시작하지 못했습니다.");
            var watch = Stopwatch.StartNew();
            while (watch.Elapsed < TimeSpan.FromSeconds(20)) {
                cancellation.ThrowIfCancellationRequested();
                if (File.Exists(client.AuthenticationCredentialPath) && await ListeningAsync(pipeName, cancellation).ConfigureAwait(false)) return;
                if (process.HasExited) throw new IOException("PiAgent Core 시작에 실패했습니다. 설치된 core/settings.json을 확인해 주세요.");
                await Task.Delay(100, cancellation).ConfigureAwait(false);
            }
            throw new IOException("PiAgent Core 시작 시간이 초과되었습니다.");
        } finally { Startup.Release(); }
    }
}
