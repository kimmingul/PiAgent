using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;

namespace PiAgent.Vsix;

/// <summary>
/// Keeps the WebView controller attached when VS moves a tool window between HWNDs.
/// The SDK WPF wrapper caches the initial Window and uninitializes on its Closed
/// event, even after docking has moved the control into a different Window.
/// HwndHost reparents its child HWND without recreating it. The controller must also
/// be told about that move before VS destroys the former floating parent window.
/// </summary>
internal sealed class ChatWebView : HwndHost
{
    private readonly TaskCompletionSource<IntPtr> windowReady = new TaskCompletionSource<IntPtr>();
    private CoreWebView2Controller? controller;
    private Task? initialization;
    private bool disposed;

    public CoreWebView2? CoreWebView2 => controller?.CoreWebView2;
    public double ZoomFactor {
        get => controller?.ZoomFactor ?? 1;
        set { if(controller==null)throw new InvalidOperationException("WebView is not initialized");controller.ZoomFactor=value; }
    }
    public Uri? Source { set { if (value != null) CoreWebView2!.Navigate(value.AbsoluteUri); } }

    public ChatWebView()
    {
        Focusable = true;
        // Registered after HwndHost's handler, so Handle already has its new parent.
        PresentationSource.AddSourceChangedHandler(this, OnSourceChanged);
        IsVisibleChanged += OnVisibilityChanged;
    }

    public Task EnsureCoreWebView2Async(CoreWebView2Environment environment) =>
        initialization ??= InitializeAsync(environment);

    private async Task InitializeAsync(CoreWebView2Environment environment)
    {
        // The HWND is supplied by WPF layout on this same UI dispatcher.
#pragma warning disable VSTHRD003
        var hwnd = await windowReady.Task;
#pragma warning restore VSTHRD003
        if (disposed) throw new ObjectDisposedException(nameof(ChatWebView));
        var created = await environment.CreateCoreWebView2ControllerAsync(hwnd);
        if (disposed) { created.Close(); throw new ObjectDisposedException(nameof(ChatWebView)); }
        controller = created;
        controller.MoveFocusRequested += OnMoveFocusRequested;
        AttachController();
        UpdateWindowPos();
    }

    protected override HandleRef BuildWindowCore(HandleRef parent)
    {
        var hwnd = CreateWindowEx(0, "static", "", 0x56000000, 0, 0, 0, 0,
            parent.Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); // CHILD | VISIBLE | CLIPCHILDREN | CLIPSIBLINGS
        if (hwnd == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        windowReady.TrySetResult(hwnd);
        return new HandleRef(this, hwnd);
    }

    private void OnSourceChanged(object sender, SourceChangedEventArgs args) => AttachController();

    private void AttachController()
    {
        if (disposed || controller == null || Handle == IntPtr.Zero) return;
        // Assign even when Handle is unchanged: its ancestor HWND has changed.
        controller.ParentWindow = Handle;
        controller.NotifyParentWindowPositionChanged();
        controller.IsVisible = IsVisible && PresentationSource.FromVisual(this) != null;
    }

    private void OnVisibilityChanged(object sender, DependencyPropertyChangedEventArgs args)
    {
        if (!disposed && controller != null) controller.IsVisible = IsVisible;
    }

    protected override void OnWindowPositionChanged(Rect bounds)
    {
        base.OnWindowPositionChanged(bounds);
        if (disposed || controller == null) return;
        controller.Bounds = new Rectangle(0, 0, Math.Max(0, (int)Math.Round(bounds.Width)), Math.Max(0, (int)Math.Round(bounds.Height)));
        controller.NotifyParentWindowPositionChanged();
    }

    protected override bool TabIntoCore(TraversalRequest request)
    {
        if (controller == null || disposed) return false;
        controller.MoveFocus(request.FocusNavigationDirection == FocusNavigationDirection.Previous
            ? CoreWebView2MoveFocusReason.Previous : CoreWebView2MoveFocusReason.Next);
        return true;
    }

    private void OnMoveFocusRequested(object? sender, CoreWebView2MoveFocusRequestedEventArgs args)
    {
        args.Handled = MoveFocus(new TraversalRequest(args.Reason == CoreWebView2MoveFocusReason.Previous
            ? FocusNavigationDirection.Previous : FocusNavigationDirection.Next));
    }

    protected override IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wp, IntPtr lp, ref bool handled)
    {
        if (msg == 0x0007 && !disposed && controller != null) // WM_SETFOCUS
            controller.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
        return base.WndProc(hwnd, msg, wp, lp, ref handled);
    }

    protected override void DestroyWindowCore(HandleRef hwnd)
    {
        if (controller != null) { controller.Close(); controller = null; }
        DestroyWindow(hwnd.Handle);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposed) return;
        disposed = true;
        if (disposing)
        {
            PresentationSource.RemoveSourceChangedHandler(this, OnSourceChanged);
            IsVisibleChanged -= OnVisibilityChanged;
            windowReady.TrySetCanceled();
            if (controller != null) { controller.MoveFocusRequested -= OnMoveFocusRequested; controller.Close(); controller = null; }
        }
        base.Dispose(disposing);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(int extendedStyle, string className, string title, int style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyWindow(IntPtr hwnd);
}
