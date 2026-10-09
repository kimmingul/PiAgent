using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class IdeProfileTools
{
    private static readonly Dictionary<string,JObject> captures=new Dictionary<string,JObject>();
    internal static string Analyzer=>Path.Combine(Path.GetDirectoryName(typeof(IdeProfileTools).Assembly.Location)!,"diagnostics","PiAgent.Diagnostics.exe");
    internal static async Task<JObject> ExecuteAsync(DTE dte,JObject args,string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var operation=(string?)args["operation"]??"cpu";
        if(operation!="cpu"&&operation!="gc"&&operation!="compare")throw new IOException("Profile supports modern .NET CPU or sampled GC/allocation capture");
        JObject? baseline=null;
        if(operation=="compare"){
            if(!captures.TryGetValue((string?)args["baselineTrace"]??"",out baseline)||(string?)baseline["workspaceUri"]!=uri)throw new IOException("Select a recent traceId produced in this workspace for comparison");
            operation=(string)baseline["operation"]!;
        }
        var pid=(int?)args["processId"]??0;var attached=false;
        foreach(EnvDTE.Process process in dte.Debugger.DebuggedProcesses)if(process.ProcessID==pid)attached=true;
        if(!attached)throw new IOException("Profile only a process attached to the current Visual Studio debugger");
        var trace=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".dotnet","tools","dotnet-trace.exe");
        if(!File.Exists(trace))return new JObject{["executed"]=false,["available"]=false,["reason"]="Install the official dotnet-trace tool"};
        if(operation=="gc"&&!File.Exists(Analyzer))return new JObject{["executed"]=false,["available"]=false,["reason"]="PiAgent isolated EventPipe analyzer is not installed"};
        var seconds=(int?)args["durationSeconds"]??10;if(seconds<1||seconds>30)throw new IOException("Trace duration must be 1–30 seconds");
        var cwd=Path.GetDirectoryName(dte.Solution.FullName)!;
        var profiles=await OwnedProcess.RunAsync(trace,new[]{"list-profiles"},cwd,10000,token);
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        if (Path.GetDirectoryName(dte.Solution.FullName) != cwd || !dte.Debugger.DebuggedProcesses.Cast<EnvDTE.Process>().Any(process => { ThreadHelper.ThrowIfNotOnUIThread(); return process.ProcessID == pid; }))
            throw new IOException("Debugged target or solution changed before trace capture");
        var profile=operation=="gc"?"gc-verbose":profiles.Output.Contains("dotnet-sampled-thread-time")?"dotnet-sampled-thread-time":"cpu-sampling";
        var output=Path.Combine(IdeTools.DiagnosticDirectory(),operation+".nettrace");
        using var target=System.Diagnostics.Process.GetProcessById(pid);var cpuBefore=target.TotalProcessorTime.TotalMilliseconds;var watch=Stopwatch.StartNew();
        var capture=await OwnedProcess.RunAsync(trace,new[]{"collect","--process-id",pid.ToString(),"--profile",profile,"--duration",TimeSpan.FromSeconds(seconds).ToString(),"--buffersize","16","--output",output},cwd,60000,token);
        watch.Stop();var cpuDelta=target.HasExited?(double?)null:Math.Max(0,target.TotalProcessorTime.TotalMilliseconds-cpuBefore);
        if(capture.ExitCode!=0||!File.Exists(output))return new JObject{["executed"]=true,["success"]=false,["output"]=capture.Output,["backend"]="dotnet-trace",["operation"]=operation};
        if(new FileInfo(output).Length>64*1024*1024)throw new IOException("Trace exceeds 64 MiB analysis limit");
        JObject metrics;string report;var success=true;
        if(operation=="gc"){
            var analysis=await OwnedProcess.RunAsync(Analyzer,new[]{output},cwd,30000,token);success=analysis.ExitCode==0;report=analysis.Output;
            metrics=success?JObject.Parse(analysis.Output):new JObject{["available"]=false,["reason"]=analysis.Output};
        }else{
            var analysis=await OwnedProcess.RunAsync(trace,new[]{"report",output,"topN","-n","20"},cwd,30000,token);success=analysis.ExitCode==0;report=analysis.Output;
            metrics=new JObject{["processCpuMillisecondsDuringCollectorLifetime"]=cpuDelta,["collectorElapsedMilliseconds"]=watch.ElapsedMilliseconds,["processCpuMillisecondsPerSecond"]=cpuDelta.HasValue&&watch.ElapsedMilliseconds>0?cpuDelta.Value/watch.Elapsed.TotalSeconds:(double?)null};
        }
        var id=Guid.NewGuid().ToString("N");var result=new JObject{["executed"]=true,["success"]=success,["traceId"]=id,["operation"]=operation,["backend"]="dotnet-trace / isolated EventPipe analyzer",["kind"]=operation=="gc"?"modern .NET sampled allocation and GC events":"modern .NET sampled managed stacks",["durationSeconds"]=seconds,["collectorElapsedMilliseconds"]=watch.ElapsedMilliseconds,["metrics"]=metrics,["report"]=report,["traceFile"]=output,["limitations"]="Target workload and tool setup/rundown affect comparisons; supported EventPipe runtimes only"};
        if(baseline!=null)result["comparison"]=new JObject{["baselineTraceId"]=baseline["traceId"],["baselineDurationSeconds"]=baseline["durationSeconds"],["baselineMetrics"]=baseline["metrics"]!.DeepClone(),["currentMetrics"]=metrics.DeepClone(),["sameRequestedDuration"]=(int?)baseline["durationSeconds"]==seconds,["guidance"]="Compare equivalent workload phases and durations; sampled data does not prove causality"};
        if(captures.Count>=8)captures.Remove(captures.Keys.First());var stored=(JObject)result.DeepClone();stored["workspaceUri"]=uri;captures[id]=stored;return result;
    }
}
