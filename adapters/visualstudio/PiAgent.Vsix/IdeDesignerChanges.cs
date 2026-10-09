using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.Design;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using EnvDTE;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell.Interop;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

/// <summary>Owned, revision-bound source/form journals; no out-of-process designer reflection.</summary>
internal static class IdeDesignerChanges
{
    private sealed class FileState { internal string Path="",BeforeText="",AfterText="";internal byte[]? Before,After; }
    private sealed class Journal { internal string Id="",Document="",Workspace="",Revision="",InspectRevision="",Framework="",Diff="",Operation="";internal DateTime Created;internal JObject Args=null!;internal List<FileState> Files=new List<FileState>(); }
    private static readonly Dictionary<string,Journal> previews=new Dictionary<string,Journal>();
    private static readonly Dictionary<string,Journal> checkpoints=new Dictionary<string,Journal>();
    internal static readonly string[] NativeTypes={"Button","Label","TextBox","CheckBox","ComboBox","ListBox","Panel","GroupBox","FlowLayoutPanel","TableLayoutPanel"};
    internal static bool CanChange(Document document,string framework)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        return framework=="wpf-xaml"||framework=="winui3-xaml"||framework=="winforms-framework"&&DesignerTools.Host(document)!=null&&CanReviewNativeRecovery(document.FullName);
    }
    internal static JObject Execute(string operation,JObject args,string uri,DTE dte,Document document)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        foreach(var id in previews.Where(x=>DateTime.UtcNow-x.Value.Created>TimeSpan.FromMinutes(5)).Select(x=>x.Key).ToArray())previews.Remove(id);
        if(operation=="previewChange")return Preview(args,uri,dte,document);
        if(operation=="applyChange"){
            var id=(string?)args["proposalId"]??"";
            if(!previews.TryGetValue(id,out var journal)||journal.Workspace!=uri||journal.Document!=document.FullName||journal.Revision!=(string?)args["revision"])throw new IOException("Designer preview expired or changed");
            VerifyFiles(journal,false,dte,uri);if((string?)DesignerTools.Inspect(document)["revision"]!=journal.InspectRevision)throw new IOException("Designer changed; inspect and review a new preview");
            previews.Remove(id);
            string? failure = null;
            try {
                if(journal.Framework.EndsWith("-xaml",StringComparison.Ordinal))ApplySource(journal,dte,document);
                else ApplyNative(journal,dte,document);
                VerifyPersisted(journal);
            } catch (Exception error) { failure = error.Message; }
            // Keep an exact recovery checkpoint if saving fails after mutation.

            var ownedFiles=new List<FileState>();var preservedFiles=new JArray();
            foreach(var file in journal.Files){
                var after=File.Exists(file.Path)?File.ReadAllBytes(file.Path):null;
                var afterText=File.Exists(file.Path)?File.ReadAllText(file.Path):"";
                if(journal.Framework.EndsWith("-xaml",StringComparison.Ordinal) && afterText!=file.BeforeText && afterText!=file.AfterText){
                    preservedFiles.Add(Path.GetFileName(file.Path));failure??="Intervening source changes were preserved and excluded from recovery";continue;
                }
                file.After=after;file.AfterText=afterText;ownedFiles.Add(file);
            }
            journal.Files=ownedFiles;
            journal.Id=Guid.NewGuid().ToString("N");journal.Revision=Fingerprint(journal,true);journal.Created=DateTime.UtcNow;
            if(checkpoints.Count>=8)checkpoints.Remove(checkpoints.OrderBy(x=>x.Value.Created).First().Key);checkpoints[journal.Id]=journal;
            document.Activate();
            return new JObject{["applied"]=failure == null,["error"]=failure,["partialFailure"]=failure != null,["preservedExternalFiles"]=preservedFiles,["checkpointId"]=journal.Id,["document"]=journal.Document,["revision"]=DesignerTools.Inspect(document)["revision"],["recovery"]=Recovery(journal),["backend"]=Backend(journal),["validation"]="Saved; build, designer reload and runtime verification required"};
        }
        if(operation=="previewRestoreChange"){
            var id=(string?)args["checkpointId"]??"";
            if(!checkpoints.TryGetValue(id,out var journal)||journal.Workspace!=uri||journal.Document!=document.FullName)throw new IOException("Designer checkpoint is unavailable in this document/workspace");
            VerifyFiles(journal,true,dte,uri);var revision=Fingerprint(journal,true);var previewId=Guid.NewGuid().ToString("N");
            var restoreDiff=journal.Framework=="winforms-framework"?NativeRestoreReview(journal.Files,false):SourceDiff(journal.Files,true);
            if(Encoding.UTF8.GetByteCount(restoreDiff)>128*1024)throw new IOException("Restore diff exceeds preview limit");
            var restore=new Journal{Id=id,Document=journal.Document,Workspace=uri,Revision=revision,InspectRevision=(string)DesignerTools.Inspect(document)["revision"]!,Framework=journal.Framework,Operation="restore",Args=new JObject(),Files=journal.Files,Created=DateTime.UtcNow,Diff=restoreDiff};
            if(previews.Count>=8)previews.Remove(previews.OrderBy(x=>x.Value.Created).First().Key);previews[previewId]=restore;
            return Result(restore,previewId);
        }
        if(operation=="restoreChange"){
            var checkpointId=(string?)args["checkpointId"]??"";var proposalId=(string?)args["proposalId"]??"";
            if(!previews.TryGetValue(proposalId,out var restore)||restore.Id!=checkpointId||restore.Operation!="restore"||restore.Revision!=(string?)args["revision"]||restore.Workspace!=uri||restore.Document!=document.FullName)throw new IOException("Designer restore preview expired or changed");
            var match=new KeyValuePair<string,Journal>(proposalId,restore);
            VerifyFiles(match.Value,true,dte,uri);if((string?)DesignerTools.Inspect(document)["revision"]!=match.Value.InspectRevision)throw new IOException("Designer changed before restore");
            previews.Remove(match.Key);
            try { Restore(match.Value,dte,uri); }
            catch (Exception error) {
                try { dte.ItemOperations.OpenFile(match.Value.Document,match.Value.Framework=="winforms-framework"?EnvDTE.Constants.vsViewKindDesigner:EnvDTE.Constants.vsViewKindTextView); } catch (Exception) { }
                return new JObject { ["restored"] = false, ["partialFailure"] = true, ["error"] = error.Message, ["checkpointId"] = checkpointId,
                    ["errorDetails"] = error.ToString(),
                    ["recovery"] = Recovery(match.Value), ["guidance"] = "Inspect and preview checkpoint again to retry; intervening changes were preserved." };
            }
            checkpoints.Remove(checkpointId);
            return new JObject{["restored"]=true,["checkpointId"]=checkpointId,["document"]=match.Value.Document,["backend"]=Backend(match.Value),["recovery"]=Recovery(match.Value),["validation"]="Owned source/form files restored and designer reopened; build/run verification required"};
        }
        throw new IOException("Unsupported designer journal operation");
    }
    private static JObject Preview(JObject args,string uri,DTE dte,Document document)
    {
        ThreadHelper.ThrowIfNotOnUIThread();IdeTools.CleanBuffers(dte);
        var inspect=DesignerTools.Inspect(document);var framework=(string?)inspect["framework"]??"";
        if(!CanChange(document,framework))throw new IOException("This designer has no supported structural mutation backend");
        var operation=(string?)args["changeOperation"]??"";
        if(operation=="createComponent" && !(inspect["creatableTypes"] as JArray ?? new JArray()).Values<string>().Contains((string?)args["type"]))throw new IOException("Type is not advertised by this designer");
        if(!((JArray)inspect["supportedOperations"]!).Values<string>().Contains(operation))throw new IOException("Designer does not advertise this operation");
        if((string?)args["document"]!=document.FullName||(string?)args["revision"]!=(string?)inspect["revision"])throw new IOException("Designer snapshot changed");
        var journal=new Journal{Document=document.FullName,Workspace=uri,Framework=framework,Operation=operation,Args=(JObject)args.DeepClone(),InspectRevision=(string)inspect["revision"]!,Created=DateTime.UtcNow};
        var paths=new List<string>{document.FullName};
        if(framework.EndsWith("-xaml",StringComparison.Ordinal)){
            var source=DesignerTools.Read(document);
            if(operation=="deleteComponent" && File.Exists(document.FullName+".cs")){
                var name=(string?)((JArray)inspect["components"]!).OfType<JObject>().Single(c=>(string?)c["id"]==(string?)args["component"])["name"];
                IdeTools.ResolveFile(uri,document.FullName+".cs");
                if(!string.IsNullOrEmpty(name)&&CSharpSyntaxTree.ParseText(File.ReadAllText(document.FullName+".cs")).GetRoot().DescendantTokens().Any(t=>t.RawKind==(int)SyntaxKind.IdentifierToken&&t.ValueText==name))throw new IOException("Named XAML element is referenced in C# code-behind; preserve it");
            }
            var after=XamlStructureEdits.Prepare(source,args);journal.Files.Add(State(document.FullName,source,after));
            if(operation=="bindEvent"){
                var code=document.FullName+".cs";IdeTools.ResolveFile(uri,code);var body=File.ReadAllText(code);var replacement=BindCodeBehind(source,body,args,framework);journal.Files.Add(State(code,body,replacement));
            }
        }else{
            var root=Path.ChangeExtension(document.FullName,null);var extension=Path.GetExtension(document.FullName);
            paths.Add(root+".Designer"+extension);paths.Add(root+".resx");
            foreach(var path in paths.Distinct(StringComparer.OrdinalIgnoreCase)){IdeTools.ResolveFile(uri,path,true);if(File.Exists(path)&&new FileInfo(path).Length>256*1024)throw new IOException("Designer journal file exceeds 256 KiB");journal.Files.Add(State(path,File.Exists(path)?File.ReadAllText(path):"",""));}
            EnsureNativeRecoveryReview(journal.Files);
            ValidateNative(args,DesignerTools.Host(document)??throw new IOException("Designer host unavailable"));
        }
        journal.Diff=framework.EndsWith("-xaml",StringComparison.Ordinal)?SourceDiff(journal.Files,false):"Native WinForms designer operation:\n"+args.ToString()+"\nRecovery captures "+string.Join(", ",journal.Files.Select(f=>Path.GetFileName(f.Path)));
        if(Encoding.UTF8.GetByteCount(journal.Diff)>128*1024)throw new IOException("Designer diff exceeds 128 KiB; narrow the operation");
        journal.Revision=Fingerprint(journal,false);var id=Guid.NewGuid().ToString("N");if(previews.Count>=8)previews.Remove(previews.OrderBy(x=>x.Value.Created).First().Key);previews[id]=journal;return Result(journal,id);
    }
    private static FileState State(string path,string before,string after)=>new FileState{Path=path,Before=File.Exists(path)?File.ReadAllBytes(path):null,BeforeText=before,AfterText=after};
    private static string Fingerprint(Journal journal,bool after)=>IdeCatalog.Hash(journal.Document+"\n"+journal.Operation+"\n"+journal.Args+"\n"+string.Join("\n",journal.Files.Select(f=>f.Path+":"+((after?f.After:f.Before)==null?"missing":Convert.ToBase64String(after?f.After!:f.Before!)))));
    private static string Backend(Journal journal)=>journal.Framework.EndsWith("-xaml",StringComparison.Ordinal)?"XAML and C# source buffer edits":"public IDesignerHost / IEventBindingService";
    private static JObject Recovery(Journal journal)=>new JObject{["supported"]=true,["scope"]="source_and_form",["backend"]=Backend(journal),["files"]=new JArray(journal.Files.Select(f=>Path.GetFileName(f.Path))),["limitations"]="Journal lasts for this IDE process; restore requires unchanged saved owned files; native Undo and source journal are distinct"};
    private static JObject Result(Journal journal,string id)=>new JObject{["proposalId"]=id,["checkpointId"]=journal.Operation=="restore"?journal.Id:null,["document"]=journal.Document,["revision"]=journal.Revision,["diff"]=journal.Diff,["expiresAt"]=new DateTimeOffset(journal.Created.AddMilliseconds(299000)).ToUnixTimeMilliseconds(),["operation"]=journal.Operation,["backend"]=Backend(journal),["recovery"]=Recovery(journal)};
    internal static JObject ContractFixture()
    {
        var file = new FileState { Path = "D:/fixture/Form.xaml", BeforeText = "<Grid />", AfterText = "<Grid><Button Name=\"AgentButton\" /></Grid>" };
        var change = new Journal { Document = file.Path, InspectRevision = "before", Revision = "change-revision", Framework = "wpf-xaml", Operation = "createComponent", Created = DateTime.UtcNow, Files = new List<FileState> { file }, Diff = SourceDiff(new[] { file }, false) };
        var restore = new Journal { Id = "fixture-checkpoint", Document = file.Path, InspectRevision = "before", Revision = "restore-revision", Framework = "wpf-xaml", Operation = "restore", Created = DateTime.UtcNow, Files = new List<FileState> { file }, Diff = SourceDiff(new[] { file }, true) };
        return new JObject { ["change"] = Result(change, "fixture-change-proposal"), ["restore"] = Result(restore, "fixture-restore-proposal") };
    }
    private static string SourceDiff(IEnumerable<FileState> files,bool reverse)=>string.Join("\n",files.Select(f=>"--- "+Path.GetFileName(f.Path)+"\n+++ "+Path.GetFileName(f.Path)+"\n"+string.Join("\n",(reverse?f.AfterText:f.BeforeText).Split('\n').Select(l=>"-"+l))+"\n"+string.Join("\n",(reverse?f.BeforeText:f.AfterText).Split('\n').Select(l=>"+"+l))));
    private static string BytesHash(byte[] bytes){using var hash=System.Security.Cryptography.SHA256.Create();return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
    // Complete original content plus exact byte hashes is independent of serializer growth.
    // Review shows precisely what will be restored; current saved files remain fingerprint-bound.
    internal static string OriginalReview(IEnumerable<(string Path,string BeforeText,string BeforeHash,long BeforeLength,string AfterHash,long AfterLength)> files)=>
        "Restore the complete original contents below, including the recorded original encoding/BOM bytes. Current saved files must match the listed SHA256 values.\n"+
        string.Join("\n",files.Select(f=>"--- saved "+f.Path+" (SHA256 "+f.AfterHash+", "+f.AfterLength+" bytes)\n+++ restore "+f.Path+" (SHA256 "+f.BeforeHash+", "+f.BeforeLength+" bytes)\n"+string.Join("\n",f.BeforeText.Split('\n').Select(line=>"+"+line))));
    private static string NativeRestoreReview(IEnumerable<FileState> files,bool preflight)=>OriginalReview(files.Select(f=>(Path.GetFileName(f.Path),f.BeforeText,BytesHash(f.Before!),f.Before!.LongLength,preflight?new string('f',64):f.After==null?"missing":BytesHash(f.After),preflight?long.MaxValue:f.After?.LongLength??0)));
    private static void EnsureNativeRecoveryReview(IEnumerable<FileState> files)
    {
        var originals=files.ToList();var review=NativeRestoreReview(originals,true);
        var proposal=new Journal{Id=new string('f',32),Document=originals[0].Path,Revision=new string('f',64),Framework="winforms-framework",Operation="restore",Created=DateTime.UtcNow,Files=originals,Diff=review};
        if(Encoding.UTF8.GetByteCount(review)>128*1024||Encoding.UTF8.GetByteCount(new JObject{["diff"]=review}.ToString(Newtonsoft.Json.Formatting.None,Array.Empty<Newtonsoft.Json.JsonConverter>()))>192*1024)
            throw new IOException("Native source/form/resource originals exceed the reviewed restore budget; structural edits are unavailable");
        if(Encoding.UTF8.GetByteCount(Result(proposal,new string('f',32)).ToString(Newtonsoft.Json.Formatting.None,Array.Empty<Newtonsoft.Json.JsonConverter>()))>220*1024-256)
            throw new IOException("Native recovery proposal exceeds the designer transport budget; structural edits are unavailable");
    }
    internal static bool CanReviewNativeRecovery(string document)
    {
        try{
            var stem=Path.ChangeExtension(document,null);var files=new List<FileState>();
            foreach(var path in new[]{document,stem+".Designer.cs",stem+".resx"}){
                if(!File.Exists(path)||new FileInfo(path).Length>256*1024||(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)return false;
                files.Add(State(path,File.ReadAllText(path),""));
            }
            EnsureNativeRecoveryReview(files);return true;
        }catch(IOException){return false;}catch(UnauthorizedAccessException){return false;}
    }
    private static void VerifyFiles(Journal journal,bool after,DTE dte,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();IdeTools.CleanBuffers(dte);
        foreach(var file in journal.Files){IdeTools.ResolveFile(uri,file.Path,true);var expected=after?file.After:file.Before;var exists=File.Exists(file.Path);if(exists!=(expected!=null)||exists&&!File.ReadAllBytes(file.Path).SequenceEqual(expected!))throw new IOException("Owned designer file changed; refuse to overwrite it: "+Path.GetFileName(file.Path));}
    }
    private static void ApplySource(Journal journal,DTE dte,Document root)
    {
        ThreadHelper.ThrowIfNotOnUIThread();if(dte.UndoContext.IsOpen)throw new IOException("Another edit transaction is active");dte.UndoContext.Open("PiAgent XAML structural edit");
        try{foreach(var file in journal.Files){
            if (!File.Exists(file.Path) || !File.ReadAllBytes(file.Path).SequenceEqual(file.Before!)) throw new IOException("Designer source changed before editing; preserve it");
            dte.ItemOperations.OpenFile(file.Path,EnvDTE.Constants.vsViewKindTextView);var document=dte.Documents.Cast<Document>().First(d=>{ThreadHelper.ThrowIfNotOnUIThread();return string.Equals(d.FullName,file.Path,StringComparison.OrdinalIgnoreCase);});var text=DesignerTools.Text(document);text.StartPoint.CreateEditPoint().ReplaceText(text.EndPoint,file.AfterText,(int)vsEPReplaceTextOptions.vsEPReplaceTextKeepMarkers);document.Save();}root.Activate();}
        catch{throw;}finally{dte.UndoContext.Close();}
    }
    private static void Restore(Journal journal,DTE dte,string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();var native=journal.Framework=="winforms-framework";
        // Closing a root designer can invalidate dependent EnvDTE.Document proxies.
        // Resolve each currently open SDK frame anew rather than retaining those proxies.
        foreach(var file in journal.Files){
            try { for(var count=0;count<8 && VsShellUtilities.IsDocumentOpen(ServiceProvider.GlobalProvider,file.Path,Guid.Empty,out _,out _,out var frame);count++)ErrorHandler.ThrowOnFailure(frame.CloseFrame((uint)__FRAMECLOSE.FRAMECLOSE_NoSave)); }
            catch(Exception error){throw new IOException("Designer restore could not close owned editor: "+Path.GetFileName(file.Path),error);}
        }
        foreach(var file in journal.Files){
            try{IdeTools.ResolveFile(uri,file.Path,true);RestoreOwnedFile(file.Path,file.Before,file.After);}
            catch(Exception error){throw new IOException("Designer restore could not restore owned bytes: "+Path.GetFileName(file.Path),error);}
            file.After=file.Before;file.AfterText=file.BeforeText;
        }
        try{dte.ItemOperations.OpenFile(journal.Document,native?EnvDTE.Constants.vsViewKindDesigner:EnvDTE.Constants.vsViewKindTextView);}
        catch(Exception error){throw new IOException("Owned designer bytes restored, but reopening the editor failed",error);}
    }
    internal static void RestoreOwnedFile(string path, byte[]? before, byte[]? after)
    {
        if (after == null) {
            if (File.Exists(path)) throw new IOException("Designer file appeared during restore; preserve it");
            if (before != null) using (var stream = new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None)) { stream.Write(before,0,before.Length);stream.Flush(true); }
            return;
        }
        if (before == null) throw new IOException("Generated absent-before file requires manual removal; preserved for review");
        using (var stream = new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None)) {
            if (stream.Length != after.Length) throw new IOException("Designer file changed during restore; preserve it");
            var actual=new byte[after.Length];var offset=0;
            while(offset<actual.Length){var read=stream.Read(actual,offset,actual.Length-offset);if(read==0)throw new IOException("Designer file changed during restore");offset+=read;}
            if(!actual.SequenceEqual(after))throw new IOException("Designer file changed during restore; preserve it");
            stream.Position=0;stream.Write(before,0,before.Length);stream.SetLength(before.Length);stream.Flush(true);
        }
    }
    internal static string BindCodeBehind(string xaml,string code,JObject args,string framework)
    {
        using var reader=System.Xml.XmlReader.Create(new StringReader(xaml),new System.Xml.XmlReaderSettings{DtdProcessing=System.Xml.DtdProcessing.Prohibit,XmlResolver=null});var xml=XDocument.Load(reader);var className=(string?)xml.Root!.Attribute(XName.Get("Class","http://schemas.microsoft.com/winfx/2006/xaml"))??throw new IOException("XAML class is unavailable");
        var tree=CSharpSyntaxTree.ParseText(code);if(tree.GetDiagnostics().Any(d=>d.Severity==Microsoft.CodeAnalysis.DiagnosticSeverity.Error))throw new IOException("Code-behind contains syntax errors; correct them before binding");var root=tree.GetRoot();var target=root.DescendantNodes().OfType<ClassDeclarationSyntax>().SingleOrDefault(c=>string.Join(".",c.Ancestors().OfType<BaseNamespaceDeclarationSyntax>().Reverse().Select(n=>n.Name.ToString()).Concat(new[]{c.Identifier.ValueText}))==className)??throw new IOException("C# XAML code-behind class is unavailable");
        var eventName=(string)args["property"]!;var prefix=framework=="winui3-xaml"?"global::Microsoft.UI.Xaml.":"global::System.Windows.";
        var eventType=eventName=="TextChanged"?prefix+"Controls.TextChangedEventArgs":eventName=="SelectionChanged"?prefix+"Controls.SelectionChangedEventArgs":prefix+"RoutedEventArgs";
        var method=(string)args["eventMethod"]!;var existing=target.Members.OfType<MethodDeclarationSyntax>().Where(m=>m.Identifier.ValueText==method).ToArray();
        if(existing.Length>0){if(existing.Length!=1||existing[0].ParameterList.Parameters.Count!=2||existing[0].ReturnType.ToString()!="void"||existing[0].ParameterList.Parameters[1].Type?.ToString()!=eventType)throw new IOException("Handler name has an incompatible or ambiguous method");return code;}
        if((bool?)args["create"]!=true)throw new IOException("Event handler does not exist; explicitly request creation");
        var newline=code.Contains("\r\n")?"\r\n":"\n";
        var member=newline+"    private void "+method+"(object sender, "+eventType+" e)"+newline+"    {"+newline+"    }"+newline;
        return code.Insert(target.CloseBraceToken.SpanStart,member);
    }
    private static Type NativeType(string type)=>typeof(System.Windows.Forms.Button).Assembly.GetType("System.Windows.Forms."+type,false)??throw new IOException("Standard WinForms type is unavailable");
    private static void VerifyPersisted(Journal journal)
    {
        if(journal.Framework.EndsWith("-xaml",StringComparison.Ordinal)){
            foreach(var file in journal.Files)if(!File.Exists(file.Path)||File.ReadAllText(file.Path)!=file.AfterText)throw new IOException("Saved designer source does not match the reviewed change: "+Path.GetFileName(file.Path));
        }else VerifySavedNative(journal.Args,File.ReadAllText(journal.Document),File.ReadAllText(Path.ChangeExtension(journal.Document,null)+".Designer.cs"));
    }
    internal static void VerifySavedNative(JObject args,string source,string designerSource)
    {
        var codeTree=CSharpSyntaxTree.ParseText(source);var formTree=CSharpSyntaxTree.ParseText(designerSource);
        if(codeTree.GetDiagnostics().Concat(formTree.GetDiagnostics()).Any(d=>d.Severity==Microsoft.CodeAnalysis.DiagnosticSeverity.Error))throw new IOException("Saved designer code contains syntax errors");
        var form=formTree.GetRoot();var operation=(string?)args["changeOperation"];
        var component=(string?)args[operation=="createComponent"?"name":"component"]??"";
        if(operation=="createComponent"){
            var declared=form.DescendantNodes().OfType<VariableDeclaratorSyntax>().Any(v=>v.Identifier.ValueText==component);
            var created=form.DescendantNodes().OfType<AssignmentExpressionSyntax>().Any(a=>a.Left is MemberAccessExpressionSyntax left && left.Name.Identifier.ValueText==component && a.Right is ObjectCreationExpressionSyntax creation && creation.Type.DescendantTokens().LastOrDefault(t=>t.RawKind==(int)SyntaxKind.IdentifierToken).ValueText==(string?)args["type"]);
            if(!declared||!created)throw new IOException("Created control was not serialized into the saved designer source");
        }else if(operation=="deleteComponent"){
            if(form.DescendantTokens().Any(t=>t.RawKind==(int)SyntaxKind.IdentifierToken&&t.ValueText==component))throw new IOException("Deleted control is still referenced by saved designer source");
        }else if(operation=="bindEvent"){
            var eventName=(string?)args["property"];var method=(string?)args["eventMethod"];
            var hooked=form.DescendantNodes().OfType<AssignmentExpressionSyntax>().Any(a=>a.RawKind==(int)SyntaxKind.AddAssignmentExpression&&a.Left is MemberAccessExpressionSyntax left&&left.Name.Identifier.ValueText==eventName&&left.Expression.DescendantTokens().Any(t=>t.RawKind==(int)SyntaxKind.IdentifierToken&&t.ValueText==component)&&a.Right.DescendantTokens().Any(t=>t.RawKind==(int)SyntaxKind.IdentifierToken&&t.ValueText==method));
            var methods=codeTree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>().Where(m=>m.Identifier.ValueText==method).ToArray();
            if(!hooked||methods.Length!=1||methods[0].ReturnType.ToString()!="void"||methods[0].ParameterList.Parameters.Count!=2||methods[0].Body==null)throw new IOException("Event hookup and compatible handler did not persist in saved source");
        }else throw new IOException("Unsupported saved designer verification");
    }
    private static void ValidateNative(JObject args,IDesignerHost host)
    {
        var operation=(string?)args["changeOperation"];
        if(operation=="createComponent"){
            foreach(var key in new[]{"x","y","width","height"})if(args[key]!=null){var n=(int)args[key]!;if(n<(key=="x"||key=="y"?-32768:1)||n>32767)throw new IOException("Designer bounds exceeded");}
            var type=(string?)args["type"]??"";var name=(string?)args["name"]??"";if(!NativeTypes.Contains(type)||!Regex.IsMatch(name,"^[A-Za-z_][A-Za-z_0-9]{0,127}$")||host.Container.Components[name]!=null)throw new IOException("Select an advertised type and a unique valid component name");
            var parent=host.Container.Components[(string?)args["parent"]??host.RootComponent.Site?.Name??""] as System.Windows.Forms.Control;
            if(parent==null||!(parent is System.Windows.Forms.Form||parent is System.Windows.Forms.Panel||parent is System.Windows.Forms.GroupBox))throw new IOException("Parent is not a supported WinForms container");
        }else{
            var component=host.Container.Components[(string?)args["component"]??""]??throw new IOException("Component unavailable");if(component==host.RootComponent)throw new IOException("Root form cannot be deleted or structurally rebound");
            if(operation=="deleteComponent"){if(component is System.Windows.Forms.Control control&&control.HasChildren)throw new IOException("Delete only a leaf control");if(!NativeTypes.Contains(component.GetType().Name))throw new IOException("Only advertised standard controls can be deleted");}
            else if(operation=="bindEvent"){
                var service=host.GetService(typeof(IEventBindingService)) as IEventBindingService??throw new IOException("Public event binding service is unavailable");var ev=TypeDescriptor.GetEvents(component)[(string?)args["property"]??""]??throw new IOException("Event is unavailable");var method=(string?)args["eventMethod"]??"";if(!Regex.IsMatch(method,"^[A-Za-z_][A-Za-z_0-9]{0,127}$"))throw new IOException("Invalid handler name");if(service.GetEventProperty(ev).GetValue(component) is string existing && !string.IsNullOrEmpty(existing))throw new IOException("Event is already bound; preserve handler");if((bool?)args["create"]!=true&&!service.GetCompatibleMethods(ev).Cast<string>().Contains(method))throw new IOException("Compatible event method does not exist; explicitly request creation");
            }else throw new IOException("Unsupported designer operation");
        }
    }
    private static void ApplyNative(Journal journal,DTE dte,Document document)
    {
        ThreadHelper.ThrowIfNotOnUIThread();var host=DesignerTools.Host(document)??throw new IOException("Designer unavailable");ValidateNative(journal.Args,host);using var transaction=host.CreateTransaction("PiAgent designer structural edit");
        try{
            var args=journal.Args;
            if(journal.Operation=="createComponent"){
                var component=host.CreateComponent(NativeType((string)args["type"]!),(string)args["name"]!);
                var parent=host.Container.Components[(string?)args["parent"]??host.RootComponent.Site?.Name??""];
                var changes=host.GetService(typeof(IComponentChangeService)) as IComponentChangeService;
                foreach(var field in new[]{"Parent","Left","Top","Width","Height"}){
                    var argument=field=="Parent"?null:field=="Left"?"x":field=="Top"?"y":field=="Width"?"width":"height";if(argument!=null&&args[argument]==null)continue;
                    var property=TypeDescriptor.GetProperties(component)[field]??throw new IOException("Control property is unavailable");var before=property.GetValue(component);changes?.OnComponentChanging(component,property);property.SetValue(component,field=="Parent"?parent:(object)(int)args[argument!]!);changes?.OnComponentChanged(component,property,before,property.GetValue(component));
                }
            }else{
                var component=host.Container.Components[(string)args["component"]!];
                if(journal.Operation=="deleteComponent")host.DestroyComponent(component);
                else{var service=host.GetService(typeof(IEventBindingService)) as IEventBindingService ?? throw new IOException("Public event binding service unavailable");var ev=TypeDescriptor.GetEvents(component)[(string)args["property"]!]!;service.GetEventProperty(ev).SetValue(component,(string)args["eventMethod"]!);if((bool?)args["create"]==true&&!service.ShowCode(component,ev))throw new IOException("IDE could not generate the handler source");}
            }
            transaction.Commit();document.Save();
            foreach(Document owned in dte.Documents){if(journal.Files.Any(f=>{ThreadHelper.ThrowIfNotOnUIThread();return string.Equals(f.Path,owned.FullName,StringComparison.OrdinalIgnoreCase);})&&!owned.Saved)owned.Save();}
            dte.ItemOperations.OpenFile(journal.Document,EnvDTE.Constants.vsViewKindDesigner);
        }catch{if(!transaction.Committed&&!transaction.Canceled)transaction.Cancel();throw;}
    }
}
