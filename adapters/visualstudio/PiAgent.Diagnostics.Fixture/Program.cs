using System.Diagnostics;
var elapsed=Stopwatch.StartNew();var retained=new List<byte[]>();
Console.WriteLine(Environment.ProcessId);
while(elapsed.Elapsed<TimeSpan.FromSeconds(15)){
    for(var index=0;index<1000;index++)retained.Add(new byte[4096]);
    retained.Clear();GC.Collect();Thread.Sleep(20);
}
