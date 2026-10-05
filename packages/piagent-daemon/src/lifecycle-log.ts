import {appendFileSync,existsSync,renameSync,statSync} from 'node:fs';
import {join} from 'node:path';

/** Two bounded files inside the broker-created private credential directory. No RPC payloads. */
export function lifecycleLog(directory:string):(event:Record<string,unknown>)=>void {
  const file=join(directory,'lifecycle.jsonl');
  return event=>{
    const value:Record<string,unknown>={at:new Date().toISOString()};
    for(const key of ['kind','sessionId','turnId','phase'])if(typeof event[key]==='string')value[key]=event[key].slice(0,64);
    for(const key of ['elapsedMs','quietMs','activeTools','activeAgents'])if(typeof event[key]==='number'&&Number.isFinite(event[key]))value[key]=event[key];
    try {
      if(existsSync(file)&&statSync(file).size>1_048_576)renameSync(file,file+'.previous');
      appendFileSync(file,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600});
    } catch { /* Diagnostic I/O failure must never close the pipe or kill OMP. */ }
  };
}
