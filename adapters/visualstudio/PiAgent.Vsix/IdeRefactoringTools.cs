using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Formatting;
using Microsoft.CodeAnalysis.Rename;
using Microsoft.CodeAnalysis.Simplification;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.LanguageServices;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class IdeRefactoringTools
{
    private sealed class Preview
    {
        internal string Workspace="",Revision="",State="";internal Solution Before=null!,After=null!;internal DateTime Created;internal JObject Result=null!;
    }
    private static readonly Dictionary<string,Preview> previews=new Dictionary<string,Preview>();
    internal static async Task<JObject> ExecuteAsync(JObject args,string uri,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var workspace=(Package.GetGlobalService(typeof(SComponentModel)) as IComponentModel)?.GetService<VisualStudioWorkspace>()??throw new IOException("Roslyn workspace is unavailable");
        var operation=(string?)args["operation"];
        foreach(var key in previews.Where(x=>DateTime.UtcNow-x.Value.Created>TimeSpan.FromMinutes(5)).Select(x=>x.Key).ToArray())previews.Remove(key);
        if(operation=="apply"){
            var id=(string?)args["proposalId"]??"";
            if(!previews.TryGetValue(id,out var preview)||preview.Workspace!=uri||preview.Revision!=(string?)args["revision"])throw new IOException("Refactoring preview expired or does not match this workspace");
            IdeTools.CleanBuffers(Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE??throw new IOException("IDE unavailable"));
            var current=workspace.CurrentSolution;
            var checkedState=await FingerprintAsync(current,token);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            if(!ReferenceEquals(workspace.CurrentSolution,current)){current=workspace.CurrentSolution;checkedState=await FingerprintAsync(current,token);}
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            if(!ReferenceEquals(workspace.CurrentSolution,current)||checkedState!=preview.State)throw new IOException("Semantic solution changed; prepare and review a new refactoring preview");
            IdeTools.CleanBuffers(Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE??throw new IOException("IDE unavailable"));
            foreach(var file in (JArray)preview.Result["files"]!){var path=IdeTools.ResolveFile(uri,(string)file["path"]!);if(IdeCatalog.Hash(File.ReadAllText(path))!=(string)file["beforeRevision"]!)throw new IOException("Refactoring target changed on disk; prepare a new preview");}
            token.ThrowIfCancellationRequested();previews.Remove(id);
            var dte=(EnvDTE.DTE)Package.GetGlobalService(typeof(EnvDTE.DTE));
            // Closed-document workspace edits may go directly to disk and create no editor undo.
            // Open every reviewed target before applying the Roslyn solution delta.
            foreach(var target in (JArray)preview.Result["files"]!){
                var targetPath=IdeTools.ResolveFile(uri,(string)target["path"]!);
                var window=dte.ItemOperations.OpenFile(targetPath,EnvDTE.Constants.vsViewKindTextView);window.Activate();
                var opened=dte.Documents.Cast<EnvDTE.Document>().First(doc=>{ThreadHelper.ThrowIfNotOnUIThread();return string.Equals(doc.FullName,targetPath,StringComparison.OrdinalIgnoreCase);});
                if(DesignerTools.Read(opened)!=(string)target["before"]!)throw new IOException("Refactoring target editor changed; prepare a new preview");
            }
            var reviewed=(JArray)preview.Result["files"]!;
            var rebased=RebaseReviewed(workspace.CurrentSolution,reviewed,uri,false);
            if(dte.UndoContext.IsOpen)throw new IOException("Another IDE undo transaction is active");
            dte.UndoContext.Open("PiAgent semantic refactoring");
            try{
                if(!workspace.TryApplyChanges(rebased))throw new IOException("Visual Studio refused the refactoring changes");
                foreach(var file in (JArray)preview.Result["files"]!){var path=IdeTools.ResolveFile(uri,(string)file["path"]!);dte.ItemOperations.OpenFile(path);var document=dte.Documents.Cast<EnvDTE.Document>().FirstOrDefault(d=>{ThreadHelper.ThrowIfNotOnUIThread();return string.Equals(d.FullName,path,StringComparison.OrdinalIgnoreCase);})??throw new IOException("Refactoring editor unavailable");document.Save();if(File.ReadAllText(path)!=(string)file["after"]!)throw new IOException("Refactoring target was not saved as proposed");}
            }catch(Exception failure){
                // Compensate only when every disk/buffer still equals an owned before/after state.
                // Never save over a watcher, user or external process's intervening changes.
                var safe=true;
                foreach(var file in (JArray)preview.Result["files"]!){try{var path=IdeTools.ResolveFile(uri,(string)file["path"]!);var disk=File.ReadAllText(path);safe&=disk==(string)file["before"]!||disk==(string)file["after"]!;foreach(var targetId in workspace.CurrentSolution.GetDocumentIdsWithFilePath(path)){var document=workspace.CurrentSolution.GetDocument(targetId)!;safe&=document.TryGetText(out var text)&&(text.ToString()==(string)file["before"]!||text.ToString()==(string)file["after"]!);}}catch{safe=false;}}
                var unchanged=true;
                foreach(var file in reviewed){var targetPath=IdeTools.ResolveFile(uri,(string)file["path"]!);unchanged&=File.ReadAllText(targetPath)==(string)file["before"]!;foreach(var targetId in workspace.CurrentSolution.GetDocumentIdsWithFilePath(targetPath))unchanged&=workspace.CurrentSolution.GetDocument(targetId)!.TryGetText(out var unchangedText)&&unchangedText.ToString()==(string)file["before"]!;}
                if(unchanged)throw new IOException("Visual Studio refused the reviewed refactoring; target buffers and files remain unchanged",failure);
                var rolledBack=false;
                if(safe){try{rolledBack=workspace.TryApplyChanges(RebaseReviewed(workspace.CurrentSolution,reviewed,uri,true));}catch(IOException){rolledBack=false;}}
                if(rolledBack)foreach(var file in (JArray)preview.Result["files"]!){try{var path=IdeTools.ResolveFile(uri,(string)file["path"]!);var disk=File.ReadAllText(path);if(disk!=(string)file["before"]!&&disk!=(string)file["after"]!){rolledBack=false;continue;}foreach(EnvDTE.Document document in dte.Documents)if(string.Equals(document.FullName,path,StringComparison.OrdinalIgnoreCase))document.Save();rolledBack&=File.ReadAllText(path)==(string)file["before"]!;}catch{rolledBack=false;}}
                throw new IOException(rolledBack?"Refactoring save failed; original files restored":"Refactoring save failed and rollback was incomplete; inspect target buffers and files before retrying",failure);
            }finally{dte.UndoContext.Close();}
            return new JObject{["executed"]=true,["applied"]=true,["saved"]=true,["operation"]=preview.Result["operation"],["files"]=new JArray(((JArray)preview.Result["files"]!).Select(x=>x["path"])),["backend"]="Roslyn / Visual Studio workspace",["undoMechanism"]="DTE.UndoContext with opened target editors",["nativeUndoVerified"]=false};
        }
        var sourcePath=IdeTools.ResolveFile(uri,(string?)args["file"]??"");
        // Workspace hosts may finish generated-source/reference updates after native build events.
        // Retry only the read-only computation on a quiescent semantic snapshot; never retry apply.
        for(var attempt=0;attempt<3;attempt++){
            var stable=await QuiescentAsync(workspace,token);var before=stable.Solution;var state=stable.State;
            var documentId=before.GetDocumentIdsWithFilePath(sourcePath).FirstOrDefault(id=>before.GetDocument(id)?.Project.Language==LanguageNames.CSharp||before.GetDocument(id)?.Project.Language==LanguageNames.VisualBasic)??throw new IOException("Refactoring supports a loaded C#/VB document");
            var result=await PrepareAsync(before,documentId,args,uri,token);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            var current=workspace.CurrentSolution;
            var afterPreparation=await FingerprintAsync(current,token);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            if(afterPreparation!=state)continue;
            result.Result["revision"]=IdeCatalog.Hash((string)result.Result["revision"]!+"\n"+state);result.Result["solutionRevision"]=state;
            if(previews.Count>=8)previews.Remove(previews.OrderBy(x=>x.Value.Created).First().Key);
            var proposalId=Guid.NewGuid().ToString("N");result.Result["proposalId"]=proposalId;
            previews.Add(proposalId,new Preview{Workspace=uri,State=state,Revision=(string)result.Result["revision"]!,Before=before,After=result.After,Created=DateTime.UtcNow,Result=result.Result});
            return result.Result;
        }
        throw new IOException("Semantic workspace is still changing; wait for project loading to finish before preparing a preview");
    }
    internal static Solution RebaseReviewed(Solution current,JArray reviewed,string uri,bool restore)
    {
        var result=current;
        foreach(var file in reviewed.OfType<JObject>()){
            var path=IdeTools.ResolveFile(uri,(string)file["path"]!);
            var documents=current.Projects.SelectMany(project=>project.Documents).Where(document=>string.Equals(document.FilePath,path,StringComparison.OrdinalIgnoreCase)).ToArray();
            if(documents.Length==0)throw new IOException("Reviewed refactoring document is no longer loaded");
            foreach(var document in documents){
                if(!document.TryGetText(out var text))throw new IOException("Target editor is still loading; prepare a new preview");
                var before=(string)file["before"]!;var after=(string)file["after"]!;
                if(text.ToString()!=before&&(!restore||text.ToString()!=after))throw new IOException("Reviewed target buffer changed; existing edits were preserved");
                result=result.WithDocumentText(document.Id,Microsoft.CodeAnalysis.Text.SourceText.From(restore?before:after,text.Encoding));
            }
        }
        return result;
    }
    private static async Task<(Solution Solution,string State)> QuiescentAsync(VisualStudioWorkspace workspace,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var previous=await FingerprintAsync(workspace.CurrentSolution,token);
        for(var attempt=0;attempt<12;attempt++){
            await Task.Delay(250,token);await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            var snapshot=workspace.CurrentSolution;var state=await FingerprintAsync(snapshot,token);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            if(state==previous)return(snapshot,state);previous=state;
        }
        throw new IOException("Wait for the semantic workspace to finish loading");
    }
    internal static async Task<string> FingerprintAsync(Solution solution,CancellationToken token)
    {
        // Solution.Version only describes the solution file. Dependent project versions
        // include source content and referenced projects, so unrelated semantic edits invalidate.
        var versions=await Task.WhenAll(solution.Projects.OrderBy(project=>project.Id.ToString(),StringComparer.Ordinal).Select(async project=>project.Id+":"+project.Version+":"+await project.GetDependentVersionAsync(token)));
        return IdeCatalog.Hash(solution.Version+"\n"+string.Join("\n",versions));
    }
    internal static async Task<(Solution After,JObject Result)> PrepareAsync(Solution before,DocumentId id,JObject args,string uri,CancellationToken token)
    {
        var document=before.GetDocument(id)??throw new IOException("Document unavailable");var operation=(string?)args["operation"];Solution after;
        if(operation=="rename"){
            var name=(string?)args["newName"]??"";if(name.Length<1||name.Length>256)throw new IOException("A bounded new symbol name is required");
            var text=await document.GetTextAsync(token);var line=(int?)args["line"]??0;var column=(int?)args["column"]??0;
            if(line<1||line>text.Lines.Count||column<1||column>text.Lines[line-1].Span.Length+1)throw new IOException("Symbol position is outside the snapshot");
            var symbol=await SymbolFinder.FindSymbolAtPositionAsync(document,text.Lines[line-1].Start+column-1,token)??throw new IOException("No semantic symbol at the selected position");
            if(!symbol.Locations.Any(l=>l.IsInSource))throw new IOException("Rename requires a source symbol");
            after=await Renamer.RenameSymbolAsync(before,symbol,new SymbolRenameOptions(false,false,false,false),name,token);
        }else if(operation=="format")after=(await Formatter.FormatAsync(document,cancellationToken:token)).Project.Solution;
        else if(operation=="simplify")after=(await Simplifier.ReduceAsync(document,cancellationToken:token)).Project.Solution;
        else throw new IOException("Unsupported refactoring operation");
        var files=new JArray();var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var changes=after.GetChanges(before);
        foreach(var project in changes.GetProjectChanges()){
            if(project.GetAddedDocuments().Any()||project.GetRemovedDocuments().Any())throw new IOException("Refactoring file creation/removal is not supported");
            foreach(var changedId in project.GetChangedDocuments()){
                var old=before.GetDocument(changedId)!;var updated=after.GetDocument(changedId)!;
                var path=IdeTools.ResolveFile(uri,old.FilePath??"");var oldText=(await old.GetTextAsync(token)).ToString();var newText=(await updated.GetTextAsync(token)).ToString();
                var tree=await updated.GetSyntaxRootAsync(token);if(tree!=null&&tree.GetAnnotatedNodesAndTokens(Microsoft.CodeAnalysis.CodeActions.ConflictAnnotation.Kind).Any())throw new IOException("Semantic rename has unresolved conflicts; choose a different name");
                if(seen.Contains(path)){if(files.OfType<JObject>().First(f=>(string)f["path"]! ==IdeTools.Relative(uri,path))["after"]!.Value<string>()!=newText)throw new IOException("Linked document changes conflict");continue;}seen.Add(path);
                if(files.Count>=8||System.Text.Encoding.UTF8.GetByteCount(oldText)>128*1024||System.Text.Encoding.UTF8.GetByteCount(newText)>128*1024)throw new IOException("Refactoring preview exceeds limits; narrow the operation");
                files.Add(new JObject{["path"]=IdeTools.Relative(uri,path),["before"]=oldText,["after"]=newText,["beforeRevision"]=IdeCatalog.Hash(oldText)});
            }
        }
        if(System.Text.Encoding.UTF8.GetByteCount(files.ToString(Newtonsoft.Json.Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>()))>220*1024)throw new IOException("Refactoring preview exceeds 220 KiB; narrow the operation");
        if(files.Sum(x=>System.Text.Encoding.UTF8.GetByteCount((string)x["before"]!))>128*1024||files.Sum(x=>System.Text.Encoding.UTF8.GetByteCount((string)x["after"]!))>128*1024)throw new IOException("Refactoring preview exceeds 128 KiB per side");
        var revision=IdeCatalog.Hash(before.Version+"\n"+files.ToString(Newtonsoft.Json.Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));
        return (after,new JObject{["available"]=true,["operation"]=operation,["revision"]=revision,["files"]=files,["requiresApproval"]=true,["backend"]="Roslyn",["scope"]="Existing C#/VB files; apply requires saved buffers"});
    }
}
