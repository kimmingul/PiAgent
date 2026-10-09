import {isObject} from '@piagent/protocol';
import type {OmpProcess} from '@piagent/omp';

/** Explain OMP's outer tool gate without changing its options or approval policy. */
export function designerApprovalContext(frame:Record<string,unknown>):Record<string,unknown> {
  if(!['select','confirm'].includes(String(frame['method']))||typeof frame['method']!=='string'||typeof frame['title']!=='string'||typeof frame['id']!=='string'||!frame['id']
    ||frame['message']!==undefined&&typeof frame['message']!=='string'
    ||frame['method']==='select'&&(!Array.isArray(frame['options'])||!frame['options'].every(option=>typeof option==='string')))return frame;
  const descriptions:Record<string,string>={
    ide_context:'IDE 문맥 조회 승인: 프로젝트 목록, 활성 구성/플랫폼, 열린 문서와 제한된 편집기 내용을 읽습니다. 파일을 변경하거나 빌드를 실행하지 않습니다.',
    ide_catalog:'IDE 기능 조회 승인: 현재 연결의 지원 기능과 차단 이유를 읽습니다. 파일이나 IDE 설정을 변경하지 않습니다.',
    ide_symbols:'심볼 조회 승인: 지원되는 언어의 정의, 참조 등 의미 정보를 읽습니다. 코드를 변경하거나 디버거 표현식을 실행하지 않습니다.',
    ide_diagnostics:'진단 조회 승인: IDE 또는 완료된 외부 빌드의 오류와 경고를 읽습니다. 새 빌드나 파일 변경을 실행하지 않으며 진단은 오래됐을 수 있습니다.',
    ide_designer_inspect:'폼 디자이너 조회 승인: 현재 프로젝트의 열린 폼과 컴포넌트 속성을 읽습니다. 폼을 변경하거나 저장하지 않습니다.',
    ide_designer_set_property:'폼 속성 변경 도구 실행 승인: 이어서 PiAgent가 대상 폼, 속성과 변경 전후 값을 확인합니다. IDE 변경은 선택한 승인 방식에 따라 별도로 처리됩니다.',
    ide_designer_set_reference:'컴포넌트 참조 연결 도구 실행 승인: 이어서 PiAgent가 대상과 연결 변경 내용을 확인합니다. IDE 변경은 선택한 승인 방식에 따라 별도로 처리됩니다.',
    ide_designer_reparent:'컴포넌트 배치 이동 도구 실행 승인: 이어서 PiAgent가 대상과 부모 변경 내용을 확인합니다. IDE 변경은 선택한 승인 방식에 따라 별도로 처리됩니다.'
  };
  const name=String(frame['title']??'').replace(/^Allow tool: /,'');
  if(frame['title']!==`Allow tool: ${name}`||!Object.hasOwn(descriptions,name))return frame;
  return {...frame,message:[descriptions[name],'이 요청은 OMP 도구 승인입니다. 거절·취소하면 도구가 실행되지 않으며 관리자 권한과는 관계가 없습니다.',typeof frame['message']==='string'?frame['message']:''].filter(Boolean).join('\n')};
}

/** Correlate only live requests from this OMP child. Never infer approval from button labels. */
export class Interactions {
  get waiting(): boolean { return this.pending.size > 0; }
  private pending=new Map<string,{frame:Record<string,unknown>}>();
  constructor(private readonly omp:OmpProcess,private readonly emit:(frame:Record<string,unknown>)=>void) {}
  accept(frame:Record<string,unknown>):void {
    if(Buffer.byteLength(JSON.stringify(frame))>256*1024)throw new Error('OMP interaction exceeds limit');
    frame=designerApprovalContext(frame);
    const method=frame['method'],id=frame['id'];
    if(method==='cancel') {
      const pending=this.pending.has(String(frame['targetId']));this.remove(String(frame['targetId']));this.emit(frame);
      if(pending)this.emit({type:'extension_ui_request',method:'notify',message:'OMP가 질문 또는 승인 요청을 종료했습니다. 시간 만료 또는 취소일 수 있습니다. 작업 종료 여부는 OMP의 최종 상태로 확인합니다.'});
      return;
    }
    if(!['select','confirm','input','editor'].includes(String(method))) {
      if(['notify','setStatus','setTitle','setWidget','set_editor_text','open_url'].includes(String(method))){this.emit(frame);return;}
      if(typeof id==='string')void this.omp.uiResponse(id,{cancelled:true}).catch(()=>{});
      this.emit({type:'extension_ui_request',method:'notify',message:'Unsupported OMP interaction was cancelled: '+String(method)});return;
    }
    if(typeof id!=='string'||!id||id.length>256||this.pending.has(id)||this.pending.size>=16)throw new Error('Invalid OMP interaction');
    if(method==='select'&&(!Array.isArray(frame['options'])||frame['options'].length>1024||!frame['options'].every(option=>typeof option==='string')))throw new Error('Invalid OMP select options');
    if(Buffer.byteLength(JSON.stringify(frame))>256*1024)throw new Error('OMP interaction exceeds limit');
    // OMP owns dialog deadlines and sends `cancel` on expiry/abort. A second host
    // timer incorrectly turns a timeout into user cancellation and aborts ask.
    // Keep bounded pending requests until an answer, OMP cancel or connection close.
    this.pending.set(id,{frame});this.emit(frame);
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
  private remove(id:string):void {this.pending.delete(id);}
  clear():void {for(const id of this.pending.keys())this.remove(id);}
}
