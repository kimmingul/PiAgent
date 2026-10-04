import { execFile } from 'node:child_process';
import { isObject } from '@piagent/protocol';
import type { OmpOptions, OmpProcess } from '@piagent/omp';

const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
/** Session accounting and provider plan limits are separate; missing values are never fabricated. */
export class UsageService {
  private cached:{at:number;provider:string;value:unknown}|undefined;
  private pending:Promise<unknown>|undefined;
  constructor(private readonly options:OmpOptions) {}
  async read(omp:OmpProcess):Promise<Record<string,unknown>> {
    const [statsFrame,stateFrame]=await Promise.all([omp.request('get_session_stats'),omp.request('get_state')]);
    const stats=isObject(statsFrame['data'])?statsFrame['data']:{},state=isObject(stateFrame['data'])?stateFrame['data']:{};
    const model=isObject(state['model'])?state['model']:{};
    const provider=typeof model['provider']==='string'?model['provider']:'';
    const tokens=isObject(stats['tokens'])?stats['tokens']:{},context=isObject(stats['contextUsage'])?stats['contextUsage']:{};
    let limits:unknown=null,limitsError:string|undefined;
    if (/^[a-zA-Z0-9._-]{1,128}$/.test(provider)) {
      try {limits=await this.limits(provider);} catch {limitsError='Provider limits unavailable';}
    }
    return {provider:provider||null,model:typeof model['id']==='string'?model['id']:null,currency:'USD',
      cost:number(stats['cost']),premiumRequests:number(stats['premiumRequests']),
      tokens:Object.fromEntries(['input','output','reasoning','cacheRead','cacheWrite','total'].map(key=>[key,number(tokens[key])])),
      context:{tokens:number(context['tokens']),contextWindow:number(context['contextWindow'])},
      providerLimits:limits,...(limitsError?{limitsError}:{})};
  }
  async drain():Promise<void>{await this.pending?.catch(()=>{});}
  private async limits(provider:string):Promise<unknown> {
    if (this.cached?.provider===provider&&Date.now()-this.cached.at<60_000)return this.cached.value;
    if(this.pending){await this.pending;if(this.cached?.provider===provider)return this.cached.value;}
    const query=new Promise<unknown>((resolve,reject)=>execFile(this.options.executable,[...(this.options.executableArgs??[]),'usage','--json','--provider',provider],
      {cwd:this.options.cwd,windowsHide:true,timeout:30_000,maxBuffer:1024*1024,encoding:'utf8'},(error,stdout)=>{
        if(error){reject(new Error('Provider limits unavailable'));return;}
        try {
          const raw:unknown=JSON.parse(stdout);if(!isObject(raw)||!Array.isArray(raw['reports']))throw new Error('Invalid usage report');
          const report=raw['reports'].find(item=>isObject(item)&&item['provider']===provider);
          if(!isObject(report)){resolve(null);return;}
          const metadata=isObject(report['metadata'])?report['metadata']:{};
          const rows=Array.isArray(report['limits'])?report['limits'].slice(0,32).filter(isObject).map(row=>{
            const window=isObject(row['window'])?row['window']:{},amount=isObject(row['amount'])?row['amount']:{};
            return {label:typeof row['label']==='string'?row['label'].slice(0,128):'',usedFraction:number(amount['usedFraction']),
              resetsAt:number(window['resetsAt']),window:typeof window['label']==='string'?window['label'].slice(0,128):''};
          }):[];
          resolve({plan:typeof metadata['planType']==='string'?metadata['planType'].slice(0,128):null,limits:rows});
        }catch{reject(new Error('Invalid usage report'));}
      }));
    this.pending=query;
    try{const value=await query;this.cached={at:Date.now(),provider,value};return value;}finally{this.pending=undefined;}
  }
}
