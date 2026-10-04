using System;
using System.Threading;
using System.Threading.Tasks;
using PiAgent.Transport;
internal static class Program {
 private static async Task<int> Main(string[] args) {
  try { using var cancellation=new CancellationTokenSource(30000);await CoreRuntime.EnsureRunningAsync(args[0],cancellation.Token);using var client=new PipeAdapterClient(args[0]);await client.InitializeAsync("bootstrap-test","2026","framework-probe",cancellation.Token);Console.WriteLine("NET472 bootstrap and authentication passed");return 0; }
  catch(Exception error){Console.Error.WriteLine(error);return 1;}
 }
}
