using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

/// <summary>Explicit local fixture opt-in only. Never registered as an agent tool.</summary>
internal static class IdeAcceptanceHarness
{
    private static int running;
    internal static bool Enabled => Environment.GetEnvironmentVariable("PIAGENT_VS_ACCEPTANCE") == "1";
    internal static async Task RunAsync(CancellationToken token)
    {
        if (Interlocked.CompareExchange(ref running, 1, 0) != 0) return;
        JObject? receipt = null; string? output = null;
        try {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            var dte = Package.GetGlobalService(typeof(DTE)) as DTE ?? throw new IOException("DTE unavailable");
            var policy = IdeAcceptanceFixtureGuard.Validate(Environment.GetEnvironmentVariable("PIAGENT_VS_ACCEPTANCE"), Environment.GetEnvironmentVariable("PIAGENT_VS_ACCEPTANCE_ROOT"), dte.Solution.FullName, out var root, out var uri);
            IdeTools.CleanBuffers(dte);
            output = Path.Combine(root, "piagent-vs-acceptance.receipt.json");
            receipt = new JObject { ["schemaVersion"] = 1, ["fixture"] = root, ["startedAt"] = DateTime.UtcNow.ToString("o"), ["ideVersion"] = dte.Version, ["backend"] = "fixture-only direct public SDK handlers", ["cases"] = new JArray() };
            receipt["implementationVersion"]=typeof(IdeAcceptanceHarness).Assembly.GetName().Version+"+"+typeof(IdeAcceptanceHarness).Assembly.ManifestModule.ModuleVersionId.ToString("N");
            using(var binaryHash=System.Security.Cryptography.SHA256.Create())using(var binary=File.OpenRead(typeof(IdeAcceptanceHarness).Assembly.Location))receipt["adapterSha256"]=BitConverter.ToString(binaryHash.ComputeHash(binary)).Replace("-","").ToLowerInvariant();
            var cases = (JArray)receipt["cases"]!;
            void Save() => File.WriteAllText(output, receipt.ToString(Formatting.Indented, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));
            async Task CaseAsync(string name, Func<Task<JObject>> action) {
                var item = new JObject { ["name"] = name, ["startedAt"] = DateTime.UtcNow.ToString("o") }; cases.Add(item); Save();
                try { item["result"] = await action(); item["passed"] = true; }
                catch (Exception error) { item["passed"] = false; item["error"] = error.ToString(); }
                item["completedAt"] = DateTime.UtcNow.ToString("o"); Save();
            }
            await CaseAsync("catalog/context", async () => {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token); var catalog = IdeCatalog.Capture(uri);
                foreach (var entry in ((JArray)catalog["entries"]!).OfType<JObject>())
                    if (new[] { "blocked", "unavailable" }.Contains((string?)entry["availability"]) && (entry["reason"] == null || entry["reasonCode"] == null)) throw new IOException("Invalid unavailable catalog entry");
                var context=IdeContextTools.Capture(dte, uri);
                if(policy["expectedProjectKind"] is JValue kind){
                    var expected=IdeTools.ResolveFile(uri,(string)policy["project"]!);
                    Require(((JArray)context["projects"]!).OfType<JObject>().Any(p=>IdeTools.ResolveFile(uri,(string)p["file"]!)==expected&&string.Equals((string?)p["kind"],(string?)kind,StringComparison.OrdinalIgnoreCase)),"Expected native project kind absent from actual context");
                }
                return new JObject { ["catalog"] = catalog, ["context"] = context };
            });
            await CaseAsync("native targeted build", async () => {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
                var project = (string?)policy["project"] ?? IdeTools.Projects(dte.Solution.Projects).First().FullName;
                var buildTarget=IdeAcceptanceFixtureGuard.BuildTarget(policy);buildTarget["project"]=project;
                var result = await IdeBuildTools.ExecuteAsync(dte,buildTarget,uri,token);
                Require((bool?)result["success"] == true, "Native build failed: " + result); return result;
            });
            if (policy["refactorFile"] is JValue refactorFile) {
                await CaseAsync("two-file rename/apply/native undo", async () => {
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
                    var file = IdeTools.ResolveFile(uri, (string)refactorFile!); var source = File.ReadAllText(file); var symbol = (string?)policy["renameSymbol"] ?? "Add";
                    var offset = source.IndexOf(symbol, StringComparison.Ordinal); Require(offset >= 0, "Rename symbol absent");
                    var beforePrefix = source.Substring(0, offset); var line = beforePrefix.Count(c => c == '\n') + 1; var column = offset - beforePrefix.LastIndexOf('\n');
                    var preview = await IdeRefactoringTools.ExecuteAsync(new JObject { ["operation"] = "rename", ["file"] = file, ["line"] = line, ["column"] = column, ["newName"] = "PiAgentReviewedAdd" }, uri, token);
                    var files = ((JArray)preview["files"]!).OfType<JObject>().ToArray(); Require(files.Length >= 2, "Fixture must preview declaration and references in two files");
                    var originals = files.ToDictionary(f => IdeTools.ResolveFile(uri, (string)f["path"]!), f => File.ReadAllBytes(IdeTools.ResolveFile(uri, (string)f["path"]!)), StringComparer.OrdinalIgnoreCase);
                    try {
                        var applied = await IdeRefactoringTools.ExecuteAsync(new JObject { ["operation"] = "apply", ["proposalId"] = preview["proposalId"], ["revision"] = preview["revision"] }, uri, token);
                        Require((bool?)applied["applied"] == true, "Rename did not apply");
                        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
                        dte.ActiveDocument.ActiveWindow.Activate();await Task.Delay(200,token);
                        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);dte.ActiveDocument.ActiveWindow.Activate();dte.ExecuteCommand("Edit.Undo");
                        foreach (Document document in dte.Documents) if (originals.ContainsKey(document.FullName)) document.Save();
                        Require(originals.All(f => File.ReadAllBytes(f.Key).SequenceEqual(f.Value)), "Native undo did not restore all original file bytes");
                        return new JObject { ["preview"] = preview, ["applied"] = applied, ["nativeUndoRestoredBytes"] = true };
                    } finally { await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(); RestoreRefactorFixture(dte, files, originals, uri); }
                });
                await CaseAsync("stale refactor preview preserves intervening editor change", async () => {
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
                    var file = IdeTools.ResolveFile(uri, (string)refactorFile!); dte.ItemOperations.OpenFile(file);
                    var document = dte.ActiveDocument; var before = DesignerTools.Read(document); var bytes = File.ReadAllBytes(file);
                    var preview = await IdeRefactoringTools.ExecuteAsync(new JObject { ["operation"] = "format", ["file"] = file }, uri, token);
                    var edited = before + "\r\n// owned acceptance stale-preview probe\r\n";
                    try {
                        DesignerTools.Text(document).StartPoint.CreateEditPoint().ReplaceText(DesignerTools.Text(document).EndPoint, edited, 0); document.Save();
                        var refused = false;
                        try { await IdeRefactoringTools.ExecuteAsync(new JObject { ["operation"] = "apply", ["proposalId"] = preview["proposalId"], ["revision"] = preview["revision"] }, uri, token); }
                        catch (IOException) { refused = true; }
                        Require(refused && File.ReadAllText(file) == edited, "Stale preview did not preserve the intervening change"); return new JObject { ["refused"] = true, ["interveningChangePreserved"] = true };
                    } finally {
                        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                        if (DesignerTools.Read(document) == edited && File.ReadAllText(file) == edited) { document.Close(vsSaveChanges.vsSaveChangesNo); IdeDesignerChanges.RestoreOwnedFile(file, bytes, File.ReadAllBytes(file)); dte.ItemOperations.OpenFile(file); }
                    }
                });
            }
            if (policy["testProject"] is JValue testProject) await CaseAsync("VSTest structured result", async () => {
                var result = await IdeTestTools.ExecuteAsync(dte, new JObject { ["operation"] = "run", ["project"] = testProject, ["configuration"] = "Debug" }, uri, token);
                Require((bool?)result["success"] == true, "Tests did not pass: " + result); return result;
            });
            if ((bool?)policy["debug"] == true) await CaseAsync("debugger start/pause/threads/stop", async () => {
                try {
                    var start = await IdeDebugTools.ExecuteAsync(dte, new JObject { ["operation"] = "start" }, uri, token);
                    await Task.Delay(1000, token); var pause = await IdeDebugTools.ExecuteAsync(dte, new JObject { ["operation"] = "pause" }, uri, token);
                    var snapshot = await IdeDebugTools.ExecuteAsync(dte, new JObject { ["operation"] = "threads" }, uri, token);
                    Require((bool?)snapshot["available"] == true && ((JArray)snapshot["threads"]!).Count > 0, "Paused thread snapshot unavailable");
                    return new JObject { ["start"] = start, ["pause"] = pause, ["snapshot"] = snapshot };
                } finally { await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(); if (dte.Debugger.CurrentMode != dbgDebugMode.dbgDesignMode) await IdeDebugTools.ExecuteAsync(dte, new JObject { ["operation"] = "stop" }, uri, CancellationToken.None); }
            });
            if (policy["designerFile"] is JValue designerFile) {
                var file = IdeTools.ResolveFile(uri, (string)designerFile!); var native = Path.GetExtension(file) != ".xaml";
                async Task<JObject> RoundTripAsync(string operation) {
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
                    dte.ItemOperations.OpenFile(file, native ? EnvDTE.Constants.vsViewKindDesigner : EnvDTE.Constants.vsViewKindTextView);
                    Require(string.Equals(dte.ActiveDocument.FullName,file,StringComparison.OrdinalIgnoreCase),"Requested designer source was not activated: "+dte.ActiveDocument.FullName);
                    var inspect = DesignerTools.Execute("inspect", new JObject(), uri);
                    var components = ((JArray)inspect["components"]!).OfType<JObject>();
                    var existing = components.SingleOrDefault(c => (string?)c["name"] == "ExistingButton" || (string?)c["id"] == "ExistingButton") ?? throw new IOException("Existing fixture control absent from inspect: "+inspect);
                    var parent = native ? components.First()["id"] : components.Single(c => (string?)c["type"] == "Grid")["id"];
                    var change = new JObject { ["changeOperation"] = operation, ["document"] = inspect["document"], ["revision"] = inspect["revision"] };
                    if (operation == "createComponent") { change["type"] = "Button"; change["name"] = "PiAgentFixtureButton"; change["parent"] = parent; change["width"] = 120; change["height"] = 32; }
                    else { change["component"] = existing["id"]; if (operation == "bindEvent") { change["property"] = "Click"; change["eventMethod"] = "PiAgentFixtureClick"; change["create"] = true; } }
                    var paths = native ? new[] { file, Path.ChangeExtension(file, null) + ".Designer.cs", Path.ChangeExtension(file, ".resx") } : new[] { file, file + ".cs" };
                    var before = paths.ToDictionary(path => path, File.ReadAllBytes);
                    var preview = DesignerTools.Execute("previewChange", change, uri); JObject? applied = null;
                    try {
                        applied = DesignerTools.Execute("applyChange", new JObject { ["proposalId"] = preview["proposalId"], ["document"] = file, ["revision"] = preview["revision"] }, uri);
                        // Preserve generated stages even when a postcondition or restore fails.
                        var stage=Path.Combine(root,"piagent-designer-stages",operation+"-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
                        var stageFiles=new JArray();foreach(var path in paths){var copy=Path.Combine(stage,Path.GetFileName(path)+".snapshot");File.Copy(path,copy);stageFiles.Add(new JObject{["originalPath"]=path,["snapshotPath"]=copy});}
                        File.WriteAllText(Path.Combine(stage,"manifest.json"),stageFiles.ToString(Formatting.Indented, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));
                        if(receipt["designerStages"]==null)receipt["designerStages"]=new JArray();
                        ((JArray)receipt["designerStages"]!).Add(new JObject{["operation"]=operation,["apply"]=applied.DeepClone(),["stageFiles"]=stageFiles.DeepClone()});Save();
                        Require((bool?)applied["applied"] == true, "Designer did not apply: " + applied);
                        Require(before.Any(f => !File.ReadAllBytes(f.Key).SequenceEqual(f.Value)), "Designer mutation did not change persisted source/form bytes");
                        var after = DesignerTools.Execute("inspect", new JObject(), uri);
                        var afterComponents=((JArray)after["components"]!).OfType<JObject>().ToArray();
                        if(operation=="createComponent")Require(afterComponents.Count(c=>(string?)c["name"]=="PiAgentFixtureButton"||(string?)c["id"]=="PiAgentFixtureButton")==1,"Requested created control is absent from inspect");
                        if(operation=="deleteComponent")Require(!afterComponents.Any(c=>(string?)c["name"]=="ExistingButton"||(string?)c["id"]=="ExistingButton"),"Requested deleted control is still present in inspect");
                        if(native)IdeDesignerChanges.VerifySavedNative(change,File.ReadAllText(file),File.ReadAllText(Path.ChangeExtension(file,null)+".Designer.cs"));
                        else if(operation=="bindEvent"){
                            Require(File.ReadAllText(file).Contains("Click=\"PiAgentFixtureClick\"")||File.ReadAllText(file).Contains("Click='PiAgentFixtureClick'"),"Saved XAML event binding is absent");
                            var handlerSyntax=await Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree.ParseText(File.ReadAllText(file+".cs")).GetRootAsync(token);
                            Require(handlerSyntax.DescendantNodes().OfType<Microsoft.CodeAnalysis.CSharp.Syntax.MethodDeclarationSyntax>().Count(m=>m.Identifier.ValueText=="PiAgentFixtureClick")==1,"Saved C# event handler is absent or ambiguous");
                        }
                        // Use .snapshot suffixes so SDK globbing cannot compile stage copies.
                        return new JObject { ["preview"] = preview, ["apply"] = applied, ["inspectAfter"] = after,["savedOperationVerified"]=true,["stageFiles"]=stageFiles };
                    } finally {
                        if (applied?["checkpointId"] != null) {
                            dte.ItemOperations.OpenFile(file, native ? EnvDTE.Constants.vsViewKindDesigner : EnvDTE.Constants.vsViewKindTextView);
                            var current = DesignerTools.Execute("inspect", new JObject(), uri);
                            var restorePreview = DesignerTools.Execute("previewRestoreChange", new JObject { ["checkpointId"] = applied["checkpointId"], ["document"] = file, ["revision"] = current["revision"] }, uri);
                            var restored = DesignerTools.Execute("restoreChange", new JObject { ["checkpointId"] = applied["checkpointId"], ["proposalId"] = restorePreview["proposalId"], ["document"] = file, ["revision"] = restorePreview["revision"] }, uri);
                            Require((bool?)restored["restored"] == true && before.All(f => File.ReadAllBytes(f.Key).SequenceEqual(f.Value)), "Designer checkpoint did not restore exact original source/form bytes: " + restored);
                        }
                    }
                }
                foreach (var operation in new[] { "createComponent", "bindEvent", "deleteComponent" }) await CaseAsync("designer " + operation + " / restore", () => RoundTripAsync(operation));
            }
            if(policy["publishProject"] is JValue publishProject)await CaseAsync("reviewed isolated local publish",async()=>{
                var preview=await IdeRunTools.ExecuteAsync(dte,new JObject{["operation"]="publish-preview",["project"]=publishProject,["configuration"]="Debug"},uri,token);
                var proposed=(string)preview["proposal"]!["outputDirectory"]!;Require(!Directory.Exists(proposed),"Publish output must be fresh");
                var result=await IdeRunTools.ExecuteAsync(dte,new JObject{["operation"]="publish",["proposalId"]=preview["proposalId"],["revision"]=preview["revision"]},uri,token);
                Require((bool?)result["success"]==true&&(int?)result["fileCount"]>0&&(string?)result["outputDirectory"]==proposed,"Local publish did not produce the reviewed artifact: "+result);
                return new JObject{["preview"]=preview,["result"]=result};
            });
            if((bool?)policy["profile"]==true)await CaseAsync("attached fixture EventPipe CPU/GC/comparison",async()=>{
                try{
                    await IdeDebugTools.ExecuteAsync(dte,new JObject{["operation"]="start"},uri,token);await Task.Delay(1000,token);await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
                    Require(dte.Debugger.DebuggedProcesses.Count==1,"Exactly one owned debug target is required for profiling");var pid=dte.Debugger.DebuggedProcesses.Cast<EnvDTE.Process>().Single().ProcessID;
                    var cpu=await IdeProfileTools.ExecuteAsync(dte,new JObject{["operation"]="cpu",["processId"]=pid,["durationSeconds"]=2},uri,token);Require((bool?)cpu["success"]==true,"CPU capture failed: "+cpu);
                    var gc=await IdeProfileTools.ExecuteAsync(dte,new JObject{["operation"]="gc",["processId"]=pid,["durationSeconds"]=2},uri,token);Require((bool?)gc["success"]==true,"GC capture failed: "+gc);
                    var compared=await IdeProfileTools.ExecuteAsync(dte,new JObject{["operation"]="compare",["processId"]=pid,["durationSeconds"]=2,["baselineTrace"]=gc["traceId"]},uri,token);Require((bool?)compared["success"]==true&&(string?)compared["comparison"]?["baselineTraceId"]==(string?)gc["traceId"],"GC comparison did not bind the baseline: "+compared);
                    return new JObject{["cpu"]=cpu,["gc"]=gc,["comparison"]=compared,["workload"]="Idle fixture desktop app; sampling validates capture, not performance improvement"};
                }finally{await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();if(dte.Debugger.CurrentMode!=dbgDebugMode.dbgDesignMode)await IdeDebugTools.ExecuteAsync(dte,new JObject{["operation"]="stop"},uri,CancellationToken.None);}
            });
            receipt["completedAt"] = DateTime.UtcNow.ToString("o"); receipt["passed"] = cases.OfType<JObject>().All(c => (bool?)c["passed"] == true); Save();
            EditorSuggestions.Status("PiAgent fixture acceptance saved: " + output);
            if(policy["soakMinutes"]!=null){var minutes=(int)policy["soakMinutes"]!;Require(minutes>=1&&minutes<=240,"soakMinutes must be 1..240");await SoakAsync(dte,policy,root,uri,minutes,token);}
        } catch (Exception error) {
            if (receipt != null && output != null) { receipt["fatalError"] = error.ToString(); receipt["passed"] = false; File.WriteAllText(output, receipt.ToString(Formatting.Indented, System.Array.Empty<Newtonsoft.Json.JsonConverter>())); }
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(); EditorSuggestions.Status("PiAgent fixture acceptance refused/failed: " + error.Message);
        } finally { Interlocked.Exchange(ref running, 0); }
    }
    private static void Require(bool value, string message) { if (!value) throw new IOException(message); }
    private static async Task SoakAsync(DTE dte,JObject policy,string root,string uri,int minutes,CancellationToken token)
    {
        var path=Path.Combine(root,"piagent-vs-soak.receipt.json");var startedUtc=DateTime.UtcNow;var watch=System.Diagnostics.Stopwatch.StartNew();var required=TimeSpan.FromMinutes(minutes);var lastBuild=TimeSpan.Zero;var samples=0;var builds=0;var errors=new JArray();
        var report=new JObject{["schemaVersion"]=1,["startedAt"]=startedUtc.ToString("o"),["expectedEndAt"]=startedUtc.Add(required).ToString("o"),["requestedMinutes"]=minutes,["kind"]="automated native context/catalog and optional build soak",["limitations"]="No human usage or editor model inference measurement",["fixture"]=root,["implementationVersion"]=typeof(IdeAcceptanceHarness).Assembly.GetName().Version+"+"+typeof(IdeAcceptanceHarness).Assembly.ManifestModule.ModuleVersionId.ToString("N")};
        using(var binaryHash=System.Security.Cryptography.SHA256.Create())using(var binary=File.OpenRead(typeof(IdeAcceptanceHarness).Assembly.Location))report["adapterSha256"]=BitConverter.ToString(binaryHash.ComputeHash(binary)).Replace("-","").ToLowerInvariant();
        long peakPrivate=0;int peakHandles=0;
        void Save(){report["elapsedSeconds"]=watch.Elapsed.TotalSeconds;report["utcElapsedSeconds"]=(DateTime.UtcNow-startedUtc).TotalSeconds;report["samples"]=samples;report["builds"]=builds;report["errors"]=errors;File.WriteAllText(path,report.ToString(Formatting.Indented, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));}
        Save();
        try{while(watch.Elapsed<required||DateTime.UtcNow-startedUtc<required){
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            IdeAcceptanceFixtureGuard.Validate(Environment.GetEnvironmentVariable("PIAGENT_VS_ACCEPTANCE"),root,dte.Solution.FullName,out _,out _);
            try{IdeCatalog.Capture(uri);IdeContextTools.Capture(dte,uri);samples++;
                if((bool?)policy["soakBuild"]==true&&(builds==0||watch.Elapsed-lastBuild>=TimeSpan.FromMinutes(10))){var built=await IdeBuildTools.ExecuteAsync(dte,IdeAcceptanceFixtureGuard.BuildTarget(policy),uri,token);Require((bool?)built["success"]==true,"Soak native build failed: "+built);builds++;lastBuild=watch.Elapsed;}
            }catch(Exception error)when(!(error is OperationCanceledException)){if(errors.Count<100)errors.Add(new JObject{["at"]=DateTime.UtcNow.ToString("o"),["error"]=error.ToString()});else throw new IOException("Soak error bound exceeded");}
            using(var host=System.Diagnostics.Process.GetCurrentProcess()){
                var resource=new JObject{["privateBytes"]=host.PrivateMemorySize64,["workingSetBytes"]=host.WorkingSet64,["handles"]=host.HandleCount,["threads"]=host.Threads.Count};
                if(report["initialResources"]==null)report["initialResources"]=resource.DeepClone();report["currentResources"]=resource;
                peakPrivate=Math.Max(peakPrivate,host.PrivateMemorySize64);peakHandles=Math.Max(peakHandles,host.HandleCount);report["peakPrivateBytes"]=peakPrivate;report["peakHandles"]=peakHandles;
            }
            Save();await Task.Delay(5000,token);
        }var completedUtc=DateTime.UtcNow;report["completedAt"]=completedUtc.ToString("o");report["passed"]=errors.Count==0&&watch.Elapsed>=required&&completedUtc-startedUtc>=required;}
        catch(Exception error){report["passed"]=false;report["stoppedAt"]=DateTime.UtcNow.ToString("o");report["stopReason"]=error.ToString();throw;}
        finally{Save();}
    }
    private static void RestoreRefactorFixture(DTE dte, JObject[] files, Dictionary<string, byte[]> originals, string uri)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        foreach (var file in files) {
            var path = IdeTools.ResolveFile(uri, (string)file["path"]!); var before = (string)file["before"]!; var after = (string)file["after"]!;
            foreach (Document document in dte.Documents) if (string.Equals(document.FullName, path, StringComparison.OrdinalIgnoreCase)) {
                var text = DesignerTools.Read(document); Require(text == before || text == after, "Fixture cleanup preserves unknown editor changes"); document.Close(vsSaveChanges.vsSaveChangesNo); break;
            }
            var textOnDisk = File.ReadAllText(path); Require(textOnDisk == before || textOnDisk == after, "Fixture cleanup preserves unknown disk changes");
            IdeDesignerChanges.RestoreOwnedFile(path, originals[path], File.ReadAllBytes(path));
        }
    }
}
