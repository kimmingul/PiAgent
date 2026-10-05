using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using PiAgent.Vsix;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var baseline = Array.IndexOf(args, "--baseline") >= 0;
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var window = new Window { Title = "PiAgent WebView docking regression", Width = 500, Height = 400, ShowInTaskbar = false };
        var fixedView = baseline ? null : new ChatWebView();
        var oldView = baseline ? new WebView2() : null;
        FrameworkElement view = (FrameworkElement?)fixedView ?? oldView!;
        Func<CoreWebView2> core = () => (baseline ? oldView!.CoreWebView2 : fixedView!.CoreWebView2)
            ?? throw new Exception("WebView controller lost after parent window transition");
        window.Content = view;
        var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(45) };
        timeout.Tick += (_, __) => { Console.Error.WriteLine("FAIL: timeout"); app.Shutdown(1); };
        timeout.Start();
        window.Loaded += async (_, __) => {
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null,
                    Path.Combine(Path.GetTempPath(), "PiAgent-WebViewSmoke", Guid.NewGuid().ToString("N")));
                if (fixedView != null) await fixedView.EnsureCoreWebView2Async(environment);
                else await oldView!.EnsureCoreWebView2Async(environment);
                var navigation = new TaskCompletionSource<bool>();
                core().NavigationCompleted += (_, e) => navigation.TrySetResult(e.IsSuccess);
                var uiIndex = Array.IndexOf(args, "--ui");
                if (uiIndex >= 0) {
                    core().SetVirtualHostNameToFolderMapping("piagent.local", Path.GetFullPath(args[uiIndex + 1]), CoreWebView2HostResourceAccessKind.DenyCors);
                    await core().AddScriptToExecuteOnDocumentCreatedAsync("window.smokeErrors=[];window.addEventListener('error',e=>smokeErrors.push(e.message));window.addEventListener('unhandledrejection',e=>smokeErrors.push(String(e.reason)));window.addEventListener('securitypolicyviolation',e=>smokeErrors.push(e.violatedDirective));");
                    core().Navigate("https://piagent.local/chat.html");
                } else core().NavigateToString("<html><body><textarea id='draft'></textarea><script>window.marker=42;document.getElementById('draft').value='도킹 전 초안';</script></body></html>");
                if (!await navigation.Task) throw new Exception("Navigation failed");
                if (uiIndex >= 0) await UiSmoke.Run(core(),async()=> {
                    var previewIndex=Array.IndexOf(args,"--settings-preview");
                    for(int layout=0;layout<3;layout++) {
                        window.Width=layout==0?880:340;window.Height=760;
                        if(fixedView!=null)fixedView.ZoomFactor=layout==2?2:layout==1?1.5:1;
                        else oldView!.ZoomFactor=layout==2?2:layout==1?1.5:1;
                        await FlushLayout();await Task.Delay(120);
                        var fits=await core().ExecuteScriptAsync("(()=>{const f=document.querySelector('.settings-footer').getBoundingClientRect(),c=document.querySelector('.settings-content').getBoundingClientRect(),tabs=[...document.querySelectorAll('.settings-tab')].map(t=>t.getBoundingClientRect());return f.bottom<=innerHeight+1&&f.left>=0&&f.right<=innerWidth+1&&c.height>=60&&document.querySelector('.piagent-settings').scrollWidth<=innerWidth&&tabs.every(t=>Math.abs(t.top-tabs[0].top)<1)})()");
                        if(fits!="true")throw new Exception("Settings layout clips controls at layout "+layout+": "+await core().ExecuteScriptAsync("JSON.stringify({width:innerWidth,height:innerHeight,footer:document.querySelector('.settings-footer').getBoundingClientRect(),content:document.querySelector('.settings-content').getBoundingClientRect()})"));
                        Console.WriteLine("PASS settings layout "+layout+": horizontal tabs, scrollable content, footer within viewport");
                        if(previewIndex>=0){var folder=Path.GetFullPath(args[previewIndex+1]);Directory.CreateDirectory(folder);using(var output=File.Create(Path.Combine(folder,"settings-"+layout+".png")))await core().CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,output);}
                        if(previewIndex>=0){await core().ExecuteScriptAsync("document.getElementById('settings-tab-1').click()");await FlushLayout();var folder=Path.GetFullPath(args[previewIndex+1]);using(var output=File.Create(Path.Combine(folder,"account-"+layout+".png")))await core().CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,output);await core().ExecuteScriptAsync("document.getElementById('settings-tab-0').click()");}
                    }
                    if(fixedView!=null)fixedView.ZoomFactor=1;else oldView!.ZoomFactor=1;
                    window.Width=500;window.Height=400;await FlushLayout();
                });
                var browserId = core().BrowserProcessId;
                for (var index = 0; index < 4; index++)
                {
                    // Mirrors VS: move a live control, then destroy the old floating HWND.
                    var next = new Window { Title = window.Title, Width = 500 + index * 20, Height = 400, ShowInTaskbar = false };
                    next.Show(); window.Content = null; next.Content = view;
                    await FlushLayout(); window.Close(); window = next;
                    await Task.Delay(250);
                    await AssertState(core(), browserId, "reparent/close " + index);
                    var tabs = new TabControl();
                    window.Content = null;
                    var chat = new TabItem { Header = "Chat", Content = view };
                    tabs.Items.Add(chat); tabs.Items.Add(new TabItem { Header = "Solution", Content = new TextBlock { Text = "Solution" } });
                    window.Content = tabs;
                    tabs.SelectedIndex = 1; await FlushLayout();
                    tabs.SelectedIndex = 0; await FlushLayout();
                    await AssertState(core(), browserId, "tab switch " + index);
                    chat.Content = null; window.Content = view;
                    view.Visibility = Visibility.Collapsed; await FlushLayout();
                    view.Visibility = Visibility.Visible; await FlushLayout();
                    await AssertState(core(), browserId, "hide/show " + index);
                }
                Console.WriteLine("PASS: 12 docking/tab/hide transitions preserve browser, DOM and Korean draft");
                (view as IDisposable)?.Dispose(); window.Close(); app.Shutdown(0);
            }
            catch (Exception error) { Console.Error.WriteLine("FAIL: " + error); (view as IDisposable)?.Dispose(); app.Shutdown(1); }
        };
        window.Show();
        return app.Run();
    }

    private static async Task FlushLayout() => await Dispatcher.CurrentDispatcher.InvokeAsync(() => { }, DispatcherPriority.ApplicationIdle);
    private static async Task AssertState(CoreWebView2 core, uint browserId, string step)
    {
        if (core.BrowserProcessId != browserId) throw new Exception(step + ": browser was replaced");
        var value = await core.ExecuteScriptAsync("window.marker===42 && (document.getElementById('draft')||document.getElementById('input')).value==='도킹 전 초안'");
        if (value != "true") throw new Exception(step + ": document state lost: " + value);
        Console.WriteLine("PASS: " + step);
    }
}
