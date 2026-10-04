import {randomUUID,createHash} from 'node:crypto';
import {mkdir,lstat,realpath,readFile,writeFile,rename,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {isObject} from '@piagent/protocol';
import {SessionLease,type TranscriptLine} from './sessions.js';
import {WorkspaceChanges,proposalView,type TurnSnapshot,type Proposal} from './changes.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=(value:Buffer|string):string=>createHash('sha256').update(value).digest('hex');
interface File {path:string;data:string;hash:string;}
interface Point {version:1;id:string;seq:number;prompt:string;created:number;transcript:TranscriptLine[];files:File[];fileScope:string;contextHash:string;}
export interface TimelinePreview {id:string;seq:number;branch:boolean;revision:string;expires:number;point:Point;proposal?:Proposal;current:TurnSnapshot|undefined;}
/** Message checkpoints are private conversation snapshots, not Git reset/checkouts. */
export class Timeline {
  private readonly root:string;
  constructor(private readonly lease:SessionLease,private readonly changes?:WorkspaceChanges){this.root=join(lease.store.ompDirectory(lease.record.savedSessionId),'timeline');}
  private async directory():Promise<void>{await mkdir(this.root,{recursive:true});const stat=await lstat(this.root);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(this.root)!==this.root)throw new Error('Invalid timeline directory');}
  private file(id:string,suffix:string):string{if(!uuid.test(id))throw new Error('Invalid message checkpoint');return join(this.root,id+suffix);}
  private async regular(path:string,max:number):Promise<Buffer>{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>max||await realpath(path)!==path)throw new Error('Invalid timeline file');return readFile(path);}
  async capture(prompt:string,current?:TurnSnapshot):Promise<number>{
    await this.directory();const points=this.lease.record.messagePoints??=[];
    if(points.length>=50)throw new Error('Message checkpoint limit reached (50). Start a new conversation');
    if(!this.lease.record.ompFile)throw new Error('OMP context unavailable');
    const source=await this.lease.store.verifyOmpFile(this.lease.record.savedSessionId,this.lease.record.ompFile),bytes=await this.regular(source,64*1024*1024);
    const id=randomUUID(),seq=(points.at(-1)?.seq??0)+1;
    const files=(current?.files??[]).map(file=>({path:file.path,data:file.bytes.toString('base64'),hash:hash(file.bytes)}));
    const point:Point={version:1,id,seq,prompt,created:Date.now(),transcript:structuredClone(this.lease.record.transcript),files,fileScope:current?'Existing Git-tracked UTF-8 files only; excludes new/deleted/binary/untracked files and IDE unsaved buffers':'Conversation only; no supported Git file snapshot',contextHash:hash(bytes)};
    await writeFile(this.file(id,'.jsonl'),bytes,{flag:'wx',mode:0o600});
    await writeFile(this.file(id,'.json'),JSON.stringify(point),{flag:'wx',mode:0o600});
    points.push({seq,id});return seq;
  }
  async settled(current?:TurnSnapshot):Promise<void>{await this.directory();const temp=join(this.root,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify({files:(current?.files??[]).map(file=>({path:file.path,hash:hash(file.bytes)}))}),{flag:'wx',mode:0o600});await rename(temp,join(this.root,'latest.json'));}
  async load(seq:unknown):Promise<Point>{
    if(!Number.isSafeInteger(seq)||Number(seq)<1)throw new Error('Invalid message sequence');
    const ref=this.lease.record.messagePoints?.find(point=>point.seq===seq);if(!ref)throw new Error('Message checkpoint not found in this conversation');
    const value:unknown=JSON.parse((await this.regular(this.file(ref.id,'.json'),16*1024*1024)).toString('utf8'));
    if(!isObject(value)||value['version']!==1||value['id']!==ref.id||value['seq']!==seq||typeof value['prompt']!=='string'||typeof value['contextHash']!=='string'||!Array.isArray(value['transcript'])||value['transcript'].length>200||!Array.isArray(value['files'])||value['files'].length>500)throw new Error('Invalid message checkpoint');
    if(value['prompt'].length>2000000||!Number.isFinite(value['created'])||typeof value['fileScope']!=='string'||value['fileScope'].length>500||!/^[0-9a-f]{64}$/.test(value['contextHash'])||value['transcript'].some(line=>!isObject(line)||!['user','assistant','status','event'].includes(String(line['role']))||typeof line['text']!=='string'||line['text'].length>2000000))throw new Error('Invalid checkpoint metadata');
    const point=value as unknown as Point;
    for(const file of point.files){if(!isObject(file)||typeof file.path!=='string'||typeof file.data!=='string'||typeof file.hash!=='string'||file.data.length>44000||hash(Buffer.from(file.data,'base64'))!==file.hash)throw new Error('Invalid checkpoint file snapshot');}
    if(hash(await this.regular(this.file(ref.id,'.jsonl'),64*1024*1024))!==point.contextHash)throw new Error('Conversation snapshot changed');
    return point;
  }
  async preview(seq:unknown,branch:unknown):Promise<TimelinePreview>{
    if(typeof branch!=='boolean')throw new Error('Expected branch boolean');const point=await this.load(seq);
    const current=this.changes?await this.changes.beginTurn():undefined;
    const latest:unknown=JSON.parse((await this.regular(join(this.root,'latest.json'),1024*1024)).toString('utf8'));
    if(!isObject(latest)||!Array.isArray(latest['files']))throw new Error('Message baseline is unavailable');
    const baseline=new Map(latest['files'].filter(isObject).map(file=>[String(file['path']),String(file['hash'])]));
    // All captured files are checked, including ones that would otherwise need no restore.
    for(const file of current?.files??[])if(baseline.get(file.path)!==hash(file.bytes))throw new Error('Files changed after the last response. Preserve/review manual edits before message restore');
    const now=new Map((current?.files??[]).map(file=>[file.path,file.bytes]));
    for(const path of baseline.keys())if(!now.has(path))throw new Error('A baseline file is missing or outside the supported restore scope');
    const edits: {path:string;content:string}[]=[];
    for(const file of point.files){const bytes=now.get(file.path);if(!bytes)throw new Error('A captured file is missing or outside the supported restore scope');if(hash(bytes)!==file.hash)edits.push({path:file.path,content:new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(file.data,'base64'))});}
    const proposal=edits.length?await this.changes!.proposeMany({files:edits,reason:'Restore supported files and conversation to before message '+point.seq},new AbortController().signal):undefined;
    const id=randomUUID(),revision=hash(JSON.stringify([id,point.id,point.contextHash,proposal?.revision,branch]));
    return {id,seq:point.seq,branch,revision,expires:Date.now()+300000,point,current,...(proposal?{proposal}: {})};
  }
  view(preview:TimelinePreview):Record<string,unknown>{const files=preview.proposal?proposalView(preview.proposal):{files:[],diff:''};return {...files,checkedPaths:(preview.current?.files??[]).map(file=>file.path),messageRestoreId:preview.id,seq:preview.seq,branch:preview.branch,revision:preview.revision,prompt:preview.point.prompt,scope:preview.point.fileScope,reason:'Restore conversation to before this message. Preserve original conversation. '+preview.point.fileScope};}
  async clone(preview:TimelinePreview):Promise<string>{
    const point=await this.load(preview.seq);if(point.id!==preview.point.id||point.contextHash!==preview.point.contextHash)throw new Error('Checkpoint changed after preview');
    const target=await this.lease.store.acquire();try{
      target.record.transcript=structuredClone(point.transcript);target.record.title=this.lease.record.title+(preview.branch?' · branch':' · restored');if(this.lease.record.approvalMode)target.record.approvalMode=this.lease.record.approvalMode;
      target.record.needsFork=true;
      target.record.parent={savedSessionId:this.lease.record.savedSessionId,message:point.seq,mode:preview.branch?'branch':'restore'};
      const dir=await target.store.prepareOmpDirectory(target.record.savedSessionId),context=join(dir,randomUUID()+'.jsonl');
      await copyFile(this.file(point.id,'.jsonl'),context);if(dirname(context)!==dir||hash(await this.regular(context,64*1024*1024))!==point.contextHash)throw new Error('Cloned conversation mismatch');
      const timelineDir=join(dir,'timeline');await mkdir(timelineDir);for(const ref of this.lease.record.messagePoints??[]){if(ref.seq>=point.seq)continue;await this.load(ref.seq);await copyFile(this.file(ref.id,'.json'),join(timelineDir,ref.id+'.json'));await copyFile(this.file(ref.id,'.jsonl'),join(timelineDir,ref.id+'.jsonl'));(target.record.messagePoints??=[]).push({...ref});}
      await target.store.bind(target.record,context);await target.save();return target.record.savedSessionId;
    }finally{await target.release();}
  }
}
