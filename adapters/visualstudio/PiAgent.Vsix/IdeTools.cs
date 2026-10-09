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
    internal static string ResolveFile(string workspaceUri,string path)
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
            if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked IDE paths are unsupported");
        }
        return full;
    }
    private static DTE Dte(){ThreadHelper.ThrowIfNotOnUIThread();return Package.GetGlobalService(typeof(DTE)) as DTE??throw new IOException("Visual Studio services unavailable");}
    private static string Relative(string uri,string file)=>file.Substring(Path.GetFullPath(new Uri(uri).LocalPath).TrimEnd(Path.DirectorySeparatorChar).Length+1).Replace('\\','/');
    private static void CleanBuffers(DTE dte){ThreadHelper.ThrowIfNotOnUIThread();foreach(EnvDTE.Document document in dte.Documents)if(!document.Saved)throw new IOException("Save unsaved IDE documents before executing build/test/debug actions");}
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
        if(name=="ide_context")return Context(dte,workspaceUri);
        if(name=="ide_diagnostics"){
            var diagnostics=Diagnostics(dte,workspaceUri);
            diagnostics["compiler"]=await CompilerDiagnosticsAsync(workspaceUri,token);return diagnostics;
        }
        if(name=="ide_symbols")return await SymbolsAsync(args,workspaceUri,token);
        if(name=="ide_debug")return Debug(dte,args,workspaceUri);
        if(name=="ide_build"){
            CleanBuffers(dte);
            if(dte.Solution.SolutionBuild.BuildState==vsBuildState.vsBuildStateInProgress)throw new IOException("Another Visual Studio build is already running");
            var events=dte.Events.BuildEvents;
            var completed=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            _dispBuildEvents_OnBuildDoneEventHandler onDone=(scope,action)=>completed.TrySetResult(true);
            events.OnBuildDone+=onDone;
            try{
                if((bool?)args["rebuild"]==true)dte.ExecuteCommand("Build.RebuildSolution");else dte.Solution.SolutionBuild.Build(false);
                for(var attempt=0;attempt<600;attempt++){
                    await Task.Delay(200,token);await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
                    if(dte.Solution.FullName!=solution)throw new IOException("Solution changed during build");
                    if(completed.Task.IsCompleted){
                        return new JObject{["executed"]=true,["success"]=dte.Solution.SolutionBuild.LastBuildInfo==0,["failedProjects"]=dte.Solution.SolutionBuild.LastBuildInfo,["diagnostics"]=Diagnostics(dte,workspaceUri)};
                    }
                }
                throw new IOException("Build timed out");
            }catch{
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                if(dte.Solution.FullName==solution&&dte.Solution.SolutionBuild.BuildState==vsBuildState.vsBuildStateInProgress)dte.ExecuteCommand("Build.Cancel");throw;
            }finally{await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();events.OnBuildDone-=onDone;}
        }
        if(name=="ide_tests"){
            CleanBuffers(dte);var file=ResolveFile(workspaceUri,(string?)args["project"]??"");
            if(!new[]{".csproj",".vbproj"}.Contains(Path.GetExtension(file),StringComparer.OrdinalIgnoreCase)||!ProjectFiles(dte).Any(p=>string.Equals(p,file,StringComparison.OrdinalIgnoreCase)))throw new IOException("Select an existing C#/VB project in the current solution");
            var folder=DiagnosticDirectory();var discover=(string?)args["operation"]=="discover";
            var arguments=new List<string>{"test",file,"--no-restore"};
            if(discover)arguments.Add("--list-tests");else arguments.AddRange(new[]{"--logger","trx;LogFileName=results.trx","--results-directory",folder});
            if(args["filter"] is JValue filter&&!string.IsNullOrWhiteSpace((string?)filter)){arguments.Add("--filter");arguments.Add((string)filter!);}
            var run=await OwnedProcess.RunAsync(Dotnet(),arguments,Path.GetDirectoryName(solution)!,120000,token);
            var result=new JObject{["executed"]=true,["operation"]=discover?"discover":"run",["exitCode"]=run.ExitCode,["output"]=run.Output,["truncated"]=run.Truncated,["backend"]="dotnet test / VSTest"};
            if(!discover){var trx=Path.Combine(folder,"results.trx");var results=File.Exists(trx)?ReadTrx(trx):new JObject{["available"]=false,["reason"]="No TRX result: verify VSTest support, restored dependencies and test adapters"};result["results"]=results;result["success"]=run.ExitCode==0&&(bool?)results["available"]==true&&(bool?)results["noTests"]==false&&(int?)results["failed"]==0;}
            return result;
        }
        if(name=="ide_profile"){
            var pid=(int?)args["processId"]??0;var attached=false;
            foreach(EnvDTE.Process process in dte.Debugger.DebuggedProcesses)if(process.ProcessID==pid)attached=true;
            if(!attached)throw new IOException("Profile only a process attached to this Visual Studio debugger");
            var trace=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".dotnet","tools","dotnet-trace.exe");
            if(!File.Exists(trace))return new JObject{["executed"]=false,["available"]=false,["reason"]="Install the official dotnet-trace tool with dotnet tool install --global dotnet-trace. CPU capture supports compatible modern .NET targets."};
            var seconds=(int?)args["durationSeconds"]??10;if(seconds<1||seconds>30)throw new IOException("Trace duration must be 1–30 seconds");
            var output=Path.Combine(DiagnosticDirectory(),"cpu.nettrace");
            var capture=await OwnedProcess.RunAsync(trace,new[]{"collect","--process-id",pid.ToString(),"--duration",TimeSpan.FromSeconds(seconds).ToString(),"--buffersize","16","--output",output},Path.GetDirectoryName(solution)!,60000,token);
            if(capture.ExitCode!=0||!File.Exists(output))return new JObject{["executed"]=true,["success"]=false,["output"]=capture.Output};
            if(new FileInfo(output).Length>64*1024*1024)throw new IOException("Trace exceeds 64 MiB analysis limit");
            var report=await OwnedProcess.RunAsync(trace,new[]{"report",output,"topN","-n","20"},Path.GetDirectoryName(solution)!,30000,token);
            return new JObject{["executed"]=true,["success"]=report.ExitCode==0,["kind"]="modern .NET CPU sampling",["durationSeconds"]=seconds,["report"]=report.Output,["traceFile"]=output};
        }
        throw new IOException("Unsupported IDE tool");
    }
    private static JObject Context(DTE dte,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var projects=new JArray();foreach(var project in Projects(dte.Solution.Projects).Take(64)){try{projects.Add(new JObject{["name"]=project.Name,["file"]=Relative(uri,ResolveFile(uri,project.FullName)),["kind"]=project.Kind});}catch(IOException){}}
        var result=new JObject{["solution"]=Relative(uri,dte.Solution.FullName),["configuration"]=dte.Solution.SolutionBuild.ActiveConfiguration.Name,["projects"]=projects};
        var document=dte.ActiveDocument;
        if(document!=null){try{var file=ResolveFile(uri,document.FullName);if(document.Object("TextDocument") is TextDocument text){var body=text.StartPoint.CreateEditPoint().GetText(text.EndPoint);result["editor"]=new JObject{["file"]=Relative(uri,file),["language"]=document.Language,["saved"]=document.Saved,["text"]=body.Substring(0,Math.Min(body.Length,32768)),["truncated"]=body.Length>32768,["line"]=text.Selection.ActivePoint.Line,["column"]=text.Selection.ActivePoint.LineCharOffset};}}catch(IOException error){result["editorUnavailable"]=error.Message;}}
        return result;
    }
    private static JObject Diagnostics(DTE dte,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();var rows=new JArray();var items=((EnvDTE80.DTE2)dte).ToolWindows.ErrorList.ErrorItems;
        for(var i=1;i<=items.Count&&rows.Count<100;i++){var item=items.Item(i);string? file=null;try{if(!string.IsNullOrEmpty(item.FileName))file=Relative(uri,ResolveFile(uri,item.FileName));}catch(IOException){continue;}rows.Add(new JObject{["file"]=file,["line"]=item.Line,["column"]=item.Column,["severity"]=item.ErrorLevel.ToString(),["message"]=item.Description.Substring(0,Math.Min(item.Description.Length,512))});}
        return new JObject{["source"]="Visual Studio Error List",["items"]=rows,["truncated"]=items.Count>100};
    }
    private static async Task<JObject> CompilerDiagnosticsAsync(string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var workspace=(Package.GetGlobalService(typeof(SComponentModel)) as IComponentModel)?.GetService<VisualStudioWorkspace>();
        if(workspace==null)return new JObject{["available"]=false};
        var projects=workspace.CurrentSolution.Projects.Where(p=>p.Language==LanguageNames.CSharp||p.Language==LanguageNames.VisualBasic).Take(8).ToArray();
        return await Task.Run(async()=>{
            var rows=new JArray();foreach(var project in projects){var compilation=await project.GetCompilationAsync(token);if(compilation==null)continue;
                foreach(var diagnostic in compilation.GetDiagnostics(token).Where(d=>d.Severity==DiagnosticSeverity.Error||d.Severity==DiagnosticSeverity.Warning)){
                    if(rows.Count>=100)break;string? file=null;var line=0;var column=0;
                    if(diagnostic.Location.IsInSource){var span=diagnostic.Location.GetLineSpan();try{file=Relative(uri,ResolveFile(uri,span.Path));}catch(IOException){continue;}line=span.StartLinePosition.Line+1;column=span.StartLinePosition.Character+1;}
                    var message=diagnostic.GetMessage();rows.Add(new JObject{["code"]=diagnostic.Id,["severity"]=diagnostic.Severity.ToString(),["file"]=file,["line"]=line,["column"]=column,["message"]=message.Substring(0,Math.Min(message.Length,512))});
                }if(rows.Count>=100)break;
            }return new JObject{["available"]=true,["source"]="Roslyn compiler snapshot",["items"]=rows,["projectLimit"]=8,["diagnosticLimit"]=100};
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
                }
            }
            return new JObject{["available"]=true,["operation"]=operation,["symbols"]=result,["limit"]=100,["snapshot"]="Roslyn solution, including editor buffers"};
        },token);
    }
    private static void AddSymbol(JArray rows,ISymbol symbol,Location location,string uri)
    {
        if(rows.Count>=100||!location.IsInSource)return;var span=location.GetLineSpan();string file;try{file=Relative(uri,ResolveFile(uri,span.Path));}catch(IOException){return;}
        rows.Add(new JObject{["name"]=symbol.Name,["display"]=symbol.ToDisplayString(),["kind"]=symbol.Kind.ToString(),["file"]=file,["line"]=span.StartLinePosition.Line+1,["column"]=span.StartLinePosition.Character+1});
    }
    private static JObject Debug(DTE dte,JObject args,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();var debugger=dte.Debugger;var operation=(string?)args["operation"];
        if(operation=="snapshot"){
            var processes=new JArray();foreach(EnvDTE.Process process in debugger.DebuggedProcesses){if(processes.Count>=8)break;processes.Add(new JObject{["processId"]=process.ProcessID,["name"]=Path.GetFileName(process.Name)});}
            var result=new JObject{["mode"]=debugger.CurrentMode.ToString(),["reason"]=debugger.LastBreakReason.ToString(),["processes"]=processes};
            if(debugger.CurrentMode!=dbgDebugMode.dbgBreakMode){result["available"]=false;result["guidance"]="Pause at a breakpoint to inspect stack and variables";return result;}
            var frames=new JArray();foreach(StackFrame frame in debugger.CurrentThread.StackFrames){if(frames.Count>=16)break;var locals=new JArray();foreach(Expression expression in frame.Locals){if(locals.Count>=16)break;locals.Add(new JObject{["name"]=expression.Name,["type"]=expression.Type,["value"]=expression.Value.Substring(0,Math.Min(expression.Value.Length,512))});}frames.Add(new JObject{["function"]=frame.FunctionName,["language"]=frame.Language,["locals"]=locals});}
            result["available"]=true;result["stack"]=frames;return result;
        }
        if(operation=="breakpoint"){var file=ResolveFile(uri,(string?)args["file"]??"");debugger.Breakpoints.Add(File:file,Line:(int?)args["line"]??1);}
        else if(operation=="evaluate"){
            if(debugger.CurrentMode!=dbgDebugMode.dbgBreakMode)throw new IOException("Expression evaluation requires a paused debugger");
            var expression=debugger.GetExpression((string?)args["expression"]??"",false,1000);return new JObject{["executed"]=true,["valid"]=expression.IsValidValue,["type"]=expression.Type,["value"]=expression.Value.Substring(0,Math.Min(expression.Value.Length,4096))};
        }
        else if(operation=="start"){CleanBuffers(dte);if(debugger.CurrentMode!=dbgDebugMode.dbgDesignMode)throw new IOException("Debugger is already active");debugger.Go(false);}
        else if(operation=="stop"){if(debugger.CurrentMode==dbgDebugMode.dbgDesignMode)throw new IOException("No active debugger");debugger.Stop(false);}
        else{if(debugger.CurrentMode!=dbgDebugMode.dbgBreakMode)throw new IOException("Pause the debugger first");switch(operation){case "continue":debugger.Go(false);break;case "stepOver":debugger.StepOver(false);break;case "stepInto":debugger.StepInto(false);break;case "stepOut":debugger.StepOut(false);break;default:throw new IOException("Unsupported debugger operation");}}
        return new JObject{["executed"]=true,["operation"]=operation,["mode"]=debugger.CurrentMode.ToString(),["settled"]=false};
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
    private static string DiagnosticDirectory(){var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"PiAgent","diagnostics",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);return folder;}
    private static string Dotnet(){var path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"dotnet","dotnet.exe");if(!File.Exists(path))throw new IOException("Install the .NET SDK to run tests");return path;}
}
