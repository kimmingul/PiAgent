using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Diagnostics.Tracing;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

internal static class Program
{
    static int Main(string[] args)
    {
        try{
            if(args.Length!=1||!Path.GetExtension(args[0]).Equals(".nettrace",StringComparison.OrdinalIgnoreCase)||new FileInfo(args[0]).Length>64*1024*1024)throw new IOException("A bounded nettrace file is required");
            using var source=new EventPipeEventSource(args[0]);
            var starts=new Dictionary<int,double>();var types=new Dictionary<string,long>(StringComparer.Ordinal);var generations=new int[5];
            long allocationBytes=0;long allocationTicks=0;long heapBytes=0;var heapSamples=0;double duration=0;var collections=0;
            source.Clr.GCStart+=data=>{starts[data.Count]=data.TimeStampRelativeMSec;if(data.Depth>=0&&data.Depth<generations.Length)generations[data.Depth]++;collections++;};
            source.Clr.GCStop+=data=>{if(starts.TryGetValue(data.Count,out var start)){duration+=Math.Max(0,data.TimeStampRelativeMSec-start);starts.Remove(data.Count);}};
            source.Clr.GCAllocationTick+=data=>{var amount=data.AllocationAmount64>0?data.AllocationAmount64:data.AllocationAmount;allocationBytes+=amount;allocationTicks++;var type=data.TypeName??"unknown";if(type.Length>512)type=type.Substring(0,512);if(types.ContainsKey(type))types[type]+=amount;else if(types.Count<256)types[type]=amount;};
            source.Clr.GCHeapStats+=data=>{heapBytes=(long)data.TotalHeapSize;heapSamples++;};
            source.Process();
            var result=new JObject{["available"]=true,["collections"]=collections,["collectionsByGeneration"]=new JArray(generations),["collectionDurationMilliseconds"]=duration,["sampledAllocationBytesEstimate"]=allocationBytes,["allocationTickCount"]=allocationTicks,["lastReportedHeapBytes"]=heapSamples>0?(JToken)new JValue(heapBytes):JValue.CreateNull(),["heapStatsSamples"]=heapSamples,["topSampledAllocationTypes"]=new JArray(types.OrderByDescending(x=>x.Value).Take(20).Select(x=>new JObject{["type"]=x.Key,["sampledBytesEstimate"]=x.Value})),["limitations"]="Allocation ticks are sampled estimates. Heap size is last reported GC heap statistics, not a heap snapshot. Collection duration is not stop-the-world pause time."};
            Console.Write(result.ToString(Formatting.None, System.Array.Empty<Newtonsoft.Json.JsonConverter>()));return 0;
        }catch(Exception error){Console.Error.Write(error.GetType().Name+": "+error.Message);return 1;}
    }
}
