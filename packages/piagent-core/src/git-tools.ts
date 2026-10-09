import {isObject} from '@piagent/protocol';
import {GitWorkflow} from './git-workflow.js';
import {IdeBridge} from './ide-tools.js';
export const WORKSPACE_GIT_CAPABILITY='workspace.git.v1';
export const workspaceGitTool={name:'workspace_git',description:'Inspect local Git status/diff/history/branches, or preview explicit staging/commit. Apply requires immutable preview and explicit consent: staging changes the index, committing runs local Git hooks/configuration. No push, checkout, reset or remote action.',parameters:{type:'object',properties:{operation:{enum:['status','diff','log','branches','preview-stage','preview-commit','apply']},staged:{type:'boolean'},files:{type:'array',minItems:1,maxItems:64,items:{type:'string'}},message:{type:'string',maxLength:4096},previewId:{type:'string'},revision:{type:'string'}},required:['operation'],additionalProperties:false}};
/** Existing consent broker renders immutable service previews; model arguments never define the review. */
export class GitTools {
  writesEnabled=false;
  private workflow:GitWorkflow;
  constructor(root:string,private readonly consent:IdeBridge){this.workflow=new GitWorkflow(root);}
  close():void{this.workflow.close();}
  async execute(args:unknown,signal:AbortSignal):Promise<unknown>{
    if(!isObject(args)||Object.keys(args).some(k=>!['operation','staged','files','message','previewId','revision'].includes(k))||!workspaceGitTool.parameters.properties.operation.enum.includes(String(args['operation']))||args['staged']!==undefined&&typeof args['staged']!=='boolean')throw new Error('Invalid Git tool arguments');
    const operation=String(args['operation']);
    if(operation!=='apply')return this.bounded(await this.workflow.execute(args,signal));
    if(!this.writesEnabled)throw new Error('Git index/commit writes are disabled in plan/read-only mode');
    const review=this.workflow.review(args['previewId']);if(review.revision!==args['revision'])throw new Error('Git preview revision changed');
    const diff=(review.message?`Commit message:\n${review.message}\n\n`:'')+review.diff;
    const reason=review.operation==='stage'?'Stage explicitly reviewed files; this changes the Git index':'Commit reviewed staged changes; local Git hooks and signing configuration execute';
    if(!await this.consent.confirm({path:review.files.join(', '),reason,diff,expiresAt:review.expiresAt},signal)||signal.aborted)return {executed:false,cancellation:'before_execution',reason:'Declined, expired or cancelled'};
    return this.bounded(await this.workflow.apply(args,signal));
  }
  private bounded(value:unknown):unknown{
    if(!isObject(value))throw new Error('Invalid Git result');
    const result={...value},truncatedFields:string[]=[];
    for(const [key,item] of Object.entries(result))if(typeof item==='string'&&Buffer.byteLength(item)>131072){
      const bytes=Buffer.from(item);let end=131072;while(end>0&&(bytes[end]!&0xc0)===0x80)end--;result[key]=bytes.subarray(0,end).toString('utf8');truncatedFields.push(key);
    }
    return truncatedFields.length?{...result,truncated:true,truncatedFields}:result;
  }
}
