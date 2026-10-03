using System;
using System.Text;
using EnvDTE;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class SelectionContext
{
    public static JObject Capture()
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var dte = Package.GetGlobalService(typeof(DTE)) as DTE;
        var document = dte?.ActiveDocument;
        if (document == null || !(document.Object("TextDocument") is TextDocument textDocument))
            throw new InvalidOperationException("텍스트 파일을 열고 설명받을 코드를 선택해 주세요.");
        var selection = textDocument.Selection;
        var text = selection.Text;
        if (string.IsNullOrWhiteSpace(text)) throw new InvalidOperationException("편집기에서 코드를 선택한 뒤 다시 가져와 주세요.");
        if (Encoding.UTF8.GetByteCount(text) > 32768) throw new InvalidOperationException("선택 코드는 32 KiB 이하로 줄여 주세요.");
        var file = document.FullName;
        if (string.IsNullOrWhiteSpace(file) || !System.IO.Path.IsPathRooted(file))
            throw new InvalidOperationException("파일을 저장한 뒤 다시 선택해 주세요.");
        var context = new JObject {
            ["documentUri"] = new Uri(file).AbsoluteUri, ["language"] = document.Language,
            ["selection"] = new JObject { ["text"] = text,
                ["startLine"] = selection.TopPoint.Line, ["startColumn"] = selection.TopPoint.LineCharOffset,
                ["endLine"] = selection.BottomPoint.Line, ["endColumn"] = selection.BottomPoint.LineCharOffset }
        };
        var solution = dte!.Solution.FullName;
        if (!string.IsNullOrEmpty(solution) && System.IO.Path.IsPathRooted(solution))
            context["workspaceUri"] = new Uri(System.IO.Path.GetDirectoryName(solution) + System.IO.Path.DirectorySeparatorChar).AbsoluteUri;
        return context;
    }
}
