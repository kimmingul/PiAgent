using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class IdeTestTools
{
    internal static IReadOnlyList<string> Arguments(string file,JObject args,string folder,string uri,bool mtp=false)
    {
        var operation=(string?)args["operation"];
        if(operation!="discover"&&operation!="run")throw new IOException("Unsupported test operation");
        if(mtp&&string.IsNullOrWhiteSpace((string?)args["framework"]))throw new IOException("Select an explicit MTP target framework so one result file represents one test module");
        if(mtp&&(args["filter"] is JValue filter&&!string.IsNullOrWhiteSpace((string?)filter)||args["settings"] is JValue settingsValue&&!string.IsNullOrWhiteSpace((string?)settingsValue)))throw new IOException("MTP filter and runsettings support varies by test framework; this runner accepts only unfiltered tests without runsettings");
        var arguments=mtp?new List<string>{"test","--project",file,"--no-restore"}:new List<string>{"test",file,"--no-restore"};
        if(operation=="discover")arguments.Add("--list-tests");
        else if(mtp)arguments.AddRange(new[]{"--results-directory",folder});
        else arguments.AddRange(new[]{"--logger","trx;LogFilePrefix=results","--results-directory",folder});
        foreach(var field in new[]{"filter","configuration","framework"})if(args[field] is JValue value&&!string.IsNullOrWhiteSpace((string?)value)){var text=(string)value!;if(text.Length>4096||text.IndexOf('\0')>=0)throw new IOException("Invalid test argument");arguments.Add("--"+field);arguments.Add(text);}
        if(args["settings"] is JValue settings&&!string.IsNullOrWhiteSpace((string?)settings)){
            var path=IdeTools.ResolveFile(uri,(string)settings!);if(!Path.GetExtension(path).Equals(".runsettings",StringComparison.OrdinalIgnoreCase))throw new IOException("Test settings must be a workspace .runsettings file");arguments.Add("--settings");arguments.Add(path);
        }
        if(mtp&&operation=="run")arguments.AddRange(new[]{"--","--report-trx","--report-trx-filename","results.trx"});
        return arguments;
    }
    internal static bool UsesMtpRunner(string workingDirectory)
    {
        for(var current=new DirectoryInfo(Path.GetFullPath(workingDirectory));current!=null;current=current.Parent){
            var file=Path.Combine(current.FullName,"global.json");
            if(!File.Exists(file))continue;
            if(new FileInfo(file).Length>64*1024)throw new IOException("global.json exceeds test runner detection limit");
            var runner=(string?)JObject.Parse(File.ReadAllText(file))["test"]?["runner"];
            if(string.IsNullOrWhiteSpace(runner)||string.Equals(runner,"VSTest",StringComparison.OrdinalIgnoreCase))return false;
            if(string.Equals(runner,"Microsoft.Testing.Platform",StringComparison.OrdinalIgnoreCase))return true;
            throw new IOException("Unsupported dotnet test runner in global.json: "+runner);
        }
        return false;
    }
    internal static async Task<JObject> ExecuteAsync(DTE dte,JObject args,string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);IdeTools.CleanBuffers(dte);
        if(dte.Solution.SolutionBuild.BuildState==vsBuildState.vsBuildStateInProgress)throw new IOException("Wait for the active Visual Studio build before running tests");
        var file=IdeTools.ResolveFile(uri,(string?)args["project"]??"");
        if(!new[]{".csproj",".vbproj"}.Contains(Path.GetExtension(file),StringComparer.OrdinalIgnoreCase)||!IdeTools.Projects(dte.Solution.Projects).Any(p=>{ThreadHelper.ThrowIfNotOnUIThread();return string.Equals(p.FullName,file,StringComparison.OrdinalIgnoreCase);}))throw new IOException("Select an existing C#/VB project in the current solution");
        var timeout=(int?)args["timeoutSeconds"]??120;if(timeout<60||timeout>150)throw new IOException("Test timeout must be 60–150 seconds");
        var workingDirectory=Path.GetDirectoryName(dte.Solution.FullName)!;var mtp=UsesMtpRunner(workingDirectory);
        var folder=IdeTools.DiagnosticDirectory();var arguments=Arguments(file,args,folder,uri,mtp);var operation=(string)args["operation"]!;
        var started=DateTime.UtcNow;
        var expectedFrameworks=operation=="run"&&!mtp?await ExpectedFrameworksAsync(file,workingDirectory,(string?)args["framework"],(string?)args["configuration"],token):Array.Empty<string>();
        var run=await OwnedProcess.RunAsync(IdeTools.Dotnet(),arguments,workingDirectory,timeout*1000,token);
        var result=new JObject{["executed"]=true,["operation"]=operation,["exitCode"]=run.ExitCode,["output"]=run.Output,["truncated"]=run.Truncated,["backend"]=mtp?"dotnet test / Microsoft.Testing.Platform":"dotnet test / VSTest",["testExplorerControlled"]=false,["startedAt"]=started.ToString("o"),["completedAt"]=DateTime.UtcNow.ToString("o"),["durationMilliseconds"]=(long)(DateTime.UtcNow-started).TotalMilliseconds,["project"]=IdeTools.Relative(uri,file),["configuration"]=args["configuration"],["framework"]=args["framework"]};
        if(operation=="run"){
            var reports=mtp?new[]{Path.Combine(folder,"results.trx")}.Where(File.Exists).ToArray():Directory.GetFiles(folder,"*.trx",SearchOption.TopDirectoryOnly).OrderBy(path=>path,StringComparer.OrdinalIgnoreCase).ToArray();
            var results=ReadReports(reports,mtp,mtp?1:expectedFrameworks.Length);
            result["results"]=results;result["success"]=run.ExitCode==0&&(bool?)results["available"]==true&&(bool?)results["noTests"]==false&&(int?)results["failed"]==0;result["resultFile"]=reports.Length==1?reports[0]:null;result["resultFiles"]=new JArray(reports);if(!mtp)result["expectedFrameworks"]=new JArray(expectedFrameworks);
        }else{
            (JArray Names,bool Parsed) discovery=mtp?ParseMtpDiscovery(run.Output):ParseDiscovery(run.Output);
            result["discoveredTests"]=discovery.Names;result["discoveryParsed"]=discovery.Parsed&&!run.Truncated;result["success"]=run.ExitCode==0&&!run.Truncated&&discovery.Parsed&&discovery.Names.Count>0;result["guidance"]=run.Truncated?"Discovery output was truncated; identities are incomplete":!discovery.Parsed?"See discovery output; this runner's text format could not be parsed":discovery.Names.Count==0?"No tests were discovered":mtp?"Display names parsed from Microsoft.Testing.Platform output; names may not be unique":"Discovery identities parsed from VSTest output";
        }
        return result;
    }
    internal static (JArray Names,bool Parsed) ParseDiscovery(string output)
    {
        var names=new JArray();var listing=false;
        foreach(var line in output.Split('\n')){
            var trimmed=line.Trim();
            if(trimmed.StartsWith("The following Tests are available:",StringComparison.Ordinal)||trimmed.StartsWith("사용할 수 있는 테스트",StringComparison.Ordinal)){listing=true;continue;}
            if(listing&&trimmed.Length>0&&names.Count<500)names.Add(trimmed);
        }
        return(names,listing);
    }
    internal static async Task<string[]> ExpectedFrameworksAsync(string file,string workingDirectory,string? framework,string? configuration,CancellationToken token)
    {
        if(!string.IsNullOrWhiteSpace(framework))return new[]{framework!};
        var arguments=new List<string>{"msbuild",file,"-getProperty:TargetFramework,TargetFrameworks,TargetFrameworkVersion"};
        if(!string.IsNullOrWhiteSpace(configuration))arguments.Add("-property:Configuration="+configuration);
        ProcessResult evaluation;
        try{evaluation=await OwnedProcess.RunAsync(IdeTools.Dotnet(),arguments,workingDirectory,15000,token);}
        catch(OperationCanceledException error)when(!token.IsCancellationRequested){throw new IOException("Evaluating test target frameworks timed out",error);}
        if(evaluation.ExitCode!=0||evaluation.Truncated)throw new IOException("Cannot evaluate test project target frameworks: "+evaluation.Output);
        return ParseFrameworks(evaluation.Output);
    }
    internal static string[] ParseFrameworks(string evaluation)
    {
        JObject root;try{root=JObject.Parse(evaluation);}catch(Newtonsoft.Json.JsonException error){throw new IOException("Cannot parse evaluated test target frameworks",error);}
        if(root["Properties"] is not JObject properties)throw new IOException("Evaluated test target frameworks are missing Properties");
        var singular=(string?)properties["TargetFramework"];
        var plural=(string?)properties["TargetFrameworks"];
        var frameworks=!string.IsNullOrWhiteSpace(singular)?new[]{singular!}:!string.IsNullOrWhiteSpace(plural)?plural!.Split(';'):new[]{(string?)properties["TargetFrameworkVersion"]??""};
        if(frameworks.Length>32||frameworks.Any(value=>string.IsNullOrWhiteSpace(value)||value!=value.Trim())||frameworks.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=frameworks.Length)throw new IOException("Test project target framework list is missing or ambiguous");
        return frameworks;
    }
    internal static JObject ReadReports(IReadOnlyList<string> reports,bool mtp,int expectedCount=1)
    {
        if(reports.Count==0)return new JObject{["available"]=false,["reason"]=mtp?"No TRX result: Microsoft.Testing.Platform requires a registered Microsoft.Testing.Extensions.TrxReport extension and restored dependencies":"No TRX result: verify VSTest support, restored dependencies and adapters",["expectedReportCount"]=expectedCount,["reportCount"]=0};
        if(reports.Count>32)throw new IOException("Too many TRX reports for one test invocation");
        var total=0;var executed=0;var passed=0;var failed=0;var failures=new JArray();
        foreach(var report in reports){
            var parsed=IdeTools.ReadTrx(report);
            if((bool?)parsed["available"]!=true)throw new IOException("TRX report has no result counters: "+Path.GetFileName(report));
            total=checked(total+(int)parsed["total"]!);executed=checked(executed+(int)parsed["executed"]!);passed=checked(passed+(int)parsed["passed"]!);failed=checked(failed+(int)parsed["failed"]!);
            foreach(var failure in (JArray)parsed["failures"]!)if(failures.Count<50)failures.Add(failure.DeepClone());
        }
        return new JObject{["available"]=reports.Count==expectedCount,["reason"]=reports.Count==expectedCount?null:"Expected "+expectedCount+" target framework TRX reports, found "+reports.Count,["total"]=total,["executed"]=executed,["passed"]=passed,["failed"]=failed,["noTests"]=executed==0,["failures"]=failures,["reportCount"]=reports.Count,["expectedReportCount"]=expectedCount,["failuresTruncated"]=failed>failures.Count};
    }
    internal static (JArray Names,bool Parsed) ParseMtpDiscovery(string output)
    {
        var names=new JArray();var expected=-1;var collecting=false;var blocks=0;
        foreach(var line in output.Split('\n')){
            var trimmed=line.Trim();
            var english=Regex.Match(trimmed,@"^Discovered (\d+) tests? in assembly - ");
            var korean=Regex.Match(trimmed,@"^어셈블리에서 (\d+)개의 테스트가 검색됨 - ");
            var match=english.Success?english:korean;
            if(match.Success){
                if(++blocks>1)return(new JArray(),false);
                if(!int.TryParse(match.Groups[1].Value,out expected)||expected>500)return(new JArray(),false);
                collecting=true;continue;
            }
            if(!collecting)continue;
            if(trimmed.Length==0)continue;
            if(line.Length==0||!char.IsWhiteSpace(line[0])){collecting=false;continue;}
            names.Add(trimmed);
            if(names.Count>expected)return(new JArray(),false);
        }
        return(names,blocks==1&&names.Count==expected);
    }
}
