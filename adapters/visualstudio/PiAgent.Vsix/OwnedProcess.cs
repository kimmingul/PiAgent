using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace PiAgent.Vsix;

internal sealed class ProcessResult
{
    public int ExitCode {get;set;}
    public string Output {get;set;}="";
    public bool Truncated {get;set;}
}
/// <summary>Argument-safe bounded execution. A job owns only this launch and its descendants.</summary>
internal static class OwnedProcess
{
    internal static string Quote(string value)
    {
        if(value.IndexOf('\0')>=0||value.IndexOf('\r')>=0||value.IndexOf('\n')>=0)throw new IOException("Invalid process argument");
        var result=new StringBuilder("\"");var slashes=0;
        foreach(var character in value){if(character=='\\'){slashes++;continue;}if(character=='\"'){result.Append('\\',slashes*2+1).Append(character);slashes=0;continue;}result.Append('\\',slashes).Append(character);slashes=0;}
        return result.Append('\\',slashes*2).Append('"').ToString();
    }
    public static async Task<ProcessResult> RunAsync(string executable,IEnumerable<string> arguments,string cwd,int timeout,CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(token);deadline.CancelAfter(timeout);
        using var job=CreateJobObject(IntPtr.Zero,null);if(job.IsInvalid)throw new IOException("Unable to create process job");
        var limits=new ExtendedLimits{Basic=new BasicLimits{LimitFlags=0x2000}};
        if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))))throw new IOException("Unable to configure process cleanup");
        using var process=new Process{StartInfo=new ProcessStartInfo{FileName=executable,Arguments=string.Join(" ",arguments.Select(Quote)),WorkingDirectory=cwd,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8},EnableRaisingEvents=true};
        var finished=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);process.Exited+=(s,e)=>finished.TrySetResult(true);
        if(!process.Start())throw new IOException("Process did not start");
        if(!AssignProcessToJobObject(job,process.Handle)){try{process.Kill();}catch{}throw new IOException("Unable to establish child-process ownership");}
        var body=new StringBuilder();var truncated=false;var gate=new object();
        async Task DrainAsync(StreamReader stream){var buffer=new char[2048];int count;while((count=await stream.ReadAsync(buffer,0,buffer.Length))>0){lock(gate){var retained=Math.Min(count,32768-body.Length);if(retained>0)body.Append(buffer,0,retained);if(retained<count)truncated=true;}}}
        var stdout=DrainAsync(process.StandardOutput);var stderr=DrainAsync(process.StandardError);
        using var cancel=deadline.Token.Register(()=>{TerminateJobObject(job,1);finished.TrySetCanceled();});
        if(process.HasExited)finished.TrySetResult(true);
        try{await finished.Task;TerminateJobObject(job,1);await Task.WhenAll(stdout,stderr);deadline.Token.ThrowIfCancellationRequested();return new ProcessResult{ExitCode=process.ExitCode,Output=body.ToString(),Truncated=truncated};}
        finally{TerminateJobObject(job,1);await Task.WhenAll(stdout,stderr);}
    }
    [StructLayout(LayoutKind.Sequential)]private struct BasicLimits{public long ProcessUserTime,JobUserTime;public uint LimitFlags;public UIntPtr MinWorkingSet,MaxWorkingSet;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
    [StructLayout(LayoutKind.Sequential)]private struct IoCounters{public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;}
    [StructLayout(LayoutKind.Sequential)]private struct ExtendedLimits{public BasicLimits Basic;public IoCounters Io;public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern SafeFileHandle CreateJobObject(IntPtr attributes,string? name);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool SetInformationJobObject(SafeFileHandle job,int kind,ref ExtendedLimits info,uint size);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool AssignProcessToJobObject(SafeFileHandle job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool TerminateJobObject(SafeFileHandle job,uint exitCode);
}
