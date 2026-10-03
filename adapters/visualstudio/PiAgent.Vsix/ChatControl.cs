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
using Microsoft.Web.WebView2.Wpf;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PiAgent.Transport;
namespace PiAgent.Vsix;

public sealed class ChatControl : UserControl, IDisposable
{
    private readonly JoinableTaskCollection jobs;
    private readonly JoinableTaskFactory factory;
    private const string Page = "https://piagent.local/chat.html";
    private readonly WebView2 browser = new WebView2();
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private readonly DispatcherTimer heartbeat = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
    private PipeAdapterClient? client;
    private string? sessionId;
    private string? turnId;
    private bool initialized, connecting, pageReady, disposed;
    public ChatControl()
    {
        jobs = ThreadHelper.JoinableTaskFactory.Context.CreateCollection(); factory = ThreadHelper.JoinableTaskFactory.Context.CreateFactory(jobs); Content = browser; Loaded += OnLoaded;
        heartbeat.Tick += (sender, args) => factory.RunAsync(async () => {
            var active = client;
            if (active == null || sessionId == null || disposed) return;
            try { await active.PingAsync("heartbeat", lifetime.Token); }
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
            browser.CoreWebView2.SetVirtualHostNameToFolderMapping("piagent.local", folder, CoreWebView2HostResourceAccessKind.DenyCors);
            browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            browser.CoreWebView2.NavigationStarting += (s, e) => { if (e.Uri != Page) e.Cancel = true; };
            browser.CoreWebView2.NewWindowRequested += (s, e) => e.Handled = true;
            browser.CoreWebView2.DownloadStarting += (s, e) => e.Cancel = true;
            browser.CoreWebView2.WebMessageReceived += OnMessage;
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
                case "connect": await ConnectAsync(); break;
                case "reset":
                    if (client == null || sessionId == null || turnId != null || connecting) return;
                    await client.RequestAsync("chat.close", new JObject { ["sessionId"] = sessionId }, lifetime.Token);
                    sessionId = null; await OpenAsync(); break;
                case "prompt":
                    if (client == null || sessionId == null || turnId != null) throw new IOException("Session unavailable or busy");
                    await client.RequestAsync("chat.prompt", new JObject { ["sessionId"] = sessionId, ["message"] = message["message"] }, lifetime.Token); break;
                case "cancel":
                    if (client == null || sessionId == null || turnId == null || (string?)message["turnId"] != turnId) return;
                    await client.RequestAsync("chat.cancel", new JObject { ["sessionId"] = sessionId, ["turnId"] = turnId }, lifetime.Token); break;
            }
        }
        catch (Exception error) { Post(new JObject { ["type"] = "error", ["message"] = error.Message }); }
    }
    private async Task ConnectAsync()
    {
        if (connecting || sessionId != null) return; connecting = true;
        try
        {
            var previous = client; client = null; previous?.Dispose();
            var active = new PipeAdapterClient(Environment.GetEnvironmentVariable("PIAGENT_PIPE_NAME") ?? "piagent-dev");
            client = active;
            active.Notification += frame => {
                factory.RunAsync(async () => {
                    await factory.SwitchToMainThreadAsync(lifetime.Token);
                    if (!ReferenceEquals(client, active) || disposed || frame["params"] is not JObject data) return;
                    if ((string?)data["sessionId"] != sessionId) return;
                    switch ((string?)data["kind"]) {
                        case "started": turnId = (string?)data["turnId"]; break;
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
            await active.InitializeAsync("visual-studio", "VS-Chat", Guid.NewGuid().ToString("N"), lifetime.Token, chat: true);
            await OpenAsync(); heartbeat.Start();
        }
        catch (Exception error) { Disconnect(error.Message); }
        finally { connecting = false; }
    }
    private async Task OpenAsync()
    {
        var result = await client!.RequestAsync("chat.open", new JObject(), lifetime.Token);
        sessionId = (string?)result["sessionId"] ?? throw new InvalidDataException("Missing session ID"); turnId = null;
        Post(new JObject { ["type"] = "session", ["sessionId"] = sessionId });
    }
    private void Post(JObject message)
    {
        if (!disposed && pageReady && browser.CoreWebView2 != null)
            browser.CoreWebView2.PostWebMessageAsJson(message.ToString(Formatting.None, Array.Empty<JsonConverter>()));
    }
    private void Disconnect(string message)
    {
        heartbeat.Stop(); sessionId = null; turnId = null;
        var previous = client; client = null; previous?.Dispose();
        Post(new JObject { ["type"] = "disconnected", ["message"] = message });
    }
    public void Dispose()
    {
        if (disposed) return; disposed = true; heartbeat.Stop(); lifetime.Cancel();
        var previous = client; client = null; previous?.Dispose(); browser.Dispose(); jobs.JoinTillEmptyAsync().FileAndForget("PiAgent/ChatShutdown");
    }
}
