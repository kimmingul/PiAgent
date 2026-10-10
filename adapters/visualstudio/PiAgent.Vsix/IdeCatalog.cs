using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Security.Cryptography;
using EnvDTE;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.LanguageServices;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

/// <summary>Live availability, with a fingerprint independent of the capture timestamp.</summary>
internal static class IdeCatalog
{
    internal static string Hash(string value) { using var hash=SHA256.Create(); return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-","").ToLowerInvariant(); }
    internal static JObject Entry(string tool,string? operation,string availability,string backend,string? reason=null,string? code=null,string[]? languages=null)
    {
        var item=new JObject{["tool"]=tool,["availability"]=availability,["backend"]=backend};
        if(availability=="unavailable"||availability=="blocked"){reason??="IDE service or current state prevents this operation";code??=availability=="blocked"?"ide_state_blocked":"ide_service_unavailable";}
        if(operation!=null)item["operation"]=operation;if(reason!=null)item["reason"]=reason;if(code!=null)item["reasonCode"]=code;if(languages!=null)item["languages"]=new JArray(languages);return item;
    }
    internal static void ValidateExpected(JObject? expected,string workspaceUri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        if(expected==null)return; // Existing ide.tools.v1 clients remain compatible.
        var current=Capture(workspaceUri);
        if(!string.Equals((string?)expected["workspaceUri"],workspaceUri,StringComparison.OrdinalIgnoreCase)||(string?)expected["revision"]!=(string?)current["revision"])
            throw new IOException("IDE state changed after approval; inspect and approve the action again");
    }
    internal static JObject Capture(string workspaceUri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var dte=Package.GetGlobalService(typeof(DTE)) as DTE;
        var entries=new JArray();
        var state=new JObject {["workspaceUri"]=workspaceUri};
        var open=dte?.Solution.IsOpen==true&&!string.IsNullOrWhiteSpace(dte.Solution.FullName);
        var bound=false;var dirty=false;var documents=new JArray();
        if(open){
            try { IdeTools.ResolveFile(workspaceUri,dte!.Solution.FullName);bound=true; } catch(IOException) { }
            state["solution"]=dte!.Solution.FullName;
            state["configuration"]=dte.Solution.SolutionBuild.ActiveConfiguration.Name;
            state["buildState"]=dte.Solution.SolutionBuild.BuildState.ToString();
            state["debugMode"]=dte.Debugger.CurrentMode.ToString();
            foreach(Document document in dte.Documents){
                if(!document.Saved)dirty=true;
                if(documents.Count>=64)continue;
                try{IdeTools.ResolveFile(workspaceUri,document.FullName);string? revision=null;
                    if(document.Object("TextDocument") is TextDocument text)revision=Hash(text.StartPoint.CreateEditPoint().GetText(text.EndPoint));
                    documents.Add(new JObject{["path"]=document.FullName,["saved"]=document.Saved,["revision"]=revision});
                }catch(Exception error)when(error is IOException||error is System.Runtime.InteropServices.COMException){}
            }
            state["documents"]=new JArray(documents.OfType<JObject>().OrderBy(x=>(string?)x["path"],StringComparer.OrdinalIgnoreCase));
            var breakpoints=new JArray();foreach(Breakpoint bp in dte.Debugger.Breakpoints){if(breakpoints.Count>=100)break;breakpoints.Add(new JObject{["file"]=bp.File,["line"]=bp.FileLine,["enabled"]=bp.Enabled,["condition"]=bp.Condition});}state["breakpoints"]=breakpoints;
            if(dte.Debugger.CurrentMode==dbgDebugMode.dbgBreakMode){state["thread"]=dte.Debugger.CurrentThread?.ID;state["frame"]=dte.Debugger.CurrentStackFrame?.FunctionName;}
        }
        var components=Package.GetGlobalService(typeof(SComponentModel)) as IComponentModel;
        var roslyn=components?.GetService<VisualStudioWorkspace>();
        state["roslynVersion"]=roslyn?.CurrentSolution.Version.ToString();
        if(roslyn!=null)state["semanticVersions"]=Hash(string.Join("\n",roslyn.CurrentSolution.Projects.OrderBy(project=>project.Id.ToString(),StringComparer.Ordinal).Select(project=>project.Id+":"+project.Version+":"+string.Join(",",project.Documents.Concat(project.AdditionalDocuments).Concat(project.AnalyzerConfigDocuments).OrderBy(document=>document.Id.ToString(),StringComparer.Ordinal).Select(document=>document.Id+":"+(document.TryGetTextVersion(out var version)?version.ToString():"unloaded"))))));
        var available=bound;var busy=bound&&dte!.Solution.SolutionBuild.BuildState==vsBuildState.vsBuildStateInProgress;
        void Add(string tool,string? operation,string availability,string backend,string? reason=null,string? code=null,string[]? languages=null){
            entries.Add(Entry(tool, operation, availability, backend, reason, code, languages));
        }
        var unavailable=available?null:open?"Solution is outside the bound workspace":"Open a saved solution first";
        Add("ide_context",null,available?"supported":"unavailable","Visual Studio automation",unavailable);
        Add("ide_diagnostics",null,available?"partial":"unavailable","Error List / Roslyn compiler",unavailable??"Error List can be stale; analyzer diagnostics are not included");
        foreach(var operation in new[]{"search","definition","references","callers","implementations","overrides","baseTypes","signature"})Add("ide_symbols",operation,available&&roslyn!=null?"supported":"unavailable","Roslyn",unavailable??(roslyn==null?"Roslyn service is unavailable":null),null,new[]{"C#","Visual Basic"});
        foreach(var operation in new[]{"rename","format","simplify","apply"})Add("ide_refactor",operation,!available||roslyn==null?"unavailable":operation=="apply"&&dirty?"blocked":"supported","Roslyn",unavailable??(roslyn==null?"Roslyn service is unavailable":operation=="apply"&&dirty?"Save unsaved IDE documents and prepare a new preview":null),dirty&&operation=="apply"?"dirty_buffers":null,new[]{"C#","Visual Basic"});
        foreach(var operation in new[]{"build","rebuild","clean"})Add("ide_build",operation,!available?"unavailable":dirty||busy?"blocked":"supported","IVsSolutionBuildManager2",unavailable??(dirty?"Save unsaved IDE documents":busy?"Another build is running":null),dirty?"dirty_buffers":busy?"build_busy":null);
        var dotnet=File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"dotnet","dotnet.exe"));
        foreach(var operation in new[]{"discover","run"})Add("ide_tests",operation,!available||!dotnet?"unavailable":dirty||busy?"blocked":"partial","dotnet test / VSTest or opted-in MTP",unavailable??(!dotnet?"Install the .NET SDK":dirty?"Save unsaved IDE documents":busy?"Another build is running":"Requires a restored test project. MTP global.json opt-in requires an explicit framework and TRX reporter for runs; framework-specific filters and runsettings are unavailable. Does not control Test Explorer"));
        Add("ide_debug","snapshot",available?"supported":"unavailable","EnvDTE.Debugger",unavailable);
        Add("ide_debug","breakpoints",available?"supported":"unavailable","EnvDTE.Debugger",unavailable);
        Add("ide_debug","threads",available?"supported":"unavailable","EnvDTE.Debugger",unavailable);
        foreach(var operation in new[]{"breakpoint","removeBreakpoint","enableBreakpoint","start","pause","selectThread","selectFrame","continue","stepOver","stepInto","stepOut","stop","evaluate"}){
            var mode=dte?.Debugger.CurrentMode??dbgDebugMode.dbgDesignMode;
            var blocked=operation=="start"?(dirty||busy||mode!=dbgDebugMode.dbgDesignMode):operation=="breakpoint"||operation=="removeBreakpoint"||operation=="enableBreakpoint"?false:operation=="pause"?mode!=dbgDebugMode.dbgRunMode:operation=="stop"?mode==dbgDebugMode.dbgDesignMode:mode!=dbgDebugMode.dbgBreakMode;
            Add("ide_debug",operation,!available?"unavailable":blocked?"blocked":"supported","EnvDTE.Debugger",unavailable??(blocked?"Debugger mode, build or unsaved buffers prevent this operation":null));
        }
        var trace=File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".dotnet","tools","dotnet-trace.exe"));
        Add("ide_profile","cpu",!available||!trace?"unavailable":"partial","dotnet-trace",unavailable??(!trace?"Install dotnet-trace":"Modern .NET managed stack sampling only; target must be attached to VS"));
        Add("ide_profile","gc",!available||!trace||!File.Exists(IdeProfileTools.Analyzer)?"unavailable":"partial","dotnet-trace / isolated EventPipe analyzer",unavailable??(!trace?"Install dotnet-trace":!File.Exists(IdeProfileTools.Analyzer)?"Isolated analyzer is not installed":"Modern .NET sampled allocation and GC events, not a heap snapshot"));
        Add("ide_profile","compare",!available||!trace?"unavailable":"partial","dotnet-trace",unavailable??(!trace?"Install dotnet-trace":"Compare a new capture with a previous traceId from this workspace; equivalent workload required"));
        Add("ide_run","inspect",available?"supported":"unavailable","Visual Studio project context / profile metadata",unavailable);
        Add("ide_run","publish-preview",available&&dotnet?"partial":"unavailable","dotnet publish",unavailable??(!dotnet?"Install the .NET SDK":"Existing C#/VB project; local output only"));
        Add("ide_run","publish",!available||!dotnet?"unavailable":dirty||busy?"blocked":"partial","dotnet publish",unavailable??(!dotnet?"Install the .NET SDK":dirty?"Save unsaved IDE documents":busy?"Another build is running":"Requires a matching immutable local publish preview"));
        if (available && dte?.ActiveDocument is Document designerDocument) {
            try {
                IdeTools.ResolveFile(workspaceUri, designerDocument.FullName);
                var designer = DesignerTools.Inspect(designerDocument);
                state["designer"] = new JObject { ["document"] = designer["document"], ["revision"] = designer["revision"], ["operations"] = designer["supportedOperations"] };
                var operations = (JArray)designer["supportedOperations"]!;
                if (operations.Values<string>().Contains("previewChange") && (bool?)designer["recovery"]?["supported"] == true)
                    foreach (var tool in new[] { "ide_designer_preview_change", "ide_designer_apply_change", "ide_designer_preview_restore", "ide_designer_restore_change" })
                        Add(tool, null, "partial", (string?)designer["backend"] ?? "designer source journal", "Standard controls and saved owned source/form files only; build and runtime validation required");
            } catch (Exception) { /* An ordinary code document has no designer contract. */ }
        }
        return new JObject{["schemaVersion"]=1,["implementationVersion"]=typeof(IdeCatalog).Assembly.GetName().Version+"+"+typeof(IdeCatalog).Module.ModuleVersionId.ToString("N"),["workspaceUri"]=workspaceUri,["revision"]=Hash(state.ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>())),["capturedAt"]=DateTime.UtcNow.ToString("o"),["entries"]=entries};
    }
}
