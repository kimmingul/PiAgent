using System;
using System.IO;
using System.Linq;
using System.Xml;
using System.Xml.Linq;
using EnvDTE;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.LanguageServices;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class IdeContextTools
{
    internal static JObject Capture(DTE dte,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        var workspace=(Package.GetGlobalService(typeof(SComponentModel)) as IComponentModel)?.GetService<VisualStudioWorkspace>();
        var solution=workspace?.CurrentSolution;
        var projects=new JArray();var projectCount=0;
        foreach(var project in IdeTools.Projects(dte.Solution.Projects)){
            projectCount++;if(projects.Count>=64)continue;
            try{
                var path=IdeTools.ResolveFile(uri,project.FullName);
                var item=new JObject{["name"]=project.Name,["file"]=IdeTools.Relative(uri,path),["kind"]=project.Kind};
                var semantic=solution?.Projects.FirstOrDefault(p=>string.Equals(p.FilePath,path,StringComparison.OrdinalIgnoreCase));
                if(semantic!=null){item["language"]=semantic.Language;item["documents"]=semantic.DocumentIds.Count;item["references"]=new JArray(semantic.ProjectReferences.Select(r=>solution!.GetProject(r.ProjectId)?.Name));}
                if(new FileInfo(path).Length<=1024*1024){try{
                    using var reader=XmlReader.Create(path,new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=1024*1024});
                    var xml=XDocument.Load(reader);var properties=new JObject();
                    foreach(var name in new[]{"TargetFramework","TargetFrameworks","TargetFrameworkVersion","OutputType","UseWPF","UseWindowsForms","UseWinUI","RuntimeIdentifier","RuntimeIdentifiers"}){
                        var values=xml.Descendants().Where(e=>e.Name.LocalName==name).Select(e=>e.Value).Where(v=>v.Length<=1024).Distinct().Take(8).ToArray();if(values.Length>0)properties[name]=new JArray(values);
                    }item["declaredProperties"]=properties;item["propertiesSource"]="project XML; conditional values are unevaluated";
                }catch(XmlException){}}
                projects.Add(item);
            }catch(IOException){}
        }
        var configurations=new JArray();foreach(SolutionConfiguration config in dte.Solution.SolutionBuild.SolutionConfigurations){if(configurations.Count>=64)break;configurations.Add(new JObject{["name"]=config.Name,["platform"]=(config as EnvDTE80.SolutionConfiguration2)?.PlatformName});}
        var documents=new JArray();var dirty=0;foreach(Document document in dte.Documents){
            if(!document.Saved)dirty++;if(documents.Count>=64)continue;
            try{documents.Add(new JObject{["file"]=IdeTools.Relative(uri,IdeTools.ResolveFile(uri,document.FullName)),["language"]=document.Language,["saved"]=document.Saved,["active"]=document==dte.ActiveDocument});}catch(IOException){}
        }
        var active=dte.Solution.SolutionBuild.ActiveConfiguration;
        var result=new JObject{["solution"]=IdeTools.Relative(uri,dte.Solution.FullName),["configuration"]=active.Name,["platform"]=(active as EnvDTE80.SolutionConfiguration2)?.PlatformName,["configurations"]=configurations,["projects"]=projects,["projectCount"]=projectCount,["projectsTruncated"]=projectCount>64,["documents"]=documents,["dirtyDocumentCount"]=dirty,["buildState"]=dte.Solution.SolutionBuild.BuildState.ToString(),["capturedAt"]=DateTime.UtcNow.ToString("o"),["backend"]="Visual Studio automation / Roslyn",["snapshotRevision"]=solution?.Version.ToString()};
        if(dte.Solution.SolutionBuild.StartupProjects is Array startup)result["startupProjects"]=new JArray(startup.Cast<object>().Select(Convert.ToString));
        var editor=dte.ActiveDocument;if(editor!=null){try{
            var path=IdeTools.ResolveFile(uri,editor.FullName);
            if(editor.Object("TextDocument") is TextDocument text){var body=text.StartPoint.CreateEditPoint().GetText(text.EndPoint);result["editor"]=new JObject{["file"]=IdeTools.Relative(uri,path),["language"]=editor.Language,["saved"]=editor.Saved,["text"]=body.Substring(0,Math.Min(body.Length,32768)),["truncated"]=body.Length>32768,["revision"]=IdeCatalog.Hash(body),["line"]=text.Selection.ActivePoint.Line,["column"]=text.Selection.ActivePoint.LineCharOffset,["selectionStartLine"]=text.Selection.TopPoint.Line,["selectionEndLine"]=text.Selection.BottomPoint.Line};}
        }catch(Exception error)when(error is IOException||error is System.Runtime.InteropServices.COMException){result["editorUnavailable"]=error.Message;}}
        result["stateRevision"]=IdeCatalog.Capture(uri)["revision"];
        return result;
    }
}
