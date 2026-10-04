import {isObject} from '@piagent/protocol';
import type {OmpProcess} from '@piagent/omp';

/** Correlate only live requests from this OMP child. Never infer approval from button labels. */
export class Interactions {
  private pending=new Map<string,{frame:Record<string,unknown>;timer:NodeJS.Timeout}>();
  constructor(private readonly omp:OmpProcess,private readonly emit:(frame:Record<string,unknown>)=>void) {}
  accept(frame:Record<string,unknown>):void {
    if(Buffer.byteLength(JSON.stringify(frame))>256*1024)throw new Error('OMP interaction exceeds limit');
    const method=frame['method'],id=frame['id'];
    if(method==='cancel') {this.remove(String(frame['targetId']));this.emit(frame);return;}
    if(!['select','confirm','input','editor'].includes(String(method))) {this.emit(frame);return;}
    if(typeof id!=='string'||!id||id.length>256||this.pending.has(id)||this.pending.size>=16)throw new Error('Invalid OMP interaction');
    if(method==='select'&&(!Array.isArray(frame['options'])||frame['options'].length>1024||!frame['options'].every(option=>typeof option==='string')))throw new Error('Invalid OMP select options');
    if(Buffer.byteLength(JSON.stringify(frame))>256*1024)throw new Error('OMP interaction exceeds limit');
    const timeout=typeof frame['timeout']==='number'&&Number.isFinite(frame['timeout'])?Math.max(1,Math.min(frame['timeout'],300000)):300000;
    const timer=setTimeout(()=>{this.remove(id);void this.omp.uiResponse(id,{cancelled:true}).catch(()=>{});this.emit({type:'extension_ui_request',method:'cancel',targetId:id});},timeout);
    this.pending.set(id,{frame,timer});this.emit(frame);
  }
  async respond(id:unknown,value:unknown):Promise<{answered:true}> {
    if(typeof id!=='string'||!isObject(value))throw new Error('Invalid OMP answer');
    const pending=this.pending.get(id);if(!pending)throw new Error('OMP interaction expired or already answered');
    if(Object.keys(value).some(key=>!['value','confirmed','cancelled'].includes(key)))throw new Error('Invalid OMP answer fields');
    let response:{value?:string;confirmed?:boolean;cancelled?:true};
    if(value['cancelled']===true)response={cancelled:true};
    else if(pending.frame['method']==='confirm'&&typeof value['confirmed']==='boolean')response={confirmed:value['confirmed']};
    else if(pending.frame['method']!=='confirm'&&typeof value['value']==='string'&&Buffer.byteLength(value['value'])<=65536) {
      if(pending.frame['method']==='select'&&(!Array.isArray(pending.frame['options'])||!pending.frame['options'].includes(value['value'])))throw new Error('Unknown OMP option');
      response={value:value['value']};
    } else throw new Error('Invalid OMP answer');
    this.remove(id);await this.omp.uiResponse(id,response);return {answered:true};
  }
  private remove(id:string):void {const pending=this.pending.get(id);if(pending)clearTimeout(pending.timer);this.pending.delete(id);}
  clear():void {for(const id of this.pending.keys())this.remove(id);}
}
