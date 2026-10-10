using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.FindSymbols;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PiAgent.Vsix;

internal static class Program
{
    private static void Check(bool condition,string name){if(!condition)throw new Exception(name);Console.WriteLine("PASS "+name);}
    static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding=new System.Text.UTF8Encoding(false);
        if(args.Length>0){
            if(args[0]=="--host-json-probe")return await HostJsonProbeAsync();
            if(args[0]=="--designer-contract") { Console.Write(IdeDesignerChanges.ContractFixture().ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>())); return 0; }
            if(args[0]=="--catalog") {
                var entries=new JArray(new[]{"supported","partial","unavailable","blocked"}.Select(state=>IdeCatalog.Entry("ide_debug",state,state,"EnvDTE.Debugger")));
                Console.Write(new JObject{["schemaVersion"]=1,["workspaceUri"]="file:///D:/source/PiAgent/",["revision"]=IdeCatalog.Hash("fixture"),["capturedAt"]=DateTime.UtcNow.ToString("o"),["entries"]=entries}.ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));return 0;
            }
            if(args[0]=="--echo"){Console.Write(JsonConvert.SerializeObject(args.Skip(1).ToArray()));return 0;}
            if(args[0]=="--large"){Console.Write(new string('x',100000));return 0;}
            if(args[0]=="--wait"){await Task.Delay(60000);return 0;}
            if(args[0]=="--spawn"){var child=Process.Start(new ProcessStartInfo{FileName=Process.GetCurrentProcess().MainModule!.FileName,Arguments="--wait",UseShellExecute=false,CreateNoWindow=true});File.WriteAllText(args[1],child!.Id.ToString());await Task.Delay(500);return 0;}
        }
        var root=Path.Combine(Path.GetTempPath(),"piagent-vsix-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try{
            var queued = new DesignerRequestRetirement(); queued.Retire("session", "queued");
            Check(!queued.TryBegin("session", "queued") && queued.TryBegin("another", "queued"), "Designer cancellation retires queued request in its own session");
            Check(queued.TryBegin("session", "started"), "Designer request may begin before cancellation");
            queued.Retire("session", "started"); Check(queued.IsRetired("session", "started"), "Designer late reply is suppressed after cancellation");
            queued.Close(); Check(!queued.TryBegin("session", "other"), "Disconnected designer connection cannot execute queued requests");
            var bounded = new DesignerRequestRetirement(1); bounded.Retire("session", "one");
            Check(!bounded.Retire("session", "two") && !bounded.TryBegin("session", "one") && !bounded.TryBegin("session", "new"), "Designer tombstone capacity fails closed without eviction");
            var contract = IdeDesignerChanges.ContractFixture();
            Check(contract["change"]!["expiresAt"]!.Type == JTokenType.Integer && (long)contract["change"]!["expiresAt"]! > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() && (string)contract["restore"]!["checkpointId"]! == "fixture-checkpoint", "Actual designer result emits numeric expiry and bound restore checkpoint");
            var nativeRecovery=Path.Combine(root,"RecoveryForm.cs");var nativeDesigner=Path.Combine(root,"RecoveryForm.Designer.cs");var nativeResources=Path.Combine(root,"RecoveryForm.resx");
            File.WriteAllText(nativeRecovery,"partial class RecoveryForm {} // original 한글");File.WriteAllText(nativeDesigner,"partial class RecoveryForm {}");File.WriteAllText(nativeResources,"<root />");
            Check(IdeDesignerChanges.CanReviewNativeRecovery(nativeRecovery),"Small native source/form/resource originals admit complete reviewed restoration");
            File.WriteAllText(nativeRecovery,new string('a',64000));File.WriteAllText(nativeDesigner,new string('b',64000));File.WriteAllText(nativeResources,new string('c',64000));
            Check(!IdeDesignerChanges.CanReviewNativeRecovery(nativeRecovery),"Native aggregate recovery budget rejects individually valid 64 KiB journal files before mutation");
            File.WriteAllText(nativeRecovery,"partial class RecoveryForm {}");File.WriteAllText(nativeDesigner,"partial class RecoveryForm {}");File.WriteAllText(nativeResources,new string('r',131072));
            Check(!IdeDesignerChanges.CanReviewNativeRecovery(nativeRecovery),"Large saved resource blocks structural support before recovery becomes unreviewable");
            File.WriteAllText(nativeResources,new string('"',110000));
            Check(!IdeDesignerChanges.CanReviewNativeRecovery(nativeRecovery),"Escaped JSON recovery transport budget is checked independently of raw text");
            var completeRestore=IdeDesignerChanges.OriginalReview(new[]{("RecoveryForm.cs","original line\nsecond original 한글",new string('a',64),123L,new string('b',64),1048576L)});
            Check(completeRestore.Contains("+original line\n+second original 한글")&&completeRestore.Contains("SHA256 "+new string('b',64)+", 1048576 bytes")&&System.Text.Encoding.UTF8.GetByteCount(completeRestore)<2048,"Complete original restore review binds current file hash without growing with designer serialization");
            File.Delete(nativeResources);
            Check(!IdeDesignerChanges.CanReviewNativeRecovery(nativeRecovery),"Missing original native resource never advertises guaranteed source/form recovery");
            var hostJson=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Microsoft Visual Studio","2022","Community","Common7","IDE","PrivateAssemblies","Newtonsoft.Json.13.0.3.0","Newtonsoft.Json.dll");
            if(File.Exists(hostJson)){
                var jsonReferences=HostJsonCompatibility.Audit(typeof(Program).Assembly,hostJson);
                Check(jsonReferences>0,"All "+jsonReferences+" compiled native helper Newtonsoft API signatures exist in actual VS2022 host assembly");
                var hostDirectory=Path.Combine(root,"vs2022-host-json");Directory.CreateDirectory(hostDirectory);
                var ownExecutable=Process.GetCurrentProcess().MainModule!.FileName;
                foreach(var dependency in Directory.EnumerateFiles(Path.GetDirectoryName(ownExecutable)!))if(new[]{".dll",".exe",".config"}.Contains(Path.GetExtension(dependency),StringComparer.OrdinalIgnoreCase))File.Copy(dependency,Path.Combine(hostDirectory,Path.GetFileName(dependency)));
                var childExecutable=Path.Combine(hostDirectory,Path.GetFileName(ownExecutable));var configFile=childExecutable+".config";
                var config=System.Xml.Linq.XDocument.Load(configFile);System.Xml.Linq.XNamespace hostBinding="urn:schemas-microsoft-com:asm.v1";
                var assemblyBinding=config.Descendants(hostBinding+"assemblyBinding").First();
                foreach(var existing in config.Descendants(hostBinding+"dependentAssembly").Where(e=>(string?)e.Element(hostBinding+"assemblyIdentity")?.Attribute("name")=="Newtonsoft.Json").ToArray())existing.Remove();
                assemblyBinding.Add(new System.Xml.Linq.XElement(hostBinding+"dependentAssembly",new System.Xml.Linq.XElement(hostBinding+"assemblyIdentity",new System.Xml.Linq.XAttribute("name","Newtonsoft.Json"),new System.Xml.Linq.XAttribute("publicKeyToken","30ad4fe6b2a6aeed"),new System.Xml.Linq.XAttribute("culture","neutral")),new System.Xml.Linq.XElement(hostBinding+"bindingRedirect",new System.Xml.Linq.XAttribute("oldVersion","0.0.0.0-13.0.0.0"),new System.Xml.Linq.XAttribute("newVersion","13.0.3.0")),new System.Xml.Linq.XElement(hostBinding+"codeBase",new System.Xml.Linq.XAttribute("version","13.0.3.0"),new System.Xml.Linq.XAttribute("href",new Uri(hostJson).AbsoluteUri))));config.Save(configFile);
                var hostProbe=await OwnedProcess.RunAsync(childExecutable,new[]{"--host-json-probe"},hostDirectory,30000,CancellationToken.None);
                Check(hostProbe.ExitCode==0,"VS2022 actual host Newtonsoft binding executes native JSON/refactor methods: "+(hostProbe.ExitCode==0?"PASS":hostProbe.Output));
                var hostResult=JObject.Parse(hostProbe.Output);Check((string?)hostResult["hostVersion"]=="13.0.3.0"&&(int?)hostResult["renameFiles"]==1&&(bool?)hostResult["designerBounded"]==true,"Host compatibility regression uses VS2022 assembly, actual rename and designer serialization");
            }else Console.WriteLine("SKIP VS2022 host JSON assembly unavailable");
            var uri=new Uri(root+Path.DirectorySeparatorChar).AbsoluteUri;var file=Path.Combine(root,"한글.cs");File.WriteAllText(file,"class A {}");
            Check(IdeTools.ResolveFile(uri,"한글.cs")==file,"workspace Unicode path");
            foreach(var path in new[]{"../outside.cs",".env","credentials.json","secrets.json","bin/cache.dll"}){try{IdeTools.ResolveFile(uri,path);throw new Exception("allowed "+path);}catch(IOException){Console.WriteLine("PASS excluded "+path);}}
            var trx=Path.Combine(root,"result.trx");File.WriteAllText(trx,"<TestRun xmlns='urn:trx'><Results><UnitTestResult testName='한글' outcome='Failed'><Output><ErrorInfo><Message>assertion</Message></ErrorInfo></Output></UnitTestResult></Results><ResultSummary><Counters total='2' passed='1' failed='1'/></ResultSummary></TestRun>");
            var results=IdeTools.ReadTrx(trx);Check((int)results["failed"]! ==1&&(string)results["failures"]![0]!["name"]! =="한글","TRX structured failures");
            File.WriteAllText(trx,"<TestRun><ResultSummary><Counters total='1' executed='0' passed='0' failed='0' notExecuted='1'/></ResultSummary></TestRun>");Check((bool)IdeTools.ReadTrx(trx)["noTests"]!,"TRX skipped-only run is not executed tests");
            File.WriteAllText(trx,"<TestRun/>");Check(!(bool)IdeTools.ReadTrx(trx)["available"]!,"TRX missing counters is unavailable");
            File.WriteAllText(trx,"<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///c:/private'>]><TestRun>&e;</TestRun>");try{IdeTools.ReadTrx(trx);throw new Exception("XXE accepted");}catch(System.Xml.XmlException){Console.WriteLine("PASS TRX external entities blocked");}
            var executable=Process.GetCurrentProcess().MainModule!.FileName;var values=new[]{"", "한글 🚀","space value","quote\"inside","trailing slash\\","space and slash\\","$(private); & echo"};
            var echo=await OwnedProcess.RunAsync(executable,new[]{"--echo"}.Concat(values),root,10000,CancellationToken.None);Check(echo.ExitCode==0&&JsonConvert.DeserializeObject<string[]>(echo.Output)!.SequenceEqual(values),"Windows argument round trip without shell");
            var large=await OwnedProcess.RunAsync(executable,new[]{"--large"},root,10000,CancellationToken.None);Check(large.Truncated&&large.Output.Length==32768,"bounded process output");
            using(var cancellation=new CancellationTokenSource(300)){try{await OwnedProcess.RunAsync(executable,new[]{"--wait"},root,10000,cancellation.Token);throw new Exception("not cancelled");}catch(OperationCanceledException){Console.WriteLine("PASS process cancellation");}}
            var pidFile=Path.Combine(root,"child.pid");await OwnedProcess.RunAsync(executable,new[]{"--spawn",pidFile},root,10000,CancellationToken.None);var pid=int.Parse(File.ReadAllText(pidFile));await Task.Delay(100);bool gone;try{gone=Process.GetProcessById(pid).HasExited;}catch(ArgumentException){gone=true;}Check(gone,"owned descendant cleanup after parent exit");
            using var workspace=new AdhocWorkspace();var project=workspace.AddProject("Fixture",LanguageNames.CSharp);var document=workspace.AddDocument(project.Id,"Code.cs",Microsoft.CodeAnalysis.Text.SourceText.From("class A { int Add(int x,int y) => x+y; int Run() => Add(1,2); }"));
            var solution=workspace.CurrentSolution;var symbols=await SymbolFinder.FindSourceDeclarationsAsync(solution,"Add",false);var symbol=symbols.Single();var references=await SymbolFinder.FindReferencesAsync(symbol,solution);Check(references.Sum(r=>r.Locations.Count())==1,"Roslyn semantic references");var callers=await SymbolFinder.FindCallersAsync(symbol,solution);Check(callers.Single().CallingSymbol.Name=="Run","Roslyn caller hierarchy");
            var broken=solution.WithDocumentText(document.Id,Microsoft.CodeAnalysis.Text.SourceText.From("class A { int X() => missing; }"));var compilation=await broken.GetProject(project.Id)!.GetCompilationAsync();Check(compilation!.GetDiagnostics().Any(d=>d.Id=="CS0103"),"Roslyn unsaved-buffer compiler diagnostic");
            var firstFile=Path.Combine(root,"One.cs");var secondFile=Path.Combine(root,"Two.cs");
            const string firstSource="partial class A { int Add(int x,int y) => x+y; } // 한글 🚀";
            const string secondSource="partial class A { int Run() => Add(1,2); }";
            File.WriteAllText(firstFile,firstSource);File.WriteAllText(secondFile,secondSource);
            var firstId=DocumentId.CreateNewId(project.Id);var secondId=DocumentId.CreateNewId(project.Id);
            var refactorSolution=workspace.CurrentSolution.RemoveDocument(document.Id).AddDocument(firstId,"One.cs",Microsoft.CodeAnalysis.Text.SourceText.From(firstSource),filePath:firstFile).AddDocument(secondId,"Two.cs",Microsoft.CodeAnalysis.Text.SourceText.From(secondSource),filePath:secondFile);
            var renameArgs=new JObject{["operation"]="rename",["line"]=1,["column"]=firstSource.IndexOf("Add",StringComparison.Ordinal)+1,["newName"]="Sum"};
            var rename=await IdeRefactoringTools.PrepareAsync(refactorSolution,firstId,renameArgs,uri,CancellationToken.None);
            var semanticRevision=await IdeRefactoringTools.FingerprintAsync(refactorSolution,CancellationToken.None);
            var unrelatedEdit=refactorSolution.WithDocumentText(secondId,Microsoft.CodeAnalysis.Text.SourceText.From(secondSource+" // intervening semantic source edit"));
            Check(await IdeRefactoringTools.FingerprintAsync(unrelatedEdit,CancellationToken.None)!=semanticRevision,"Semantic fingerprint changes for another source document edit");
            Check(((JArray)rename.Result["files"]!).Count==2&&((await rename.After.GetDocument(secondId)!.GetTextAsync()).ToString()).Contains("Sum(1,2)"),"Semantic rename previews declarations and references in two files");
            var rebasedNative=IdeRefactoringTools.RebaseReviewed(refactorSolution,(JArray)rename.Result["files"]!,uri,false);
            Check((await rebasedNative.GetDocument(secondId)!.GetTextAsync()).ToString().Contains("Sum(1,2)"),"Approved rename texts rebase onto current native workspace branch");
            var restoredNative=IdeRefactoringTools.RebaseReviewed(rebasedNative,(JArray)rename.Result["files"]!,uri,true);
            Check((await restoredNative.GetDocument(firstId)!.GetTextAsync()).ToString()==firstSource,"Refactor compensation rebases only owned target original text");
            var partial=IdeRefactoringTools.RecoveryState(new (string? Disk,string? Buffer,string Before,string After)[]{(firstSource,firstSource,firstSource,"changed"),("changed","changed",secondSource,"changed")});
            Check(partial.Safe&&!partial.Unchanged,"Partial multi-file save is eligible for owned rollback");
            var external=IdeRefactoringTools.RecoveryState(new (string? Disk,string? Buffer,string Before,string After)[]{("external edit","changed",firstSource,"changed")});
            Check(!external.Safe&&!external.Unchanged,"External modification prevents refactor rollback");
            var unreadable=IdeRefactoringTools.RecoveryState(new[]{(Disk:(string?)null,Buffer:(string?)null,Before:firstSource,After:"changed")});
            Check(!unreadable.Safe&&!unreadable.Unchanged,"Unreadable target cannot mask failed recovery as unchanged");
            Check(EditorSuggestionValidity.IsCurrent(false,false,3,3,true,true,true)&&!EditorSuggestionValidity.IsCurrent(false,false,3,4,true,true,true)&&!EditorSuggestionValidity.IsCurrent(false,true,3,3,true,true,true)&&!EditorSuggestionValidity.IsCurrent(false,false,3,3,false,true,true)&&!EditorSuggestionValidity.IsCurrent(false,false,3,3,true,false,true)&&!EditorSuggestionValidity.IsCurrent(false,false,3,3,true,true,false),"Cancelled, IME-composing, moved-caret and switched-document suggestions cannot commit");
            var outsideId=DocumentId.CreateNewId(project.Id);var outsideText="class Outside { int Add() => 1; }";
            var duplicateSuffix=refactorSolution.AddDocument(outsideId,"One.cs",Microsoft.CodeAnalysis.Text.SourceText.From(outsideText),filePath:Path.Combine(Path.GetTempPath(),"PiAgentOutsideFixtureScope","One.cs"));
            var scopedRebase=IdeRefactoringTools.RebaseReviewed(duplicateSuffix,(JArray)rename.Result["files"]!,uri,false);
            Check((await scopedRebase.GetDocument(outsideId)!.GetTextAsync()).ToString()==outsideText,"Reviewed-text rebase preserves same-name document outside bound workspace");

            Check(File.ReadAllText(firstFile)==firstSource&&File.ReadAllText(secondFile)==secondSource,"Refactoring preparation never writes disk");
            Check(((await rename.After.GetDocument(firstId)!.GetTextAsync()).ToString()).Contains("한글 🚀"),"Refactoring preserves Unicode outside target symbol");
            var formatted=await IdeRefactoringTools.PrepareAsync(refactorSolution,firstId,new JObject{["operation"]="format"},uri,CancellationToken.None);
            Check((await formatted.After.GetDocument(firstId)!.GetTextAsync()).ToString()!=firstSource&&File.ReadAllText(firstFile)==firstSource,"Roslyn formatting is preview-only");
            try{await IdeRefactoringTools.PrepareAsync(refactorSolution,firstId,new JObject{["operation"]="rename",["line"]=999,["column"]=1,["newName"]="Sum"},uri,CancellationToken.None);throw new Exception("invalid refactor position accepted");}catch(IOException){Console.WriteLine("PASS invalid semantic position rejected");}
            Check(IdeBuildTools.Flags("clean")!=IdeBuildTools.Flags("build")&&IdeBuildTools.Flags("rebuild")!=IdeBuildTools.Flags("build"),"Native clean/rebuild flags are distinct");
            Check(IdeBuildTools.PlatformNames("Any CPU").Contains("AnyCPU")&&IdeBuildTools.PlatformNames("x64").Length==1,"SDK Any CPU configuration alias preserves explicit architecture");
            Check(IdeBuildTools.ActiveConfigurationMatches("Debug","Any CPU","Debug","AnyCPU")&&!IdeBuildTools.ActiveConfigurationMatches("Release","Any CPU","Debug","AnyCPU")&&!IdeBuildTools.ActiveConfigurationMatches("Debug","x64","Debug","AnyCPU"),"Legacy native active configuration fallback never substitutes requested target");
            const string nativeSource="partial class Form { private void AgentClick(object sender, System.EventArgs e) {} }";
            const string nativeForm="partial class Form { private System.Windows.Forms.Button AgentButton; private void InitializeComponent() { this.AgentButton = new System.Windows.Forms.Button(); this.AgentButton.Click += new System.EventHandler(this.AgentClick); } }";
            IdeDesignerChanges.VerifySavedNative(new JObject{["changeOperation"]="createComponent",["name"]="AgentButton",["type"]="Button"},nativeSource,nativeForm);
            IdeDesignerChanges.VerifySavedNative(new JObject{["changeOperation"]="bindEvent",["component"]="AgentButton",["property"]="Click",["eventMethod"]="AgentClick"},nativeSource,nativeForm);
            Check(true,"Native saved source verifies actual control construction and event hookup/handler");
            foreach(var corrupted in new[]{nativeForm.Replace("this.AgentButton.Click += new System.EventHandler(this.AgentClick);",""),nativeForm.Replace("this.AgentClick","this.OtherClick")}){try{IdeDesignerChanges.VerifySavedNative(new JObject{["changeOperation"]="bindEvent",["component"]="AgentButton",["property"]="Click",["eventMethod"]="AgentClick"},nativeSource,corrupted);throw new Exception("unpersisted event accepted");}catch(IOException){Console.WriteLine("PASS native event serialization loss refused");}}
            var settings=Path.Combine(root,"Fixture.runsettings");File.WriteAllText(settings,"<RunSettings/>");
            var testArgs=IdeTestTools.Arguments(firstFile,new JObject{["operation"]="run",["configuration"]="Release",["framework"]="net8.0",["settings"]="Fixture.runsettings",["filter"]="FullyQualifiedName~한글"},root,uri);
            Check(testArgs.Contains("--configuration")&&testArgs.Contains("Release")&&testArgs.Contains("net8.0")&&testArgs.Contains(settings)&&testArgs.Contains("FullyQualifiedName~한글")&&testArgs.Contains("trx;LogFilePrefix=results"),"VSTest uses per-framework TRX files while retaining target/settings arguments");
            var reportA=Path.Combine(root,"results_net8.0.trx");var reportB=Path.Combine(root,"results_net10.0.trx");
            Check((bool?)IdeTestTools.ReadReports(Array.Empty<string>(),false,2)["available"]==false,"Missing VSTest TRX reports cannot certify a test run");
            File.WriteAllText(reportA,"<TestRun><ResultSummary><Counters total='2' executed='2' passed='2' failed='0'/></ResultSummary></TestRun>");
            File.WriteAllText(reportB,"<TestRun><Results><UnitTestResult testName='SecondFramework.Fails' outcome='Failed'><Output><ErrorInfo><Message>repair me</Message></ErrorInfo></Output></UnitTestResult></Results><ResultSummary><Counters total='2' executed='2' passed='1' failed='1'/></ResultSummary></TestRun>");
            var combined=IdeTestTools.ReadReports(new[]{reportA,reportB},false,2);
            Check((int?)combined["reportCount"]==2&&(int?)combined["total"]==4&&(int?)combined["passed"]==3&&(int?)combined["failed"]==1&&(string?)combined["failures"]?[0]?["name"]=="SecondFramework.Fails","Multi-target VSTest aggregates both TRX reports and preserves a failing framework");
            var partialReports=IdeTestTools.ReadReports(new[]{reportA},false,2);
            Check((bool?)partialReports["available"]==false&&(int?)partialReports["expectedReportCount"]==2&&(int?)partialReports["reportCount"]==1,"One surviving TRX cannot certify a two-framework VSTest run");
            Check(IdeTestTools.ParseFrameworks("{\"Properties\":{\"TargetFramework\":\"\",\"TargetFrameworks\":\"net9.0;net10.0\",\"TargetFrameworkVersion\":\"\"}}").SequenceEqual(new[]{"net9.0","net10.0"}),"Evaluated multi-target MSBuild property determines required TRX count");
            Check(IdeTestTools.ParseFrameworks("{\"Properties\":{\"TargetFramework\":\"net8.0\",\"TargetFrameworks\":\"net8.0;net9.0\"}}").SequenceEqual(new[]{"net8.0"}),"Explicit evaluated TargetFramework takes precedence over multi-target property");
            File.WriteAllText(reportB,"<TestRun/>");
            try{IdeTestTools.ReadReports(new[]{reportA,reportB},false,2);throw new Exception("incomplete framework report accepted");}catch(IOException){Console.WriteLine("PASS incomplete framework TRX prevents combined success");}
            var runnerRoot=Path.Combine(root,"runner-config");Directory.CreateDirectory(runnerRoot);
            File.WriteAllText(Path.Combine(runnerRoot,"global.json"),"{\"test\":{\"runner\":\"Microsoft.Testing.Platform\"}}");
            Check(IdeTestTools.UsesMtpRunner(Path.Combine(runnerRoot,"nested")),"MTP runner is selected only by nearest global.json opt-in");
            var mtpArgs=IdeTestTools.Arguments(firstFile,new JObject{["operation"]="run",["configuration"]="Release",["framework"]="net10.0"},root,uri,true).ToArray();
            Check(mtpArgs.Take(4).SequenceEqual(new[]{"test","--project",firstFile,"--no-restore"})&&mtpArgs.Contains("--framework")&&mtpArgs.Skip(mtpArgs.Length-4).SequenceEqual(new[]{"--","--report-trx","--report-trx-filename","results.trx"})&&!mtpArgs.Contains("--logger"),"MTP run binds one framework and uses registered TRX reporter arguments");
            try{IdeTestTools.Arguments(firstFile,new JObject{["operation"]="run"},root,uri,true);throw new Exception("ambiguous multi-target MTP run accepted");}catch(IOException){Console.WriteLine("PASS MTP target framework required for one-result scope");}
            try{IdeTestTools.Arguments(firstFile,new JObject{["operation"]="run",["framework"]="net10.0",["filter"]="FullyQualifiedName~Fixture"},root,uri,true);throw new Exception("framework-specific MTP filter accepted");}catch(IOException){Console.WriteLine("PASS MTP framework-specific filter refused");}
            File.WriteAllText(Path.Combine(runnerRoot,"global.json"),"{\"test\":{\"runner\":\"VSTest\"}}");
            Check(!IdeTestTools.UsesMtpRunner(runnerRoot),"Explicit VSTest runner remains on VSTest backend");
            var discovered=IdeTestTools.ParseDiscovery("Test run\nThe following Tests are available:\n    Fixture.Adds\n    Fixture.한글\n");
            Check(discovered.Parsed&&discovered.Names.Count==2,"VSTest discovery parses two test identities");
            Check(IdeTestTools.ParseDiscovery("The following Tests are available:\n").Names.Count==0&&!IdeTestTools.ParseDiscovery("MTP output without VSTest listing").Parsed,"Empty and unknown test runners cannot report parsed tests");
            var mtpEnglish=IdeTestTools.ParseMtpDiscovery("Discovering tests\nDiscovered 2 tests in assembly - MtpConsole.dll\n  UnicodeName\n  SecondTest\n\nDiscovered 2 tests.\n");
            var mtpKorean=IdeTestTools.ParseMtpDiscovery("어셈블리에서 2개의 테스트가 검색됨 - MtpConsole.dll\n  UnicodeName\n  SecondTest\n\n2개 테스트가 검색됨\n");
            Check(mtpEnglish.Parsed&&mtpKorean.Parsed&&mtpEnglish.Names.Count==2&&mtpKorean.Names.Count==2,"Actual .NET 10 MTP English and Korean discovery listings parse two display names");
            Check(!IdeTestTools.ParseMtpDiscovery("Discovered 2 tests in assembly - MtpConsole.dll\n  OnlyOne\n").Parsed,"Incomplete MTP test listing never reports parsed success");
            Check(!IdeTestTools.ParseMtpDiscovery("Discovered 1 test in assembly - First.dll\n  First\nDiscovered 1 test in assembly - Second.dll\n  Second\n").Parsed,"Multiple MTP module listings cannot masquerade as one complete result");
            var mtpTrx=Environment.GetEnvironmentVariable("PIAGENT_MTP_TRX");
            if(!string.IsNullOrEmpty(mtpTrx)){
                var actual=IdeTools.ReadTrx(mtpTrx);
                Check((bool?)actual["available"]==true&&(int?)actual["passed"]==2&&(int?)actual["failed"]==0,"Actual MTP TRX is compatible with bounded result parser");
            }
            var mtpFailedTrx=Environment.GetEnvironmentVariable("PIAGENT_MTP_FAILED_TRX");
            if(!string.IsNullOrEmpty(mtpFailedTrx)){
                var actual=IdeTools.ReadTrx(mtpFailedTrx);
                Check((bool?)actual["available"]==true&&(int?)actual["passed"]==1&&(int?)actual["failed"]==1,"Actual failing MTP TRX cannot be counted as a successful run");
            }
            try{IdeTestTools.Arguments(firstFile,new JObject{["operation"]="run",["settings"]="../Outside.runsettings"},root,uri);throw new Exception("outside settings accepted");}catch(IOException){Console.WriteLine("PASS external test settings rejected");}
            var bigSource=new string('가',110000)+"🚀"+new string('b',110000);var cursor=110002;var window=EditorContextWindow.Create(bigSource,cursor);
            Check(System.Text.Encoding.UTF8.GetByteCount(window.Text)<=65536&&window.Start+window.Position==cursor&&window.Text.Contains("🚀"),"Large Unicode editor window stays bounded and maps caret");
            try{EditorContextWindow.Create(bigSource,110001);throw new Exception("split caret accepted");}catch(IOException){Console.WriteLine("PASS editor window rejects split surrogate caret");}
            Check(IdeTools.ResolveFile(uri,"NewUnsaved.cs",true)==Path.Combine(root,"NewUnsaved.cs")&&!File.Exists(Path.Combine(root,"NewUnsaved.cs")),"New editor path can be validated without writing disk");
            const string xaml="<?xml version=\"1.0\"?>\r\n<Grid xmlns='urn:test'>\r\n  <!-- 한글 🚀 -->\r\n  <Button Width = '80' Content=\"A &amp; B\" />\r\n</Grid>";
            Check(DesignerTools.ReplaceXamlAttribute(xaml,"1","Width","110")==xaml.Replace("'80'","'110'"),"XAML attribute edit preserves declaration/comments/spacing/line endings");
            Check(DesignerTools.ReplaceXamlAttribute(xaml,"1","Content","\"가&나\"").Contains("Content=\"&quot;가&amp;나&quot;\""),"XAML scalar replacement escapes delimiter and XML entities");
            foreach(var availability in new[]{"blocked","unavailable"}){
                var entry=IdeCatalog.Entry("ide_debug","pause",availability,"EnvDTE.Debugger");
                Check(!string.IsNullOrEmpty((string?)entry["reasonCode"])&&!string.IsNullOrEmpty((string?)entry["reason"]),"Catalog "+availability+" always includes reason and code");
            }
            const string form="<?xml version=\"1.0\"?>\r\n<Grid xmlns=\"urn:test\" xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\" x:Class=\"Fixture.MainWindow\">\r\n  <!-- preserved 한글 🚀 -->\r\n  <Button x:Name='Existing' Content=\"<escaped>\" />\r\n</Grid>";
            var validForm=form.Replace("<escaped>","&lt;escaped&gt;");
            var created=XamlStructureEdits.Prepare(validForm,new JObject{["changeOperation"]="createComponent",["type"]="Button",["name"]="NewButton",["parent"]="0",["width"]=120});
            Check(created.Contains("x:Name=\"NewButton\"")&&created.Contains("<!-- preserved 한글 🚀 -->")&&created.StartsWith("<?xml version=\"1.0\"?>\r\n"),"XAML create retains declaration/Unicode/comments and named element");
            Check(XamlStructureEdits.Prepare(created,new JObject{["changeOperation"]="deleteComponent",["component"]="2"}).Contains("x:Name='Existing'"),"XAML delete removes selected leaf while preserving sibling");
            var binding=XamlStructureEdits.Prepare(validForm,new JObject{["changeOperation"]="bindEvent",["component"]="1",["property"]="Click",["eventMethod"]="HandleClick"});
            var handler=IdeDesignerChanges.BindCodeBehind(validForm,"namespace Fixture { public partial class MainWindow { } }",new JObject{["property"]="Click",["eventMethod"]="HandleClick",["create"]=true},"wpf-xaml");
            Check(binding.Contains("Click=\"HandleClick\"")&&handler.Contains("global::System.Windows.RoutedEventArgs")&&!CSharpSyntaxTree.ParseText(handler).GetDiagnostics().Any(),"XAML event binding creates matching syntactically valid C# handler");
            foreach(var operation in new[]{new JObject{["changeOperation"]="deleteComponent",["component"]="0"},new JObject{["changeOperation"]="createComponent",["type"]="Button",["name"]="Existing"}}){
                try{XamlStructureEdits.Prepare(validForm,operation);throw new Exception("unsafe XAML edit accepted");}catch(IOException){Console.WriteLine("PASS XAML root delete or duplicate name refused");}
            }
            var journalFile=Path.Combine(root,"Form.resx");var beforeBytes=new byte[]{0xef,0xbb,0xbf,65,13,10};var afterBytes=new byte[]{0xef,0xbb,0xbf,66,13,10};File.WriteAllBytes(journalFile,afterBytes);
            IdeDesignerChanges.RestoreOwnedFile(journalFile,beforeBytes,afterBytes);
            Check(File.ReadAllBytes(journalFile).SequenceEqual(beforeBytes),"Designer restore retains exact BOM and newline bytes");
            File.WriteAllText(journalFile,"intervening user change");try{IdeDesignerChanges.RestoreOwnedFile(journalFile,beforeBytes,afterBytes);throw new Exception("stale restore accepted");}catch(IOException){Check(File.ReadAllText(journalFile)=="intervening user change","Designer restore preserves intervening user changes");}
            var debugRow=new JObject{["threadId"]=1};IdeDebugTools.Optional(debugRow,"location",()=>throw new System.Runtime.InteropServices.COMException("Unsupported",unchecked((int)0x80004005)));
            Check((int)debugRow["threadId"]! == 1 && (string?)debugRow["locationUnavailable"]?["hresult"]=="0x80004005","Unsupported debugger field retains thread snapshot and explicit unavailable reason");
            var fixtureSolution=Path.Combine(root,"DedicatedFixture.sln");File.WriteAllText(fixtureSolution,"fixture");var marker=Path.Combine(root,"piagent-vs-acceptance.fixture.json");
            File.WriteAllText(marker,"{\"schemaVersion\":1,\"destructiveFixture\":true}");
            var policy=IdeAcceptanceFixtureGuard.Validate("1",root,fixtureSolution,out var fixtureRoot,out var fixtureUri);
            Check((bool)policy["destructiveFixture"]!&&fixtureRoot==root&&fixtureUri==uri,"Fixture harness accepts only explicit marked solution directory");
            var defaultBuild=IdeAcceptanceFixtureGuard.BuildTarget(policy);Check((string?)defaultBuild["configuration"]=="Debug"&&(string?)defaultBuild["platform"]=="Any CPU","Existing fixture build selection retains Debug/Any CPU defaults");
            var cppBuild=IdeAcceptanceFixtureGuard.BuildTarget(new JObject{["project"]="NativeCppConsole.vcxproj",["configuration"]="Debug",["platform"]="x64"});Check((string?)cppBuild["project"]=="NativeCppConsole.vcxproj"&&(string?)cppBuild["configuration"]=="Debug"&&(string?)cppBuild["platform"]=="x64","Native fixture marker selects exact x64 project configuration");
            foreach(var invalidPlatform in new JToken[]{new JValue(64),new JValue(""),new JValue("x64\n"),new JValue(new string('x',65))}){try{IdeAcceptanceFixtureGuard.BuildTarget(new JObject{["platform"]=invalidPlatform});throw new Exception("Invalid fixture platform accepted");}catch(IOException){Console.WriteLine("PASS invalid native fixture platform refused");}}
            foreach(var optIn in new[]{null,"0"}){try{IdeAcceptanceFixtureGuard.Validate(optIn,root,fixtureSolution,out _,out _);throw new Exception("unguarded fixture accepted");}catch(IOException){Console.WriteLine("PASS fixture harness disabled without exact opt-in");}}
            try{IdeAcceptanceFixtureGuard.Validate("1",root,Path.Combine(Path.GetTempPath(),"Production.sln"),out _,out _);throw new Exception("other solution accepted");}catch(IOException){Console.WriteLine("PASS fixture harness refuses another solution directory");}
            File.WriteAllText(marker,"{\"schemaVersion\":1,\"destructiveFixture\":false}");try{IdeAcceptanceFixtureGuard.Validate("1",root,fixtureSolution,out _,out _);throw new Exception("unmarked fixture accepted");}catch(IOException){Console.WriteLine("PASS fixture harness requires destructive-fixture marker");}
            return 0;
        }catch(Exception error){await Console.Error.WriteLineAsync(error.ToString());return 1;}
        finally{var canonical=Path.GetFullPath(root);if(canonical.StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(canonical).StartsWith("piagent-vsix-tests-"))Directory.Delete(canonical,true);}
    }
    private static async Task<int> HostJsonProbeAsync()
    {
        var root=Path.Combine(Path.GetTempPath(),"piagent-host-json-probe-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try{
            var source="class A { int Add(int x,int y) => x+y; int Run() => Add(1,2); }";var path=Path.Combine(root,"Fixture.cs");File.WriteAllText(path,source);var uri=new Uri(root+Path.DirectorySeparatorChar).AbsoluteUri;
            using var workspace=new AdhocWorkspace();var project=workspace.AddProject("Fixture",LanguageNames.CSharp);
            var documentId=DocumentId.CreateNewId(project.Id);var solution=workspace.CurrentSolution.AddDocument(documentId,"Fixture.cs",Microsoft.CodeAnalysis.Text.SourceText.From(source),filePath:path);
            var rename=await IdeRefactoringTools.PrepareAsync(solution,documentId,new JObject{["operation"]="rename",["line"]=1,["column"]=source.IndexOf("Add",StringComparison.Ordinal)+1,["newName"]="Sum"},uri,CancellationToken.None);
            var contract=DesignerTools.Bounded(IdeDesignerChanges.ContractFixture());
            var output=new JObject{["hostVersion"]=typeof(JToken).Assembly.GetName().Version!.ToString(),["renameFiles"]=((JArray)rename.Result["files"]!).Count,["designerBounded"]=contract["restore"]?["checkpointId"]!=null,["catalogEntry"]=IdeCatalog.Entry("ide_debug","pause","blocked","EnvDTE.Debugger")};
            Console.Write(output.ToString(Formatting.None,Array.Empty<JsonConverter>()));return 0;
        }finally{var canonical=Path.GetFullPath(root);if(canonical.StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(canonical).StartsWith("piagent-host-json-probe-",StringComparison.Ordinal))Directory.Delete(canonical,true);}
    }
}
