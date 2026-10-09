using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.LanguageServices;
using Microsoft.VisualStudio.Shell;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.FindSymbols;
using Newtonsoft.Json.Linq;
using System.Xml.Linq;
using Project=EnvDTE.Project;
using Projects=EnvDTE.Projects;
using TextDocument=EnvDTE.TextDocument;

namespace PiAgent.Vsix;

/// <summary>Public VS services only. Core supplies the connection's fixed workspace.</summary>
internal static class IdeTools
{
    internal static string ResolveFile(string workspaceUri,string path,bool allowMissingFinal=false)
    {
        var root=Path.GetFullPath(new Uri(workspaceUri).LocalPath).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
        var full=Path.GetFullPath(Path.IsPathRooted(path)?path:Path.Combine(root,path));
        if(!full.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new IOException("File is outside the connected solution");
        var relative=full.Substring(root.Length);
        foreach(var part in relative.Split(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar))
            if(System.Text.RegularExpressions.Regex.IsMatch(part,@"^(\.git|\.svn|\.hg|\.ssh|\.aws|\.azure|node_modules|\.tools|artifacts|bin|obj)$|^(\.env($|\.)|credentials($|\.)|secrets($|\.))|\.(pem|key|pfx|p12|kdbx)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase))throw new IOException("File is excluded from IDE context");
        var current=root;
        foreach(var part in relative.Split(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar)){
            current=Path.Combine(current,part);
            if(allowMissingFinal&&string.Equals(current,full,StringComparison.OrdinalIgnoreCase)&&!File.Exists(current)&&!Directory.Exists(current))break;
            if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked IDE paths are unsupported");
        }
        return full;
    }
    private static DTE Dte(){ThreadHelper.ThrowIfNotOnUIThread();return Package.GetGlobalService(typeof(DTE)) as DTE??throw new IOException("Visual Studio services unavailable");}
    internal static string Relative(string uri,string file)=>file.Substring(Path.GetFullPath(new Uri(uri).LocalPath).TrimEnd(Path.DirectorySeparatorChar).Length+1).Replace('\\','/');
    internal static void CleanBuffers(DTE dte){ThreadHelper.ThrowIfNotOnUIThread();foreach(EnvDTE.Document document in dte.Documents)if(!document.Saved)throw new IOException("Save unsaved IDE documents before executing build/test/debug actions");}
    internal static IEnumerable<Project> Projects(Projects projects)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        foreach(Project project in projects)foreach(var nested in Nested(project))yield return nested;
    }
    private static string[] ProjectFiles(DTE dte){ThreadHelper.ThrowIfNotOnUIThread();var files=new List<string>();foreach(var project in Projects(dte.Solution.Projects))files.Add(project.FullName);return files.ToArray();}
    // ProjectItems is a COM interface and cannot be synthesized; enumerate nullable collections explicitly.
    private static IEnumerable<Project> Nested(Project project){ThreadHelper.ThrowIfNotOnUIThread();if(!string.IsNullOrEmpty(project.FullName))yield return project;if(project.ProjectItems!=null)foreach(ProjectItem item in project.ProjectItems)if(item.SubProject!=null)foreach(var nested in Nested(item.SubProject))yield return nested;}
    public static async Task<JObject> ExecuteAsync(string name,JObject args,string workspaceUri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var dte=Dte();
        var solution=dte.Solution.FullName;
        if(string.IsNullOrEmpty(solution)||!File.Exists(solution))throw new IOException("Open a saved solution first");
        ResolveFile(workspaceUri,solution);
        if(name=="ide_catalog")return IdeCatalog.Capture(workspaceUri);
        if(name=="ide_context")return IdeContextTools.Capture(dte,workspaceUri);
        if(name=="ide_diagnostics"){
            var diagnostics=Diagnostics(dte,workspaceUri);
            diagnostics["compiler"]=await CompilerDiagnosticsAsync(workspaceUri,token);return diagnostics;
        }
        if(name=="ide_symbols")return await SymbolsAsync(args,workspaceUri,token);
        if(name=="ide_refactor")return await IdeRefactoringTools.ExecuteAsync(args,workspaceUri,token);
        if(name=="ide_build")return await IdeBuildTools.ExecuteAsync(dte,args,workspaceUri,token);
        if(name=="ide_tests")return await IdeTestTools.ExecuteAsync(dte,args,workspaceUri,token);
        if(name=="ide_debug")return await IdeDebugTools.ExecuteAsync(dte,args,workspaceUri,token);
        if(name=="ide_profile")return await IdeProfileTools.ExecuteAsync(dte,args,workspaceUri,token);
        if(name=="ide_run")return await IdeRunTools.ExecuteAsync(dte,args,workspaceUri,token);
        throw new IOException("Unsupported IDE tool");
    }
    private static JObject Diagnostics(DTE dte,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();var rows=new JArray();var items=((EnvDTE80.DTE2)dte).ToolWindows.ErrorList.ErrorItems;
        for(var i=1;i<=items.Count&&rows.Count<100;i++){var item=items.Item(i);string? file=null;try{if(!string.IsNullOrEmpty(item.FileName))file=Relative(uri,ResolveFile(uri,item.FileName));}catch(IOException){continue;}rows.Add(new JObject{["file"]=file,["line"]=item.Line,["column"]=item.Column,["severity"]=item.ErrorLevel.ToString(),["message"]=item.Description.Substring(0,Math.Min(item.Description.Length,512))});}
        return new JObject{["source"]="Visual Studio Error List",["items"]=rows,["truncated"]=items.Count>100,["capturedAt"]=DateTime.UtcNow.ToString("o"),["freshness"]="IDE Error List snapshot; may include stale build/analyzer entries",["buildState"]=dte.Solution.SolutionBuild.BuildState.ToString()};
    }
    private static async Task<JObject> CompilerDiagnosticsAsync(string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var workspace=(Package.GetGlobalService(typeof(SComponentModel)) as IComponentModel)?.GetService<VisualStudioWorkspace>();
        if(workspace==null)return new JObject{["available"]=false};
        var snapshot=workspace.CurrentSolution;
        var projects=snapshot.Projects.Where(p=>p.Language==LanguageNames.CSharp||p.Language==LanguageNames.VisualBasic).Take(8).ToArray();
        return await Task.Run(async()=>{
            var rows=new JArray();foreach(var project in projects){var compilation=await project.GetCompilationAsync(token);if(compilation==null)continue;
                foreach(var diagnostic in compilation.GetDiagnostics(token).Where(d=>d.Severity==DiagnosticSeverity.Error||d.Severity==DiagnosticSeverity.Warning)){
                    if(rows.Count>=100)break;string? file=null;var line=0;var column=0;
                    if(diagnostic.Location.IsInSource){var span=diagnostic.Location.GetLineSpan();try{file=Relative(uri,ResolveFile(uri,span.Path));}catch(IOException){continue;}line=span.StartLinePosition.Line+1;column=span.StartLinePosition.Character+1;}
                    var message=diagnostic.GetMessage();rows.Add(new JObject{["code"]=diagnostic.Id,["severity"]=diagnostic.Severity.ToString(),["file"]=file,["line"]=line,["column"]=column,["project"]=project.Name,["source"]="compiler",["message"]=message.Substring(0,Math.Min(message.Length,512))});
                }if(rows.Count>=100)break;
            }return new JObject{["available"]=true,["source"]="Roslyn compiler snapshot",["items"]=rows,["projectLimit"]=8,["diagnosticLimit"]=100,["projectsInspected"]=projects.Length,["truncated"]=snapshot.ProjectIds.Count>8||rows.Count>=100,["capturedAt"]=DateTime.UtcNow.ToString("o"),["snapshotRevision"]=snapshot.Version.ToString(),["includesUnsavedBuffers"]=true,["includesAnalyzers"]=false};
        },token);
    }
    private static async Task<JObject> SymbolsAsync(JObject args,string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var components=Package.GetGlobalService(typeof(SComponentModel)) as IComponentModel;
        var workspace=components?.GetService<VisualStudioWorkspace>()??throw new IOException("Roslyn workspace unavailable");
        var solution=workspace.CurrentSolution;
        // Keep all expensive semantic work off the IDE UI thread.
        return await Task.Run(async()=>{
            var result=new JArray();var operation=(string?)args["operation"];
            if(operation=="search"){
                var query=(string?)args["query"]??"";
                foreach(var project in solution.Projects.Where(p=>p.Language==LanguageNames.CSharp||p.Language==LanguageNames.VisualBasic)){
                    foreach(var symbol in await SymbolFinder.FindSourceDeclarationsAsync(project,query,true,token)){
                        foreach(var location in symbol.Locations.Where(l=>l.IsInSource))AddSymbol(result,symbol,location,uri);
                        if(result.Count>=100)break;
                    }if(result.Count>=100)break;
                }
            }else{
                var path=ResolveFile(uri,(string?)args["file"]??"");
                var document=solution.GetDocumentIdsWithFilePath(path).Select(solution.GetDocument).FirstOrDefault(d=>d!=null&&(d.Project.Language==LanguageNames.CSharp||d.Project.Language==LanguageNames.VisualBasic));
                if(document==null)return new JObject{["available"]=false,["reason"]="Semantic symbols currently support Roslyn C#/VB projects only"};
                var text=await document.GetTextAsync(token);var line=(int?)args["line"]??0;var column=(int?)args["column"]??0;
                if(line<1||line>text.Lines.Count||column<1||column>text.Lines[line-1].Span.Length+1)throw new IOException("Symbol position is outside the editor snapshot");
                var symbol=await SymbolFinder.FindSymbolAtPositionAsync(document,text.Lines[line-1].Start+column-1,token);
                if(symbol!=null){
                    if(operation=="definition")foreach(var location in symbol.Locations.Where(l=>l.IsInSource))AddSymbol(result,symbol,location,uri);
                    else if(operation=="references")foreach(var reference in await SymbolFinder.FindReferencesAsync(symbol,solution,token))foreach(var location in reference.Locations.Take(100))AddSymbol(result,symbol,location.Location,uri);
                    else if(operation=="callers")foreach(var caller in await SymbolFinder.FindCallersAsync(symbol,solution,token))foreach(var location in caller.Locations.Take(100))AddSymbol(result,caller.CallingSymbol,location,uri);
                    else if(operation=="implementations")foreach(var implementation in await SymbolFinder.FindImplementationsAsync(symbol,solution,cancellationToken:token))foreach(var location in implementation.Locations)AddSymbol(result,implementation,location,uri);
                    else if(operation=="overrides")foreach(var implementation in await SymbolFinder.FindOverridesAsync(symbol,solution,cancellationToken:token))foreach(var location in implementation.Locations)AddSymbol(result,implementation,location,uri);
                    else if(operation=="baseTypes"&&symbol is INamedTypeSymbol type){for(var parent=type.BaseType;parent!=null;parent=parent.BaseType)foreach(var location in parent.Locations)AddSymbol(result,parent,location,uri);foreach(var implemented in type.AllInterfaces)foreach(var location in implemented.Locations)AddSymbol(result,implemented,location,uri);}
                    else if(operation=="signature"){var xml=symbol.GetDocumentationCommentXml(cancellationToken:token)??"";return new JObject{["available"]=true,["operation"]=operation,["signature"]=symbol.ToDisplayString(),["kind"]=symbol.Kind.ToString(),["documentationXml"]=xml.Substring(0,Math.Min(xml.Length,8192)),["snapshotRevision"]=solution.Version.ToString(),["backend"]="Roslyn"};}
                }
            }
            return new JObject{["available"]=true,["operation"]=operation,["symbols"]=result,["limit"]=100,["snapshot"]="Roslyn solution, including editor buffers",["snapshotRevision"]=solution.Version.ToString(),["backend"]="Roslyn"};
        },token);
    }
    private static void AddSymbol(JArray rows,ISymbol symbol,Location location,string uri)
    {
        if(rows.Count>=100||!location.IsInSource)return;var span=location.GetLineSpan();string file;try{file=Relative(uri,ResolveFile(uri,span.Path));}catch(IOException){return;}
        rows.Add(new JObject{["name"]=symbol.Name,["display"]=symbol.ToDisplayString(),["kind"]=symbol.Kind.ToString(),["file"]=file,["line"]=span.StartLinePosition.Line+1,["column"]=span.StartLinePosition.Character+1});
    }
    internal static JObject ReadTrx(string file)
    {
        if(new FileInfo(file).Length>4*1024*1024)throw new IOException("TRX exceeds 4 MiB limit");
        using var reader=System.Xml.XmlReader.Create(file,new System.Xml.XmlReaderSettings{DtdProcessing=System.Xml.DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=4*1024*1024});var xml=XDocument.Load(reader);XNamespace ns=xml.Root!.Name.Namespace;
        var counters=xml.Descendants(ns+"Counters").FirstOrDefault();var tests=new JArray();
        foreach(var test in xml.Descendants(ns+"UnitTestResult").Where(x=>(string?)x.Attribute("outcome")!="Passed").Take(50)){var message=test.Descendants(ns+"Message").FirstOrDefault()?.Value??"";tests.Add(new JObject{["name"]=(string?)test.Attribute("testName"),["outcome"]=(string?)test.Attribute("outcome"),["message"]=message.Substring(0,Math.Min(message.Length,2048))});}
        var total=(int?)counters?.Attribute("total")??0;var passed=(int?)counters?.Attribute("passed")??0;var failed=(int?)counters?.Attribute("failed")??0;var executed=(int?)counters?.Attribute("executed")??passed+failed;
        return new JObject{["available"]=counters!=null,["total"]=total,["executed"]=executed,["passed"]=passed,["failed"]=failed,["noTests"]=executed==0,["failures"]=tests};
    }
    internal static string DiagnosticDirectory(){var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"PiAgent","diagnostics",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);return folder;}
    internal static string Dotnet(){var path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"dotnet","dotnet.exe");if(!File.Exists(path))throw new IOException("Install the .NET SDK to run tests");return path;}
}
