using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class IdeDebugTools
{
    internal static async Task<JObject> ExecuteAsync(DTE dte,JObject args,string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var debugger=dte.Debugger;var operation=(string?)args["operation"];
        if(operation=="snapshot"||operation=="threads")return Snapshot(debugger,uri);
        if(operation=="breakpoints")return Breakpoints(debugger,uri);
        if(operation=="breakpoint"){
            var file=IdeTools.ResolveFile(uri,(string?)args["file"]??"");var line=(int?)args["line"]??0;
            if(line<1||line>File.ReadLines(file).Count())throw new IOException("Breakpoint line is outside the source file");
            var condition=(string?)args["condition"]??"";var hits=(int?)args["hitCount"]??0;
            var created=debugger.Breakpoints.Add(File:file,Line:line,Condition:condition,ConditionType:dbgBreakpointConditionType.dbgBreakpointConditionTypeWhenTrue,HitCount:hits,HitCountType:dbgHitCountType.dbgHitCountTypeEqual);
            foreach(Breakpoint breakpoint in created)breakpoint.Tag="PiAgent:"+Guid.NewGuid().ToString("N");
            var result=Breakpoints(debugger,uri);result["executed"]=true;result["operation"]=operation;result["settled"]=true;return result;
        }
        if(operation=="removeBreakpoint"||operation=="enableBreakpoint"){
            var id=(string?)args["breakpointId"]??"";Breakpoint? target=null;var index=0;
            foreach(Breakpoint breakpoint in debugger.Breakpoints){if(Id(breakpoint,index++)==id){IdeTools.ResolveFile(uri,breakpoint.File);target=breakpoint;break;}}
            if(target==null)throw new IOException("Breakpoint changed or was removed; list breakpoints again");
            if(operation=="removeBreakpoint")target.Delete();else target.Enabled=(bool?)args["enabled"]??throw new IOException("Breakpoint enabled value is required");
            return new JObject{["executed"]=true,["operation"]=operation,["settled"]=true,["breakpoints"]=Breakpoints(debugger,uri)["breakpoints"]};
        }
        if(operation=="evaluate"){
            Paused(debugger);var expression=(string?)args["expression"]??"";if(expression.Length<1||expression.Length>1024)throw new IOException("Expression must contain 1–1024 characters");
            var value=debugger.GetExpression(expression,false,1000);
            return new JObject{["executed"]=true,["valid"]=value.IsValidValue,["type"]=value.Type,["value"]=Bound(value.Value,4096),["backend"]="EnvDTE.Debugger.GetExpression",["evaluationCanExecuteCode"]=true,["timeoutMilliseconds"]=1000};
        }
        if(operation=="selectThread"){
            Paused(debugger);var id=(int?)args["threadId"]??0;EnvDTE.Thread? target=null;
            foreach(EnvDTE.Process process in debugger.DebuggedProcesses)foreach(EnvDTE.Program program in process.Programs)foreach(EnvDTE.Thread thread in program.Threads)if(thread.ID==id){if(target!=null)throw new IOException("Thread ID is ambiguous across processes");target=thread;}
            if(target==null)throw new IOException("Paused thread is unavailable");debugger.CurrentThread=target;
            var result=Snapshot(debugger,uri);result["executed"]=true;result["settled"]=true;return result;
        }
        if(operation=="selectFrame"){
            Paused(debugger);var index=(int?)args["frameIndex"]??-1;var frames=debugger.CurrentThread.StackFrames.Cast<StackFrame>().ToArray();if(index<0||index>=frames.Length)throw new IOException("Frame index is outside the paused stack");debugger.CurrentStackFrame=frames[index];
            var result=Snapshot(debugger,uri);result["executed"]=true;result["settled"]=true;return result;
        }
        var solution=dte.Solution.FullName;
        if(operation=="start"){IdeTools.CleanBuffers(dte);if(debugger.CurrentMode!=dbgDebugMode.dbgDesignMode)throw new IOException("Debugger is already active");if(dte.Solution.SolutionBuild.BuildState==vsBuildState.vsBuildStateInProgress)throw new IOException("Wait for the current build");}
        else if(operation=="pause"){if(debugger.CurrentMode!=dbgDebugMode.dbgRunMode)throw new IOException("Debugger is not running");}
        else if(operation=="stop"){if(debugger.CurrentMode==dbgDebugMode.dbgDesignMode)throw new IOException("No active debugger");}
        else Paused(debugger);
        var events=dte.Events.DebuggerEvents;var completed=new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        _dispDebuggerEvents_OnEnterBreakModeEventHandler onBreak=(dbgEventReason reason,ref dbgExecutionAction action)=>completed.TrySetResult("paused");
        _dispDebuggerEvents_OnEnterRunModeEventHandler onRun=reason=>{if(operation=="start"||operation=="continue")completed.TrySetResult("running");};
        _dispDebuggerEvents_OnEnterDesignModeEventHandler onDesign=reason=>completed.TrySetResult("design");
        events.OnEnterBreakMode+=onBreak;events.OnEnterRunMode+=onRun;events.OnEnterDesignMode+=onDesign;
        try{
            token.ThrowIfCancellationRequested();
            switch(operation){case "start":case "continue":debugger.Go(false);break;case "pause":debugger.Break(false);break;case "stepOver":debugger.StepOver(false);break;case "stepInto":debugger.StepInto(false);break;case "stepOut":debugger.StepOut(false);break;case "stop":debugger.Stop(false);break;default:throw new IOException("Unsupported debugger operation");}
            var finished=await Task.WhenAny(completed.Task,Task.Delay(10000,token));token.ThrowIfCancellationRequested();await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            if(dte.Solution.FullName!=solution)throw new IOException("Solution changed during debugger control; inspect current state");
            return new JObject{["executed"]=true,["operation"]=operation,["mode"]=debugger.CurrentMode.ToString(),["settled"]=finished==completed.Task,["transition"]=completed.Task.IsCompleted?await completed.Task:"pending",["backend"]="EnvDTE.Debugger / DebuggerEvents",["guidance"]=finished==completed.Task?null:"Command dispatched; state did not settle within 10 seconds. Inspect before taking another action"};
        }finally{await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();events.OnEnterBreakMode-=onBreak;events.OnEnterRunMode-=onRun;events.OnEnterDesignMode-=onDesign;}
    }
    private static void Paused(Debugger debugger){ThreadHelper.ThrowIfNotOnUIThread();if(debugger.CurrentMode!=dbgDebugMode.dbgBreakMode)throw new IOException("Pause the debugger first");}
    private static string Bound(string? text,int maximum=512)=>text==null?"":text.Substring(0,Math.Min(text.Length,maximum));
    private static string Id(Breakpoint bp,int index){ThreadHelper.ThrowIfNotOnUIThread();return bp.Tag?.StartsWith("PiAgent:",StringComparison.Ordinal)==true?bp.Tag:IdeCatalog.Hash(index+"\n"+bp.File+"\n"+bp.FileLine+"\n"+bp.FunctionName+"\n"+bp.Condition);}
    private static JObject Breakpoints(Debugger debugger,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();var rows=new JArray();var index=0;
        foreach(Breakpoint bp in debugger.Breakpoints){var id=Id(bp,index++);if(rows.Count>=100)break;try{var file=IdeTools.Relative(uri,IdeTools.ResolveFile(uri,bp.File));rows.Add(new JObject{["id"]=id,["file"]=file,["line"]=bp.FileLine,["enabled"]=bp.Enabled,["condition"]=Bound(bp.Condition,1024),["hitCount"]=bp.CurrentHits,["hitCountTarget"]=bp.HitCountTarget,["bound"]=bp.Children.Count>0});}catch(IOException){}}
        return new JObject{["available"]=true,["mode"]=debugger.CurrentMode.ToString(),["breakpoints"]=rows,["truncated"]=debugger.Breakpoints.Count>100,["backend"]="EnvDTE.Debugger"};
    }
    private static JObject Snapshot(Debugger debugger,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();var processes=new JArray();var threads=new JArray();var frames=new JArray();
        foreach(EnvDTE.Process process in debugger.DebuggedProcesses){if(processes.Count>=8)break;processes.Add(new JObject{["processId"]=process.ProcessID,["name"]=Path.GetFileName(process.Name)});
            foreach(EnvDTE.Program program in process.Programs)foreach(EnvDTE.Thread thread in program.Threads){if(threads.Count>=64)break;var row=new JObject{["processId"]=process.ProcessID,["threadId"]=thread.ID,["selected"]=debugger.CurrentMode==dbgDebugMode.dbgBreakMode&&debugger.CurrentThread?.ID==thread.ID};
                Optional(row,"name",()=>{ThreadHelper.ThrowIfNotOnUIThread();return Bound(thread.Name);});
                Optional(row,"alive",()=>{ThreadHelper.ThrowIfNotOnUIThread();return thread.IsAlive;});
                Optional(row,"frozen",()=>{ThreadHelper.ThrowIfNotOnUIThread();return thread.IsFrozen;});
                Optional(row,"location",()=>{ThreadHelper.ThrowIfNotOnUIThread();return Bound(thread.Location);});threads.Add(row);}
        }
        var result=new JObject{["mode"]=debugger.CurrentMode.ToString(),["reason"]=debugger.LastBreakReason.ToString(),["processes"]=processes,["threads"]=threads,["backend"]="EnvDTE.Debugger",["capturedAt"]=DateTime.UtcNow.ToString("o")};
        if(debugger.CurrentMode!=dbgDebugMode.dbgBreakMode){result["available"]=false;result["guidance"]="Pause at a breakpoint to inspect stack and variables";return result;}
        var currentThread=debugger.CurrentThread??throw new IOException("Paused current thread is unavailable");var index=0;foreach(StackFrame frame in currentThread.StackFrames){if(frames.Count>=32)break;var row=new JObject{["index"]=index++,["selected"]=frame==debugger.CurrentStackFrame};
            Optional(row,"function",()=>{ThreadHelper.ThrowIfNotOnUIThread();return frame.FunctionName;});Optional(row,"language",()=>{ThreadHelper.ThrowIfNotOnUIThread();return frame.Language;});
            Optional(row,"module",()=>{ThreadHelper.ThrowIfNotOnUIThread();return Path.GetFileName(frame.Module);});Optional(row,"locals",()=>{ThreadHelper.ThrowIfNotOnUIThread();return Values(frame.Locals);});Optional(row,"arguments",()=>{ThreadHelper.ThrowIfNotOnUIThread();return Values(frame.Arguments);});frames.Add(row);}
        result["available"]=true;result["selectedThreadId"]=currentThread.ID;result["stack"]=frames;return result;
    }
    internal static void Optional(JObject row,string name,Func<object?> read)
    {
        try{var value=read();row[name]=value==null?null:value is JToken json?json:JToken.FromObject(value);}
        catch(System.Runtime.InteropServices.COMException error){row[name+"Unavailable"]=new JObject{["hresult"]="0x"+error.ErrorCode.ToString("X8"),["reason"]="Debugger engine does not expose this field"};}
    }
    private static JArray Values(Expressions values){ThreadHelper.ThrowIfNotOnUIThread();var rows=new JArray();foreach(Expression expression in values){if(rows.Count>=16)break;rows.Add(new JObject{["name"]=expression.Name,["type"]=expression.Type,["value"]=Bound(expression.Value),["valid"]=expression.IsValidValue});}return rows;}
}
