using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class IdeBuildTools
{
    internal static async Task<JObject> ExecuteAsync(DTE dte,JObject args,string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);IdeTools.CleanBuffers(dte);
        var solutionFile=dte.Solution.FullName;
        var manager=Package.GetGlobalService(typeof(SVsSolutionBuildManager)) as IVsSolutionBuildManager2??throw new IOException("Native VS build manager is unavailable");
        ErrorHandler.ThrowOnFailure(manager.QueryBuildManagerBusy(out var busy));if(busy!=0)throw new IOException("Another Visual Studio build is already running");
        var operation=(string?)args["operation"]??((bool?)args["rebuild"]==true?"rebuild":"build");
        var flags=Flags(operation);
        var projectPath=(string?)args["project"];
        var configuration=(string?)args["configuration"];var platform=(string?)args["platform"];
        var selected=IdeTools.Projects(dte.Solution.Projects).ToArray();
        if(projectPath!=null){var path=IdeTools.ResolveFile(uri,projectPath);selected=selected.Where(p=>{ThreadHelper.ThrowIfNotOnUIThread();return string.Equals(p.FullName,path,StringComparison.OrdinalIgnoreCase);}).ToArray();if(selected.Length!=1)throw new IOException("Select a loaded project in the current solution");}
        var hierarchies=new IVsHierarchy[selected.Length];var cfgs=new IVsCfg[selected.Length];
        var solutionService=Package.GetGlobalService(typeof(SVsSolution)) as IVsSolution??throw new IOException("Solution service is unavailable");
        for(var index=0;index<selected.Length;index++){
            IdeTools.ResolveFile(uri,selected[index].FullName);
            ErrorHandler.ThrowOnFailure(solutionService.GetProjectOfUniqueName(selected[index].UniqueName,out hierarchies[index]));
            if(configuration!=null||platform!=null){
                var contexts=dte.Solution.SolutionBuild.ActiveConfiguration.SolutionContexts;
                SolutionContext? context=null;foreach(SolutionContext candidate in contexts)if(string.Equals(candidate.ProjectName,selected[index].UniqueName,StringComparison.OrdinalIgnoreCase)){context=candidate;break;}
                var requestedConfiguration=configuration??context?.ConfigurationName??dte.Solution.SolutionBuild.ActiveConfiguration.Name;
                var requestedPlatform=platform??context?.PlatformName??"Any CPU";
                IVsCfgProvider2? provider2 = null;
                if(hierarchies[index] is IVsGetCfgProvider provider){ErrorHandler.ThrowOnFailure(provider.GetCfgProvider(out var cfgProvider));provider2=cfgProvider as IVsCfgProvider2;}
                if(provider2==null){
                    // Legacy project hierarchies may expose only the active configuration.
                    // Resolve that actual configuration without silently changing the target.
                    if(context==null||!ActiveConfigurationMatches(requestedConfiguration,requestedPlatform,context.ConfigurationName,context.PlatformName))throw new IOException("Project exposes only its active configuration; select the requested configuration in Visual Studio first");
                    var activeCfg=new IVsProjectCfg[1];ErrorHandler.ThrowOnFailure(manager.FindActiveProjectCfg(IntPtr.Zero,IntPtr.Zero,hierarchies[index],activeCfg));cfgs[index]=activeCfg[0]??throw new IOException("Active native project configuration is unavailable");continue;
                }
                var hr=provider2.GetCfgOfName(requestedConfiguration,requestedPlatform,out var cfg);
                if(hr<0||cfg==null){foreach(var alias in PlatformNames(requestedPlatform).Skip(1)){hr=provider2.GetCfgOfName(requestedConfiguration,alias,out cfg);if(hr>=0&&cfg!=null)break;}}
                if(hr<0||cfg==null)throw new IOException("GetCfgOfName could not resolve "+requestedConfiguration+"|"+requestedPlatform+" (HRESULT 0x"+hr.ToString("X8")+")");cfgs[index]=cfg;
            }else{
                var cfg=new IVsProjectCfg[1];ErrorHandler.ThrowOnFailure(manager.FindActiveProjectCfg(IntPtr.Zero,IntPtr.Zero,hierarchies[index],cfg));cfgs[index]=cfg[0];
            }
        }
        var events=new Completion();ErrorHandler.ThrowOnFailure(manager.AdviseUpdateSolutionEvents(events,out var cookie));var started=false;
        try{
            token.ThrowIfCancellationRequested();
            if(projectPath==null&&configuration==null&&platform==null)ErrorHandler.ThrowOnFailure(manager.StartSimpleUpdateSolutionConfiguration(flags,0,1));
            else{if(selected.Length==0)throw new IOException("No loaded buildable projects");var hr=manager.StartUpdateSpecificProjectConfigurations((uint)selected.Length,hierarchies,cfgs,new uint[selected.Length],new uint[selected.Length],new uint[selected.Length],flags,1);if(hr<0)throw new IOException("StartUpdateSpecificProjectConfigurations failed (HRESULT 0x"+hr.ToString("X8")+")");}
            started=true;
            // The native VS build event completes this asynchronous TCS on the UI thread.
#pragma warning disable VSTHRD003
            var timeout=Task.Delay(150000,token);var completed=await Task.WhenAny(events.Done.Task,timeout);token.ThrowIfCancellationRequested();
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            if(dte.Solution.FullName!=solutionFile)throw new IOException("Solution changed during build");
            if(completed!=events.Done.Task)throw new IOException("Visual Studio build timed out");
            var result=await events.Done.Task;result["executed"]=true;result["operation"]=operation;result["backend"]="IVsSolutionBuildManager2";result["project"]=projectPath;result["scope"]=projectPath==null&&configuration==null&&platform==null?"solution build with native dependency management":"explicit project configurations only; native API does not build dependency projects";result["configuration"]=configuration??dte.Solution.SolutionBuild.ActiveConfiguration.Name;result["platform"]=platform;result["output"]=Output(dte);return result;
#pragma warning restore VSTHRD003
        }catch{
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            if(started&&!events.Done.Task.IsCompleted&&dte.Solution.FullName==solutionFile)manager.CancelUpdateSolutionConfiguration();throw;
        }finally{await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();manager.UnadviseUpdateSolutionEvents(cookie);}
    }
    internal static string[] PlatformNames(string platform)=>platform.Equals("Any CPU",StringComparison.OrdinalIgnoreCase)?new[]{platform,"AnyCPU"}:platform.Equals("AnyCPU",StringComparison.OrdinalIgnoreCase)?new[]{platform,"Any CPU"}:new[]{platform};
    internal static bool ActiveConfigurationMatches(string requestedConfiguration,string requestedPlatform,string activeConfiguration,string activePlatform)=>string.Equals(requestedConfiguration,activeConfiguration,StringComparison.OrdinalIgnoreCase)&&PlatformNames(requestedPlatform).Any(p=>string.Equals(p,activePlatform,StringComparison.OrdinalIgnoreCase));
    internal static uint Flags(string operation)=>operation=="build"?(uint)VSSOLNBUILDUPDATEFLAGS.SBF_OPERATION_BUILD:operation=="clean"?(uint)VSSOLNBUILDUPDATEFLAGS.SBF_OPERATION_CLEAN:operation=="rebuild"?(uint)(VSSOLNBUILDUPDATEFLAGS.SBF_OPERATION_BUILD|VSSOLNBUILDUPDATEFLAGS.SBF_OPERATION_FORCE_UPDATE):throw new IOException("Unsupported build operation");
    private static string Output(DTE dte)
    {
        ThreadHelper.ThrowIfNotOnUIThread();try{foreach(OutputWindowPane pane in ((EnvDTE80.DTE2)dte).ToolWindows.OutputWindow.OutputWindowPanes){if(Guid.TryParse(pane.Guid,out var id)&&id==VSConstants.GUID_BuildOutputWindowPane){var text=pane.TextDocument.StartPoint.CreateEditPoint().GetText(pane.TextDocument.EndPoint);return text.Substring(Math.Max(0,text.Length-32768));}}}catch(System.Runtime.InteropServices.COMException){}return "";
    }
    private sealed class Completion:IVsUpdateSolutionEvents
    {
        internal readonly TaskCompletionSource<JObject> Done=new TaskCompletionSource<JObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        public int UpdateSolution_Begin(ref int cancel)=>VSConstants.S_OK;
        public int UpdateSolution_StartUpdate(ref int cancel)=>VSConstants.S_OK;
        public int UpdateSolution_Done(int succeeded,int modified,int cancelled){Done.TrySetResult(new JObject{["success"]=succeeded!=0&&cancelled==0,["cancelled"]=cancelled!=0,["modified"]=modified!=0,["settled"]=true});return VSConstants.S_OK;}
        public int UpdateSolution_Cancel(){Done.TrySetResult(new JObject{["success"]=false,["cancelled"]=true,["settled"]=true});return VSConstants.S_OK;}
        public int OnActiveProjectCfgChange(IVsHierarchy hierarchy)=>VSConstants.S_OK;
    }
}
