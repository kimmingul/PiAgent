import {randomUUID} from 'node:crypto';
import {OmpProcess,type OmpOptions} from '@piagent/omp';
import {Interactions} from './interactions.js';
import {isObject} from '@piagent/protocol';

/** Authentication owns a disposable child so cancelling OAuth never restarts a conversation. */
export class Login {
  private child:OmpProcess|undefined;
  private interactions:Interactions|undefined;
  private prefix='';
  constructor(private readonly options:OmpOptions,private readonly emit:(frame:Record<string,unknown>)=>void){}
  get active():boolean{return !!this.child;}
  async start(providerId:unknown):Promise<{started:true}> {
    if(this.child)throw new Error('Login already in progress');
    if(typeof providerId!=='string'||!providerId||providerId.length>256)throw new Error('Invalid login provider');
    const child=new OmpProcess({...this.options,requestTimeoutMs:300000,executableArgs:[...(this.options.executableArgs??[]),'--no-session','--no-tools','--no-extensions','--no-skills','--no-rules','--no-lsp','--no-title','--no-pty']});
    this.child=child;const prefix=this.prefix=`login:${randomUUID()}:`;
    const emit=(frame:Record<string,unknown>):void=>{if(this.child!==child)return;this.emit({...frame,login:true,...(typeof frame['id']==='string'?{id:prefix+frame['id']}:{ }),...(typeof frame['targetId']==='string'?{targetId:prefix+frame['targetId']}:{ })});};
    this.interactions=new Interactions(child,emit);
    child.on('frame',(frame:Record<string,unknown>)=>{if(this.child!==child||frame['type']!=='extension_ui_request')return;try{if(frame['secret']===true)throw new Error('This provider requires secret input in the OMP terminal');this.interactions?.accept(frame);}catch(error){void this.finish(child,'failed',error instanceof Error?error.message:'Invalid login interaction');}});
    child.on('exit',({expected}:{expected:boolean})=>{if(!expected)void this.finish(child,'failed','OMP login process disconnected');});
    try {
      await child.start();
      const reply=await child.request('get_login_providers');const data=isObject(reply['data'])?reply['data']:{};
      if(!Array.isArray(data['providers'])||!data['providers'].some(p=>isObject(p)&&p['id']===providerId&&p['available']===true))throw new Error('Login provider is unavailable');
      if(this.child!==child)throw new Error('Login cancelled');
      this.emit({type:'login_status',state:'pending',providerId});
      void child.request('login',{providerId}).then(()=>this.finish(child,'completed'),error=>this.finish(child,'failed',error instanceof Error?error.message:'Login failed'));
      return {started:true};
    }catch(error){await this.finish(child,'failed',error instanceof Error?error.message:'Login failed');throw error;}
  }
  owns(id:unknown):boolean{return typeof id==='string'&&id.startsWith(this.prefix)&&!!this.child;}
  async respond(id:unknown,answer:unknown):Promise<{answered:true}> {
    if(!this.owns(id)||!this.interactions)throw new Error('Login interaction expired');
    if(isObject(answer)&&answer['cancelled']===true){await this.cancel();return {answered:true};}
    return this.interactions.respond(String(id).slice(this.prefix.length),answer);
  }
  async cancel():Promise<{cancelled:true}>{const child=this.child;if(child)await this.finish(child,'cancelled');return {cancelled:true};}
  private async finish(child:OmpProcess,state:string,message?:string):Promise<void>{if(this.child!==child)return;this.child=undefined;this.interactions?.clear();this.interactions=undefined;await child.stop();this.emit({type:'login_status',state,...(message?{message}:{})});}
}
