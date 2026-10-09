using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class IdeTestTools
{
    internal static IReadOnlyList<string> Arguments(string file,JObject args,string folder,string uri)
    {
        var operation=(string?)args["operation"];
        if(operation!="discover"&&operation!="run")throw new IOException("Unsupported test operation");
        var arguments=new List<string>{"test",file,"--no-restore"};
        if(operation=="discover")arguments.Add("--list-tests");else arguments.AddRange(new[]{"--logger","trx;LogFileName=results.trx","--results-directory",folder});
        foreach(var field in new[]{"filter","configuration","framework"})if(args[field] is JValue value&&!string.IsNullOrWhiteSpace((string?)value)){var text=(string)value!;if(text.Length>4096||text.IndexOf('\0')>=0)throw new IOException("Invalid test argument");arguments.Add("--"+field);arguments.Add(text);}
        if(args["settings"] is JValue settings&&!string.IsNullOrWhiteSpace((string?)settings)){
            var path=IdeTools.ResolveFile(uri,(string)settings!);if(!Path.GetExtension(path).Equals(".runsettings",StringComparison.OrdinalIgnoreCase))throw new IOException("Test settings must be a workspace .runsettings file");arguments.Add("--settings");arguments.Add(path);
        }
        return arguments;
    }
    internal static async Task<JObject> ExecuteAsync(DTE dte,JObject args,string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);IdeTools.CleanBuffers(dte);
        if(dte.Solution.SolutionBuild.BuildState==vsBuildState.vsBuildStateInProgress)throw new IOException("Wait for the active Visual Studio build before running tests");
        var file=IdeTools.ResolveFile(uri,(string?)args["project"]??"");
        if(!new[]{".csproj",".vbproj"}.Contains(Path.GetExtension(file),StringComparer.OrdinalIgnoreCase)||!IdeTools.Projects(dte.Solution.Projects).Any(p=>{ThreadHelper.ThrowIfNotOnUIThread();return string.Equals(p.FullName,file,StringComparison.OrdinalIgnoreCase);}))throw new IOException("Select an existing C#/VB project in the current solution");
        var timeout=(int?)args["timeoutSeconds"]??120;if(timeout<60||timeout>150)throw new IOException("Test timeout must be 60–150 seconds");
        var folder=IdeTools.DiagnosticDirectory();var arguments=Arguments(file,args,folder,uri);var operation=(string)args["operation"]!;
        var started=DateTime.UtcNow;var run=await OwnedProcess.RunAsync(IdeTools.Dotnet(),arguments,Path.GetDirectoryName(dte.Solution.FullName)!,timeout*1000,token);
        var result=new JObject{["executed"]=true,["operation"]=operation,["exitCode"]=run.ExitCode,["output"]=run.Output,["truncated"]=run.Truncated,["backend"]="dotnet test / VSTest",["testExplorerControlled"]=false,["startedAt"]=started.ToString("o"),["completedAt"]=DateTime.UtcNow.ToString("o"),["durationMilliseconds"]=(long)(DateTime.UtcNow-started).TotalMilliseconds,["project"]=IdeTools.Relative(uri,file),["configuration"]=args["configuration"],["framework"]=args["framework"]};
        if(operation=="run"){
            var trx=Path.Combine(folder,"results.trx");var results=File.Exists(trx)?IdeTools.ReadTrx(trx):new JObject{["available"]=false,["reason"]="No TRX result: verify VSTest support, restored dependencies and adapters; Microsoft.Testing.Platform requires its own supported result backend"};
            result["results"]=results;result["success"]=run.ExitCode==0&&(bool?)results["available"]==true&&(bool?)results["noTests"]==false&&(int?)results["failed"]==0;result["resultFile"]=File.Exists(trx)?trx:null;
        }else{
            var names=new JArray();var listing=false;foreach(var line in run.Output.Split('\n')){var trimmed=line.Trim();if(trimmed.StartsWith("The following Tests are available:",StringComparison.Ordinal)||trimmed.StartsWith("사용할 수 있는 테스트",StringComparison.Ordinal)){listing=true;continue;}if(listing&&trimmed.Length>0&&names.Count<500)names.Add(trimmed);}
            result["discoveredTests"]=names;result["discoveryParsed"]=listing;result["success"]=run.ExitCode==0;result["guidance"]=listing?"Discovery identities parsed from VSTest output":"See discovery output; localized runner format could not be parsed";
        }
        return result;
    }
}
