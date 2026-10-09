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
using PiAgent.Vsix;

internal static class Program
{
    private static void Check(bool condition,string name){if(!condition)throw new Exception(name);Console.WriteLine("PASS "+name);}
    static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding=new System.Text.UTF8Encoding(false);
        if(args.Length>0){
            if(args[0]=="--echo"){Console.Write(JsonConvert.SerializeObject(args.Skip(1).ToArray()));return 0;}
            if(args[0]=="--large"){Console.Write(new string('x',100000));return 0;}
            if(args[0]=="--wait"){await Task.Delay(60000);return 0;}
            if(args[0]=="--spawn"){var child=Process.Start(new ProcessStartInfo{FileName=Process.GetCurrentProcess().MainModule!.FileName,Arguments="--wait",UseShellExecute=false,CreateNoWindow=true});File.WriteAllText(args[1],child!.Id.ToString());await Task.Delay(500);return 0;}
        }
        var root=Path.Combine(Path.GetTempPath(),"piagent-vsix-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try{
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
            return 0;
        }catch(Exception error){Console.Error.WriteLine(error);return 1;}
        finally{var canonical=Path.GetFullPath(root);if(canonical.StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(canonical).StartsWith("piagent-vsix-tests-"))Directory.Delete(canonical,true);}
    }
}
