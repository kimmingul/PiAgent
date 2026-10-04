using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
namespace PiAgent.Transport;

/// <summary>Duplex connection: one reader, correlated replies, serialized writes, bounded frames.</summary>
public sealed class PipeAdapterClient : IDisposable
{
    private const int MaxFrameBytes = 1048576;
    private readonly NamedPipeClientStream pipe;
    private readonly SemaphoreSlim writes = new SemaphoreSlim(1, 1);
    private readonly UTF8Encoding utf8 = new UTF8Encoding(false, true);
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JObject>> pending = new();
    private bool ready;
    private readonly string pipeName;
    public event Action<JObject>? Notification;
    public event Action<Exception>? Disconnected;
    public string AuthenticationCredentialPath
    {
        get
        {
            var explicitPath = Environment.GetEnvironmentVariable("PIAGENT_AUTH_FILE");
            var profile = Environment.GetEnvironmentVariable("USERPROFILE");
            if (string.IsNullOrWhiteSpace(profile)) profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return explicitPath ?? Path.Combine(profile, ".piagent", "security", pipeName, "token");
        }
    }
    public PipeAdapterClient(string pipeName)
    {
        if (!Regex.IsMatch(pipeName, @"\A[a-zA-Z0-9_-]{1,128}\z")) throw new ArgumentException("Invalid pipe name");
        this.pipeName = pipeName;
        pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
    }
    public async Task<JObject> InitializeAsync(string kind, string ideVersion, string instanceId, CancellationToken cancellation, bool chat = false, bool selectionContext = false, bool writes = false, bool designers = false)
    {
        if (ready) throw new InvalidOperationException("Already initialized");
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
        {
            deadline.CancelAfter(5000);
            using (deadline.Token.Register(() => pipe.Dispose()))
                await pipe.ConnectAsync(5000, deadline.Token).ConfigureAwait(false);
        }
        _ = ReadLoopAsync();
        try { await AuthenticateAsync(cancellation).ConfigureAwait(false); }
        catch { Dispose(); throw; }
        var offered = chat ? new JArray("core.ping", "chat.v1") : new JArray("core.ping");
        if (selectionContext) { if (!chat) throw new ArgumentException("Selection context requires chat"); offered.Add("context.selection.v1"); }
        var required = (JArray)offered.DeepClone();
        if(chat) { offered.Add("chat.btw.v1"); offered.Add("chat.preferences.v1");offered.Add("chat.timeline.v1"); offered.Add("omp.controls.v1"); offered.Add("workspace.bind.v1"); offered.Add("chat.approval.v1"); }
        if(chat && designers) offered.Add("ide.designer.v1");
        if (chat) { offered.Add("chat.sessions.v1"); offered.Add("chat.usage.v1"); offered.Add("workspace.read.v1"); } // Optional; the daemon owner must opt in with --workspace.
        if (writes) { if (!chat) throw new ArgumentException("Writes require chat"); offered.Add("workspace.edit.v1"); offered.Add("workspace.edit.batch.v1"); }
        var result = await CallAsync("adapter.hello", new JObject {
            ["protocolVersions"] = new JArray(1), ["capabilities"] = offered,
            ["requiredCapabilities"] = required,
            ["adapter"] = new JObject { ["kind"] = kind, ["version"] = "0.9.0", ["ideVersion"] = ideVersion,
                ["instanceId"] = instanceId, ["capabilities"] = new JArray() }
        }, cancellation).ConfigureAwait(false);
        if ((int?)result["protocolVersion"] != 1 || result["capabilities"] is not JArray capabilities
            || !required.Values<string>().All(capability => capabilities.Values<string>().Contains(capability)))
        { Dispose(); throw new InvalidDataException("Required protocol/capability was not negotiated"); }
        ready = true; return result;
    }
    private string Proof(string token, string role, string clientNonce, string serverNonce)
    {
        var key = Enumerable.Range(0, 32).Select(index => Convert.ToByte(token.Substring(index * 2, 2), 16)).ToArray();
        using var hmac = new HMACSHA256(key);
        return BitConverter.ToString(hmac.ComputeHash(Encoding.UTF8.GetBytes("piagent." + role + ".v1\n" + pipeName + "\n" + clientNonce + "\n" + serverNonce))).Replace("-", "").ToLowerInvariant();
    }
    private async Task AuthenticateAsync(CancellationToken cancellation)
    {
        var explicitPath = Environment.GetEnvironmentVariable("PIAGENT_AUTH_FILE");
        // Match Node's credentialPath outside virtualized AppData.
        var path = AuthenticationCredentialPath;
        if (explicitPath == null && !File.Exists(path) && Environment.GetEnvironmentVariable("PIAGENT_DEV_PIPE") == "1") return;
        string token;
        try { token = File.ReadAllText(path); }
        catch (Exception error) when (error is IOException || error is UnauthorizedAccessException || error is System.Security.SecurityException)
        {
            throw new IOException($"PiAgent 인증 파일을 읽지 못했습니다: {path} ({error.GetType().Name}, 0x{error.HResult:X8}). PiAgent Core 실행 상태와 인증 경로를 확인해 주세요.", error);
        }
        if (!Regex.IsMatch(token, @"\A[0-9a-f]{64}\z")) throw new IOException("Invalid authentication credential");
        var bytes = new byte[32]; using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
        var nonce = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        var challenge = await CallAsync("core.auth.challenge", new JObject { ["clientNonce"] = nonce }, cancellation).ConfigureAwait(false);
        var server = (string?)challenge["serverNonce"]; var actual = (string?)challenge["serverProof"];
        if ((string?)challenge["scheme"] != "hmac-sha256.v1" || server == null || !Regex.IsMatch(server, @"\A[0-9a-f]{64}\z")
            || actual == null || !Regex.IsMatch(actual, @"\A[0-9a-f]{64}\z")) throw new IOException("Core authentication failed");
        var expected = Proof(token, "server", nonce, server); var difference = 0;
        for (var index = 0; index < 64; index++) difference |= actual[index] ^ expected[index];
        if (difference != 0) throw new IOException("Core authentication failed");
        var reply = await CallAsync("adapter.auth", new JObject { ["proof"] = Proof(token, "client", nonce, server) }, cancellation).ConfigureAwait(false);
        if ((bool?)reply["authenticated"] != true) throw new IOException("Adapter authentication failed");
    }
    public async Task<JObject> PingAsync(string nonce, CancellationToken cancellation)
    {
        if (!ready) throw new InvalidOperationException("Handshake required");
        var result = await CallAsync("core.ping", new JObject { ["nonce"] = nonce }, cancellation).ConfigureAwait(false);
        if ((bool?)result["pong"] != true || (string?)result["nonce"] != nonce)
        { Dispose(); throw new InvalidDataException("Unexpected pong/nonce"); }
        return result;
    }
    public Task<JObject> RequestAsync(string method, JObject parameters, CancellationToken cancellation)
    {
        if (!ready || !new[] { "designer.reply", "designer.decide", "omp.respond", "omp.control", "btw.ask","btw.list","btw.cancel","btw.delete","chat.preferences","workspace.files","chat.addFolder","chat.proceedPlan","chat.export","chat.previewMessageRestore","chat.restoreMessage","chat.extensions", "chat.setApproval", "chat.open", "chat.prompt", "chat.cancel", "chat.close", "changes.decide", "changes.list", "changes.previewRestore", "changes.restore", "sessions.list", "chat.usage" }.Contains(method))
            throw new InvalidOperationException("Unsupported request or handshake required");
        return CallAsync(method, parameters, cancellation, method.StartsWith("changes.", StringComparison.Ordinal) ? 60000 : new[] { "chat.open", "chat.usage", "chat.setApproval", "btw.ask","btw.list","btw.cancel","btw.delete","chat.preferences","workspace.files","chat.addFolder","chat.proceedPlan","chat.export","chat.previewMessageRestore","chat.restoreMessage","chat.extensions", "sessions.list", "omp.control" }.Contains(method) ? 60000 : 5000);
    }
    private async Task<JObject> CallAsync(string method, JObject parameters, CancellationToken cancellation, int timeout = 5000)
    {
        if (pending.Count >= 16) throw new IOException("Too many pending RPC requests");
        var id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!pending.TryAdd(id, completion)) throw new InvalidOperationException();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation, lifetime.Token);
        deadline.CancelAfter(timeout);
        using var registration = deadline.Token.Register(() => Fail(new OperationCanceledException("Pipe request cancelled or timed out")));
        try
        {
            var body = utf8.GetBytes(new JObject { ["jsonrpc"] = "2.0", ["id"] = id,
                // VS 2022 can bind Newtonsoft.Json to a version without the one-argument overload.
                ["method"] = method, ["params"] = parameters }.ToString(Formatting.None, Array.Empty<JsonConverter>()));
            if (body.Length == 0 || body.Length > MaxFrameBytes) throw new InvalidDataException("Invalid frame length");
            var header = new byte[4];
            for (var i = 0; i < 4; i++) header[i] = (byte)((uint)body.Length >> (i * 8));
            await writes.WaitAsync(deadline.Token).ConfigureAwait(false);
            try
            {
                await pipe.WriteAsync(header, 0, 4, deadline.Token).ConfigureAwait(false);
                await pipe.WriteAsync(body, 0, body.Length, deadline.Token).ConfigureAwait(false);
                await pipe.FlushAsync(deadline.Token).ConfigureAwait(false);
            }
            finally { writes.Release(); }
            var reply = await completion.Task.ConfigureAwait(false);
            if (reply["error"] is JObject error) throw new IOException($"RPC {(int?)error["code"]}: {(string?)error["message"]}");
            return reply["result"] as JObject ?? throw new InvalidDataException("Expected object result");
        }
        finally { pending.TryRemove(id, out _); }
    }
    private async Task ReadLoopAsync()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                var header = new byte[4]; await ReadExactAsync(header).ConfigureAwait(false);
                var length = (uint)header[0] | ((uint)header[1] << 8) | ((uint)header[2] << 16) | ((uint)header[3] << 24);
                if (length == 0 || length > MaxFrameBytes) throw new InvalidDataException("Invalid frame length");
                var body = new byte[(int)length]; await ReadExactAsync(body).ConfigureAwait(false);
                var frame = JObject.Parse(utf8.GetString(body));
                if ((string?)frame["jsonrpc"] != "2.0") throw new InvalidDataException("Invalid RPC envelope");
                if (frame["id"] == null && (string?)frame["method"] == "chat.event" && frame["params"] is JObject)
                { Notification?.Invoke(frame); continue; }
                var id = (string?)frame["id"];
                if (id == null || (frame["result"] != null) == (frame["error"] != null) || !pending.TryRemove(id, out var completion))
                    throw new InvalidDataException("Unexpected RPC response");
                completion.TrySetResult(frame);
            }
        }
        catch (Exception error) { Fail(error); }
    }
    private async Task ReadExactAsync(byte[] bytes)
    {
        var offset = 0;
        while (offset < bytes.Length)
        {
            var count = await pipe.ReadAsync(bytes, offset, bytes.Length - offset, lifetime.Token).ConfigureAwait(false);
            if (count == 0) throw new EndOfStreamException("Core disconnected during frame");
            offset += count;
        }
    }
    private void Fail(Exception error)
    {
        ready = false; pipe.Dispose();
        foreach (var pair in pending) if (pending.TryRemove(pair.Key, out var request)) request.TrySetException(error);
        if (!lifetime.IsCancellationRequested) { lifetime.Cancel(); Disconnected?.Invoke(error); }
    }
    public void Dispose() { Fail(new ObjectDisposedException(nameof(PipeAdapterClient))); }
}
