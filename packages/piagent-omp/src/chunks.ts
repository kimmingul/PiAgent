import {TextDecoder} from 'node:util';
import {isObject} from '@piagent/protocol';

/** OMP v2 stdout only. A sequence is contiguous and bounded before allocating its payload. */
export class ChunkDecoder {
  private run: {id:string; count:number; next:number; length:number; size:number; parts:Buffer[]} | undefined;
  constructor(private readonly limit = 64 * 1024 * 1024) {}
  accept(frame: Record<string, unknown>): Record<string, unknown> | undefined {
    if (frame['type'] !== 'rpc_chunk') {
      if (this.run) throw new Error('Interrupted OMP chunk sequence');
      return frame;
    }
    const id=frame['chunkId'], index=frame['index'], count=frame['count'], length=frame['byteLength'], data=frame['data'];
    if (typeof id!=='string'||!id||id.length>256||!Number.isSafeInteger(index)||!Number.isSafeInteger(count)
      ||!Number.isSafeInteger(length)||typeof index!=='number'||typeof count!=='number'||typeof length!=='number'
      ||count<1||count>65536||index<0||index>=count||length<1||length>this.limit||typeof data!=='string'
      ||!data||data.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
      throw new Error('Invalid OMP chunk envelope');
    if (!this.run) {
      if (index!==0) throw new Error('OMP chunk sequence starts out of order');
      this.run={id,count,next:0,length,size:0,parts:[]};
    }
    const run=this.run;
    if(run.id!==id||run.count!==count||run.next!==index||run.length!==length)throw new Error('Interleaved or out-of-order OMP chunks');
    const part=Buffer.from(data,'base64');
    if(part.toString('base64')!==data||run.size+part.length>length)throw new Error('Invalid OMP chunk data/length');
    run.parts.push(part);run.size+=part.length;run.next++;
    if(run.next<count)return;
    this.run=undefined;
    if(run.size!==length)throw new Error('Truncated OMP chunk payload');
    const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(run.parts,run.size)));
    if(!isObject(result)||typeof result['type']!=='string'||result['type']==='rpc_chunk')throw new Error('Invalid reassembled OMP frame');
    return result;
  }
  end():void {if(this.run)throw new Error('Incomplete OMP chunk sequence');}
}
