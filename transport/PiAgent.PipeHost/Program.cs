using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Microsoft.Win32.SafeHandles;

// Windows transport only. No JSON-RPC, IDE, model or workspace logic lives here.
internal static class Program
{
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateNamedPipeW(string name, uint mode, uint pipeMode, uint instances, uint output, uint input, uint timeout, ref SecurityAttributes attributes);
    private static readonly ConcurrentDictionary<int, NamedPipeServerStream> Peers = new();
    private static readonly Channel<string> Output = Channel.CreateBounded<string>(new BoundedChannelOptions(128) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    private static readonly CancellationTokenSource Lifetime = new();
    private static string Sid = "";
    private static NamedPipeServerStream NewPipe(string name, bool first)
    {
        // Protected DACL: this user only, explicitly deny network logons. Reject remote clients at creation.
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW($"O:{Sid}D:P(D;;GA;;;NU)(A;;GA;;;{Sid})", 1, out var descriptor, out _))
            throw new System.ComponentModel.Win32Exception();
        try {
            var attributes = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = descriptor };
            var handle = CreateNamedPipeW(@"\\.\pipe\" + name, 3u | 0x40000000u | (first ? 0x00080000u : 0u), 8, 255, 32768, 32768, 0, ref attributes);
            if (handle.IsInvalid) { handle.Dispose(); throw new System.ComponentModel.Win32Exception(); }
            return new NamedPipeServerStream(PipeDirection.InOut, true, false, handle);
        } finally { LocalFree(descriptor); }
    }
    private static bool Private(FileSystemSecurity security) => security.GetOwner(typeof(SecurityIdentifier))?.Value == Sid
        && security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>()
            .Where(rule => rule.AccessControlType == AccessControlType.Allow).All(rule => rule.IdentityReference.Value == Sid);
    private static string Credential(string path)
    {
        path = Path.GetFullPath(path);
        var directory = new DirectoryInfo(Path.GetDirectoryName(path)!);
        for (var parent = directory; parent != null; parent = parent.Parent)
            if (parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Credential links are forbidden");
        var security = new DirectorySecurity(); security.SetOwner(new SecurityIdentifier(Sid)); security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(Sid), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        if (!directory.Exists) directory.Create(security);
        if (!Private(directory.GetAccessControl())) throw new IOException("Credential directory ACL is not private");
        var file = new FileInfo(path);
        if (!file.Exists) {
            var fileSecurity = new FileSecurity(); fileSecurity.SetOwner(new SecurityIdentifier(Sid)); fileSecurity.SetAccessRuleProtection(true, false);
            fileSecurity.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(Sid), FileSystemRights.FullControl, AccessControlType.Allow));
            using var created = file.Create(FileMode.CreateNew, FileSystemRights.FullControl, FileShare.None, 4096, FileOptions.None, fileSecurity);
            var key = System.Text.Encoding.ASCII.GetBytes(Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant());
            created.Write(key); created.Flush(true);
        }
        file.Refresh();
        if ((file.Attributes & FileAttributes.ReparsePoint) != 0 || file.Length != 64 || !Private(file.GetAccessControl())) throw new IOException("Credential file is not private or valid");
        // Also reject hard links, including links into otherwise private directories.
        using var stream = file.Open(FileMode.Open, FileAccess.Read, FileShare.Read);
        if (!GetFileInformationByHandle(stream.SafeFileHandle, out var info) || info.Links != 1) throw new IOException("Credential file links are forbidden");
        using var reader = new StreamReader(stream);
        var token = reader.ReadToEnd(); if (!Regex.IsMatch(token, "\\A[0-9a-f]{64}\\z")) throw new IOException("Invalid credential");
        return token;
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation info);
    private static ValueTask Emit(object value) => Output.Writer.WriteAsync(JsonSerializer.Serialize(value), Lifetime.Token);
    private static async Task ReadPeer(int id, NamedPipeServerStream pipe)
    {
        try {
            await Emit(new { type = "open", id });
            var buffer = new byte[32768];
            while (!Lifetime.IsCancellationRequested) {
                var count = await pipe.ReadAsync(buffer, Lifetime.Token); if (count == 0) break;
                await Emit(new { type = "data", id, data = Convert.ToBase64String(buffer, 0, count) });
            }
        } catch (Exception error) when (error is IOException or OperationCanceledException or ObjectDisposedException) { }
        finally { Peers.TryRemove(id, out _); pipe.Dispose(); if (!Lifetime.IsCancellationRequested) await Emit(new { type = "close", id }); }
    }
    private static async Task Accept(string name, NamedPipeServerStream first)
    {
        var waiting = first; var sequence = 0;
        try {
            while (!Lifetime.IsCancellationRequested) {
                await waiting.WaitForConnectionAsync(Lifetime.Token);
                var connected = waiting;
                // Always retain a live handle: no empty-name interval in which a second listener can squat.
                waiting = NewPipe(name, false);
                if (Peers.Count >= 16) { connected.Dispose(); continue; }
                var id = ++sequence; Peers[id] = connected;
                _ = ReadPeer(id, connected);
            }
        } finally { waiting.Dispose(); }
    }
    private static async Task Input()
    {
        // Node is the sole writer. Bounded base64 chunks, serialized output writes, no TCP listener.
        using var input = new StreamReader(Console.OpenStandardInput());
        while (await input.ReadLineAsync(Lifetime.Token) is { } line) {
            if (line.Length > 50000) throw new IOException("Host input exceeded limit");
            using var json = JsonDocument.Parse(line); var root = json.RootElement;
            var type = root.GetProperty("type").GetString(); if (type == "stop") return;
            var id = root.GetProperty("id").GetInt32(); if (!Peers.TryGetValue(id, out var pipe)) continue;
            if (type == "close") { pipe.Dispose(); continue; }
            if (type != "data") throw new IOException("Invalid host command");
            var bytes = Convert.FromBase64String(root.GetProperty("data").GetString()!);
            if (bytes.Length > 32768) throw new IOException("Host chunk exceeded limit");
            try { using var deadline = CancellationTokenSource.CreateLinkedTokenSource(Lifetime.Token); deadline.CancelAfter(5000); await pipe.WriteAsync(bytes, deadline.Token); }
            catch (Exception error) when (error is IOException or OperationCanceledException or ObjectDisposedException) { pipe.Dispose(); }
        }
    }
    public static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows() || args.Length != 2 || !Regex.IsMatch(args[0], "\\A[a-zA-Z0-9_-]{1,128}\\z")) return 1;
        Sid = WindowsIdentity.GetCurrent().User!.Value;
        var stage = "credential";
        try {
            var token = Credential(args[1]);
            stage = "pipe creation";
            using var first = NewPipe(args[0], true);
            var writer = Task.Run(async () => { using var output = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true }; await foreach (var line in Output.Reader.ReadAllAsync()) await output.WriteLineAsync(line); });
            await Emit(new { type = "ready", token, securityDescriptor = first.GetAccessControl().GetSecurityDescriptorSddlForm(AccessControlSections.Access) });
            var accept = Accept(args[0], first); var input = Input();
            await Task.WhenAny(accept, input); Lifetime.Cancel();
            foreach (var pipe in Peers.Values) pipe.Dispose();
            try { await accept; } catch (OperationCanceledException) { }
            try { await input; } catch (OperationCanceledException) { }
            Output.Writer.TryComplete(); await writer; return 0;
        } catch (Exception error) { Console.Error.WriteLine($"PiAgent pipe host failed: {stage}, {error.GetType().Name}, code {error.HResult}"); return 1; }
        finally { Lifetime.Cancel(); foreach (var pipe in Peers.Values) pipe.Dispose(); }
    }
}
