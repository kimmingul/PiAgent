using System;
using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;
namespace PiAgent.Vsix;
[Guid("9f34de92-7135-48a1-861d-9f89601bc657")]
public sealed class ChatToolWindow : ToolWindowPane
{
    public ChatToolWindow() : base(null) { Caption = "PiAgent Chat"; Content = new ChatControl(); }
    protected override void Dispose(bool disposing)
    {
        if (disposing && Content is IDisposable disposable) disposable.Dispose();
        base.Dispose(disposing);
    }
}
