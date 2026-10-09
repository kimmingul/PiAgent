using System;
using System.ComponentModel;
using System.ComponentModel.Design;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using EnvDTE;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

/// <summary>Public IDE APIs only. Modern out-of-process WinForms never pretends to expose IDesignerHost.</summary>
internal static class DesignerTools
{
    private static readonly string[] XamlProperties = { "Width", "Height", "MinWidth", "MinHeight", "Margin", "Opacity", "HorizontalAlignment", "VerticalAlignment", "Visibility", "Grid.Row", "Grid.Column" };
    internal static JObject Execute(string operation, JObject args, string? workspaceUri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var dte = Package.GetGlobalService(typeof(DTE)) as DTE ?? throw new IOException("IDE unavailable");
        var document = dte.ActiveDocument ?? throw new IOException("Open the target form or XAML document first");
        CheckWorkspace(document.FullName, workspaceUri);
        if (operation == "inspect") return Bounded(Inspect(document));
        if (new[] { "previewChange", "applyChange", "previewRestoreChange", "restoreChange" }.Contains(operation))
            return Bounded(IdeDesignerChanges.Execute(operation, args, workspaceUri!, dte, document));
        if (operation != "setProperty") throw new IOException("Unsupported designer operation");
        if (!document.Saved || !string.Equals(document.FullName, (string?)args["document"], StringComparison.OrdinalIgnoreCase)) throw new IOException("Designer document changed or has unsaved edits; inspect again");
        var snapshot = Inspect(document);
        if ((bool?)snapshot["canSetProperty"] != true || (string?)snapshot["revision"] != (string?)args["revision"]) throw new IOException("Designer revision changed; inspect and approve again");
        var component = ((JArray)snapshot["components"]!).OfType<JObject>().SingleOrDefault(item => (string?)item["id"] == (string?)args["component"]);
        var property = component?["properties"]?.OfType<JObject>().SingleOrDefault(item => (string?)item["name"] == (string?)args["property"] && (bool?)item["writable"] == true);
        if (property == null) throw new IOException("Property is not writable");
        var value = (string?)args["value"] ?? throw new IOException("Missing property value");
        if (value.Length > 4096) throw new IOException("Property value too large");
        if (((string?)snapshot["framework"])?.EndsWith("-xaml", StringComparison.Ordinal) == true)
            SetXaml(dte, document, (string)args["component"]!, (string)args["property"]!, value);
        else SetNative(document, (string)args["component"]!, (string)args["property"]!, value);
        return new JObject { ["applied"] = true, ["document"] = document.FullName, ["revision"] = Inspect(document)["revision"], ["validation"] = "saved; build and visual verification still required" };
    }
    private static void CheckWorkspace(string path, string? workspaceUri)
    {
        if (workspaceUri == null) throw new IOException("Workspace unavailable");
        IdeTools.ResolveFile(workspaceUri,path);
        var root = Path.GetFullPath(new Uri(workspaceUri).LocalPath).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!Path.GetFullPath(path).StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException("Active designer is outside the Core workspace; connect Core to this project first");
        for (var current = Path.GetFullPath(path); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Linked designer paths are unsupported");
    }
    private static bool IsWinForms(IComponent? component)
    {
        for (var type = component?.GetType(); type != null; type = type.BaseType)
            if (type.FullName == "System.Windows.Forms.Control") return true;
        return false;
    }
    internal static JObject Bounded(JObject result)
    {
        if (Encoding.UTF8.GetByteCount(result.ToString(Newtonsoft.Json.Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>())) > 220 * 1024) throw new IOException("Designer snapshot exceeds limit; narrow the document first");
        return result;
    }
    private static string Hash(string text)
    {
        using var hash = SHA256.Create(); return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").ToLowerInvariant();
    }
    private static XDocument Xml(string text)
    {
        using var reader = XmlReader.Create(new StringReader(text), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 1024 * 1024 });
        return XDocument.Load(reader, LoadOptions.PreserveWhitespace | LoadOptions.SetLineInfo);
    }
    internal static TextDocument Text(Document document) { ThreadHelper.ThrowIfNotOnUIThread(); return document.Object("TextDocument") as TextDocument ?? throw new IOException("Text buffer unavailable"); }
    internal static string Read(Document document) { ThreadHelper.ThrowIfNotOnUIThread(); var buffer = Text(document); return buffer.StartPoint.CreateEditPoint().GetText(buffer.EndPoint); }
    internal static IDesignerHost? Host(Document document)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        try { return document.ActiveWindow.Object as IDesignerHost; } catch { return null; }
    }
    private static string XamlFramework(Document document)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var projectFile = document.ProjectItem?.ContainingProject?.FullName;
        if (string.IsNullOrEmpty(projectFile) || !File.Exists(projectFile)) return "unknown-xaml";
        var project = Xml(File.ReadAllText(projectFile));
        if (project.Descendants().Any(x => x.Name.LocalName == "UseWinUI" && x.Value.Trim().Equals("true", StringComparison.OrdinalIgnoreCase))) return "winui3-xaml";
        if (project.Descendants().Any(x => x.Name.LocalName == "UseWPF" && x.Value.Trim().Equals("true", StringComparison.OrdinalIgnoreCase))) return "wpf-xaml";
        return "unknown-xaml";
    }
    private static bool IsWinFormsProject(Document document)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var path = document.ProjectItem?.ContainingProject?.FullName;
        return !string.IsNullOrEmpty(path) && File.Exists(path) && Xml(File.ReadAllText(path)).Descendants().Any(x => x.Name.LocalName == "UseWindowsForms" && x.Value.Trim().Equals("true", StringComparison.OrdinalIgnoreCase));
    }
    internal static JObject Inspect(Document document)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var components = new JArray(); var result = new JObject { ["schemaVersion"] = 2, ["supportedOperations"] = new JArray(), ["document"] = document.FullName, ["components"] = components, ["canSetProperty"] = false };
        if (Path.GetExtension(document.FullName).Equals(".xaml", StringComparison.OrdinalIgnoreCase))
        {
            var text = Read(document); if (text.Length > 512 * 1024) throw new IOException("XAML buffer exceeds designer limit");
            var xml = Xml(text); var framework = XamlFramework(document); var index = 0;
            var elements = xml.Root!.DescendantsAndSelf().ToArray();
            if (elements.Length > 512) throw new IOException("XAML hierarchy exceeds designer limit");
            foreach (var element in elements)
            {
                var properties = new JArray();
                var names = XamlProperties.Concat(new[] { "Text", "Content", "Title", "Background", "Foreground", "FontSize", "Padding" }).Where(name => element.Attribute(name) != null);
                foreach (var name in names) properties.Add(new JObject { ["name"] = name, ["value"] = (string?)element.Attribute(name) ?? "", ["writable"] = !((string?)element.Attribute(name) ?? "").StartsWith("{", StringComparison.Ordinal) });
                components.Add(new JObject { ["id"] = (index++).ToString(CultureInfo.InvariantCulture), ["name"] = (string?)element.Attribute(XName.Get("Name", "http://schemas.microsoft.com/winfx/2006/xaml")) ?? element.Name.LocalName, ["type"] = element.Name.LocalName,
                    ["namespace"] = element.Name.NamespaceName, ["nodeKind"] = element.Name.LocalName.Contains(".") ? "property-element" : "object-element",
                    ["parentId"] = element.Parent == null ? "" : Array.IndexOf(elements, element.Parent).ToString(CultureInfo.InvariantCulture),
                    ["references"] = new JArray(element.Attributes().Where(a => a.Name.LocalName == "Command" || a.Value.StartsWith("{", StringComparison.Ordinal)).Select(a => new JObject { ["name"] = a.Name.ToString(), ["expression"] = a.Value, ["writable"] = false })),
                    ["allowedParentIds"] = new JArray(), ["events"] = new JArray(XamlStructureEdits.Events(element.Name.LocalName)), ["properties"] = properties });
            }
            result["framework"] = framework; result["revision"] = Hash(text); result["canSetProperty"] = document.Saved && framework != "unknown-xaml";
            result["hierarchyKind"] = "xaml-syntax-tree";
            if ((bool)result["canSetProperty"]!) {
                result["supportedOperations"] = new JArray("setProperty", "createComponent", "deleteComponent", "previewChange", "applyChange", "previewRestoreChange", "restoreChange");
                if (File.Exists(document.FullName + ".cs")) ((JArray)result["supportedOperations"]!).Add("bindEvent");
                result["creatableTypes"] = new JArray(XamlStructureEdits.Types.Where(t => framework != "winui3-xaml" || !new[] { "DockPanel", "WrapPanel" }.Contains(t)));
                result["recovery"] = new JObject { ["supported"] = true, ["scope"] = "source_and_form", ["backend"] = "XAML and C# source journal" };
            }
            result["backend"] = "XAML source buffer";
            result["mode"] = framework == "winui3-xaml" ? "XAML buffer + Hot Reload/Live Visual Tree; no visual designer API" : "XAML buffer + designer reload"; return result;
        }
        var host = Host(document);
        if (host == null || !IsWinForms(host.RootComponent))
        {
            result["framework"] = IsWinFormsProject(document) ? "winforms" : "unavailable"; result["reason"] = "No public IDesignerHost on the active document. Modern WinForms out-of-process designer requires a separate supported bridge."; return result;
        }
        if (host.Container.Components.Count > 256) throw new IOException("WinForms hierarchy exceeds designer limit");
        foreach (IComponent component in host.Container.Components)
        {
            var properties = new JArray();
            foreach (PropertyDescriptor property in TypeDescriptor.GetProperties(component))
            {
                var type = property.PropertyType;
                if (!property.IsBrowsable || !(type.IsPrimitive || type.IsEnum || type == typeof(string)) || property.Name == "Name") continue;
                try { properties.Add(new JObject { ["name"] = property.Name, ["value"] = property.Converter.ConvertToInvariantString(property.GetValue(component)), ["writable"] = !property.IsReadOnly && property.Converter.CanConvertFrom(typeof(string)) }); } catch { }
                if (properties.Count >= 128) break;
            }
            var parent = TypeDescriptor.GetProperties(component)["Parent"]?.GetValue(component) as IComponent;
            var references = new JArray();
            foreach (PropertyDescriptor property in TypeDescriptor.GetProperties(component))
                if (typeof(IComponent).IsAssignableFrom(property.PropertyType))
                    try { references.Add(new JObject { ["name"] = property.Name, ["target"] = (property.GetValue(component) as IComponent)?.Site?.Name ?? "", ["writable"] = false }); } catch { }
            components.Add(new JObject { ["id"] = component.Site?.Name, ["type"] = component.GetType().FullName, ["parentId"] = parent?.Site?.Name ?? "", ["references"] = references, ["allowedParentIds"] = new JArray(), ["properties"] = properties });
        }
        result["framework"] = "winforms-framework"; result["hierarchyKind"] = "designer-component-parentage"; result["revision"] = Hash(components.ToString(Newtonsoft.Json.Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>())); result["canSetProperty"] = document.Saved && !host.Loading;
        var stem=Path.ChangeExtension(document.FullName,null);
        var journalAvailable=Path.GetExtension(document.FullName).Equals(".cs",StringComparison.OrdinalIgnoreCase) && !stem.EndsWith(".Designer",StringComparison.OrdinalIgnoreCase) && IdeDesignerChanges.CanReviewNativeRecovery(document.FullName);
        if(!journalAvailable)result["structuralUnavailableReason"]="Saved source/form/resource originals must fit the bounded complete restoration review";
        if ((bool)result["canSetProperty"]!) result["supportedOperations"] = new JArray("setProperty");
        if ((bool)result["canSetProperty"]! && journalAvailable) {
            result["supportedOperations"] = new JArray("setProperty", "createComponent", "deleteComponent", "previewChange", "applyChange", "previewRestoreChange", "restoreChange");
            if (host.GetService(typeof(IEventBindingService)) != null) ((JArray)result["supportedOperations"]!).Add("bindEvent");
            result["creatableTypes"] = new JArray(IdeDesignerChanges.NativeTypes);
            result["recovery"] = new JObject { ["supported"] = true, ["scope"] = "source_and_form", ["backend"] = "saved source/form/resx journal" };
        }
        result["backend"] = "public IDesignerHost"; return result;
    }
    private static void SetXaml(DTE dte, Document document, string component, string property, string value)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var replacement=ReplaceXamlAttribute(Read(document),component,property,value);
        if (dte.UndoContext.IsOpen) throw new IOException("Another IDE edit transaction is active");
        dte.UndoContext.Open("PiAgent designer property");
        try { var text = Text(document); text.StartPoint.CreateEditPoint().ReplaceText(text.EndPoint, replacement, (int)vsEPReplaceTextOptions.vsEPReplaceTextKeepMarkers); document.Save(); }
        catch { dte.UndoContext.SetAborted(); throw; }
        finally { dte.UndoContext.Close(); }
    }
    internal static string ReplaceXamlAttribute(string source,string component,string property,string value)
    {
        XmlConvert.VerifyXmlChars(value);var xml=Xml(source);
        if(!int.TryParse(component,out var index)||index<0)throw new IOException("Invalid XAML component");
        var target=xml.Root!.DescendantsAndSelf().ElementAtOrDefault(index)??throw new IOException("XAML component disappeared");
        var attribute=target.Attribute(property)??throw new IOException("Only an existing scalar XAML attribute can be changed");
        if(attribute.Value.StartsWith("{",StringComparison.Ordinal))throw new IOException("Binding/resource expressions cannot be overwritten by scalar edits");
        var info=(IXmlLineInfo)attribute;if(!info.HasLineInfo())throw new IOException("Attribute source position is unavailable");
        var position=0;for(var line=1;line<info.LineNumber;line++){position=source.IndexOf('\n',position);if(position<0)throw new IOException("Attribute source line disappeared");position++;}position+=info.LinePosition-1;
        var match=System.Text.RegularExpressions.Regex.Match(source.Substring(position),"^"+System.Text.RegularExpressions.Regex.Escape(property)+"\\s*=\\s*(['\"])(.*?)\\1",System.Text.RegularExpressions.RegexOptions.Singleline);
        if(!match.Success)throw new IOException("Attribute source span could not be verified");
        var group=match.Groups[2];var escaped=value.Replace("&","&amp;").Replace("<","&lt;").Replace("\r","&#xD;").Replace("\n","&#xA;").Replace("\t","&#x9;");escaped=match.Groups[1].Value=="\""?escaped.Replace("\"","&quot;"):escaped.Replace("'","&apos;");
        return source.Remove(position+group.Index,group.Length).Insert(position+group.Index,escaped);
    }
    private static void SetNative(Document document, string componentId, string propertyName, string value)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var host = Host(document) ?? throw new IOException("Designer unavailable");
        var component = host.Container.Components[componentId] ?? throw new IOException("Component disappeared");
        var property = TypeDescriptor.GetProperties(component)[propertyName] ?? throw new IOException("Property disappeared");
        using var transaction = host.CreateTransaction("PiAgent designer property");
        try { var changes=host.GetService(typeof(IComponentChangeService)) as IComponentChangeService;var before=property.GetValue(component);changes?.OnComponentChanging(component,property);property.SetValue(component, property.Converter.ConvertFromInvariantString(value));changes?.OnComponentChanged(component,property,before,property.GetValue(component));document.Save(); transaction.Commit(); }
        catch { transaction.Cancel(); throw; }
    }
}
