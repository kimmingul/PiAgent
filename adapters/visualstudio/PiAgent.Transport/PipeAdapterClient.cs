using System;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PiAgent.Transport;

/// <summary>One connection, serial requests, bounded frames and cancellation. No VS SDK dependency.</summary>
public sealed class PipeAdapterClient : IDisposable
{
    private const int MaxFrameBytes = 1048576;
    private readonly NamedPipeClientStream pipe;
    private readonly SemaphoreSlim calls = new SemaphoreSlim(1, 1);
    private readonly UTF8Encoding utf8 = new UTF8Encoding(false, true);
    private bool ready;

    public PipeAdapterClient(string pipeName)
    {
        if (!Regex.IsMatch(pipeName, @"\A[a-zA-Z0-9_-]{1,128}\z")) throw new ArgumentException("Invalid pipe name");
        pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
    }

    public async Task<JObject> InitializeAsync(string kind, string ideVersion, string instanceId, CancellationToken cancellation)
    {
        if (ready) throw new InvalidOperationException("Already initialized");
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
        {
            deadline.CancelAfter(TimeSpan.FromSeconds(5));
            using (deadline.Token.Register(() => pipe.Dispose()))
                await pipe.ConnectAsync(5000, deadline.Token).ConfigureAwait(false);
        }
        var result = await CallAsync("adapter.hello", new JObject
        {
            ["protocolVersions"] = new JArray(1),
            ["capabilities"] = new JArray("core.ping"),
            ["requiredCapabilities"] = new JArray("core.ping"),
            ["adapter"] = new JObject
            {
                ["kind"] = kind, ["version"] = "0.1.0", ["ideVersion"] = ideVersion,
                ["instanceId"] = instanceId, ["capabilities"] = new JArray()
            }
        }, cancellation).ConfigureAwait(false);
        if ((int?)result["protocolVersion"] != 1 || result["capabilities"] is not JArray capabilities
            || !capabilities.Values<string>().Contains("core.ping"))
        {
            Dispose(); throw new InvalidDataException("Required protocol/capability was not negotiated");
        }
        ready = true;
        return result;
    }

    public async Task<JObject> PingAsync(string nonce, CancellationToken cancellation)
    {
        if (!ready) throw new InvalidOperationException("Handshake required");
        var result = await CallAsync("core.ping", new JObject { ["nonce"] = nonce }, cancellation).ConfigureAwait(false);
        if ((bool?)result["pong"] != true || (string?)result["nonce"] != nonce)
        {
            Dispose(); throw new InvalidDataException("Unexpected pong/nonce");
        }
        return result;
    }

    private async Task<JObject> CallAsync(string method, JObject parameters, CancellationToken cancellation)
    {
        await calls.WaitAsync(cancellation).ConfigureAwait(false);
        try
        {
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
            {
                deadline.CancelAfter(TimeSpan.FromSeconds(5));
                using (deadline.Token.Register(() => pipe.Dispose()))
                {
                    var id = Guid.NewGuid().ToString("N");
                    var body = utf8.GetBytes(new JObject { ["jsonrpc"] = "2.0", ["id"] = id,
                        ["method"] = method, ["params"] = parameters }.ToString(Formatting.None));
                    if (body.Length == 0 || body.Length > MaxFrameBytes) throw new InvalidDataException("Invalid frame length");
                    var header = new byte[4];
                    for (var i = 0; i < 4; i++) header[i] = (byte)((uint)body.Length >> (i * 8));
                    await pipe.WriteAsync(header, 0, 4, deadline.Token).ConfigureAwait(false);
                    await pipe.WriteAsync(body, 0, body.Length, deadline.Token).ConfigureAwait(false);
                    await pipe.FlushAsync(deadline.Token).ConfigureAwait(false);
                    await ReadExactAsync(header, deadline.Token).ConfigureAwait(false);
                    var length = (uint)header[0] | ((uint)header[1] << 8) | ((uint)header[2] << 16) | ((uint)header[3] << 24);
                    if (length == 0 || length > MaxFrameBytes) throw new InvalidDataException("Invalid frame length");
                    body = new byte[(int)length];
                    await ReadExactAsync(body, deadline.Token).ConfigureAwait(false);
                    var reply = JObject.Parse(utf8.GetString(body));
                    if ((string?)reply["jsonrpc"] != "2.0" || (string?)reply["id"] != id
                        || (reply["result"] != null) == (reply["error"] != null)) throw new InvalidDataException("Invalid RPC response");
                    if (reply["error"] is JObject error) throw new IOException($"RPC {(int?)error["code"]}: {(string?)error["message"]}");
                    return reply["result"] as JObject ?? throw new InvalidDataException("Expected object result");
                }
            }
        }
        catch { ready = false; pipe.Dispose(); throw; }
        finally { calls.Release(); }
    }

    private async Task ReadExactAsync(byte[] bytes, CancellationToken cancellation)
    {
        var offset = 0;
        while (offset < bytes.Length)
        {
            var count = await pipe.ReadAsync(bytes, offset, bytes.Length - offset, cancellation).ConfigureAwait(false);
            if (count == 0) throw new EndOfStreamException("Core disconnected during frame");
            offset += count;
        }
    }

    public void Dispose() { ready = false; pipe.Dispose(); }
}
