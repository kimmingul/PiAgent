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

internal static class IdeRunTools
{
    private sealed class Plan { internal string Workspace="",Revision="",State="",Project="",Output="",ProjectRevision="";internal DateTime Created;internal string[] Arguments=Array.Empty<string>();internal JObject Proposal=null!; }
    private static readonly Dictionary<string,Plan> plans=new Dictionary<string,Plan>();
    internal static async Task<JObject> ExecuteAsync(DTE dte,JObject args,string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var operation=(string?)args["operation"];
        foreach(var key in plans.Where(x=>DateTime.UtcNow-x.Value.Created>TimeSpan.FromMinutes(5)).Select(x=>x.Key).ToArray())plans.Remove(key);
        if(operation=="inspect"){
            var result=IdeContextTools.Capture(dte,uri);var profiles=new JArray();
            foreach(var project in IdeTools.Projects(dte.Solution.Projects)){
                try{var path=IdeTools.ResolveFile(uri,project.FullName);var folder=Path.GetDirectoryName(path)!;
                    var launch=Path.Combine(folder,"Properties","launchSettings.json");var names=new JArray();
                    if(File.Exists(launch)&&new FileInfo(launch).Length<256*1024){IdeTools.ResolveFile(uri,launch);try{var data=JObject.Parse(File.ReadAllText(launch));if(data["profiles"] is JObject declared)foreach(var profile in declared.Properties().Take(32))names.Add(new JObject{["name"]=profile.Name,["commandName"]=profile.Value["commandName"]});}catch(Newtonsoft.Json.JsonException){}}
                    var publish=Path.Combine(folder,"Properties","PublishProfiles");var published=new JArray();
                    if(Directory.Exists(publish)){IdeTools.ResolveFile(uri,publish);foreach(var file in Directory.EnumerateFiles(publish,"*.pubxml").Take(32)){try{published.Add(IdeTools.Relative(uri,IdeTools.ResolveFile(uri,file)));}catch(IOException){}}}
                    profiles.Add(new JObject{["project"]=IdeTools.Relative(uri,path),["launchProfiles"]=names,["publishProfiles"]=published});if(profiles.Count>=64)break;
                }catch(IOException){}
            }
            result["profiles"]=profiles;result["publishScope"]="Only fresh isolated local output through dotnet publish; publish profiles are listed, not executed";return result;
        }
        if(operation=="publish-preview"){
            var file=IdeTools.ResolveFile(uri,(string?)args["project"]??"");
            if(!new[]{".csproj",".vbproj"}.Contains(Path.GetExtension(file),StringComparer.OrdinalIgnoreCase)||!IdeTools.Projects(dte.Solution.Projects).Any(p=>{ThreadHelper.ThrowIfNotOnUIThread();return string.Equals(p.FullName,file,StringComparison.OrdinalIgnoreCase);}))throw new IOException("Select a loaded C#/VB project for local publish");
            var output=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"PiAgent","diagnostics",Guid.NewGuid().ToString("N"),"publish");
            var arguments=new List<string>{"publish",file,"--no-restore","--output",output};foreach(var field in new[]{"configuration","framework"})if(args[field] is JValue value&&!string.IsNullOrWhiteSpace((string?)value)){arguments.Add("--"+field);arguments.Add((string)value!);}
            var proposal=new JObject{["project"]=IdeTools.Relative(uri,file),["backend"]="dotnet publish",["arguments"]=new JArray(arguments),["outputDirectory"]=output,["scope"]="Isolated local artifact; project build targets execute; no cloud or remote publishing"};
            var state=(string)IdeCatalog.Capture(uri)["revision"]!;var projectRevision=IdeCatalog.Hash(File.ReadAllText(file));var revision=IdeCatalog.Hash(proposal.ToString()+state+projectRevision);var id=Guid.NewGuid().ToString("N");
            if(plans.Count>=8)plans.Remove(plans.OrderBy(x=>x.Value.Created).First().Key);
            plans[id]=new Plan{Workspace=uri,Revision=revision,State=state,Project=file,Output=output,ProjectRevision=projectRevision,Created=DateTime.UtcNow,Arguments=arguments.ToArray(),Proposal=proposal};
            return new JObject{["available"]=true,["proposalId"]=id,["revision"]=revision,["proposal"]=proposal,["requiresApproval"]=true};
        }
        if(operation=="publish"){
            var id=(string?)args["proposalId"]??"";
            if(!plans.TryGetValue(id,out var plan)||plan.Workspace!=uri||plan.Revision!=(string?)args["revision"])throw new IOException("Local publish preview expired; prepare a new preview");
            IdeTools.CleanBuffers(dte);
            if((string?)IdeCatalog.Capture(uri)["revision"]!=plan.State||IdeCatalog.Hash(File.ReadAllText(plan.Project))!=plan.ProjectRevision)throw new IOException("Project or IDE state changed; review a new publish preview");
            token.ThrowIfCancellationRequested();plans.Remove(id);
            if(Directory.Exists(plan.Output))throw new IOException("Publish output already exists; refuse to overwrite it");
            Directory.CreateDirectory(plan.Output);
            var run=await OwnedProcess.RunAsync(IdeTools.Dotnet(),plan.Arguments,Path.GetDirectoryName(plan.Project)!,150000,token);
            return new JObject{["executed"]=true,["success"]=run.ExitCode==0,["exitCode"]=run.ExitCode,["output"]=run.Output,["truncated"]=run.Truncated,["outputDirectory"]=plan.Output,["backend"]="dotnet publish",["scope"]="isolated local output",["fileCount"]=Directory.EnumerateFiles(plan.Output,"*",SearchOption.AllDirectories).Take(10001).Count()};
        }
        throw new IOException("Unsupported run/publish operation");
    }
}
