import {isObject} from '@piagent/protocol';
const obj=(value:unknown):Record<string,unknown>=>isObject(value)?value:{};
const text=(value:unknown):string=>typeof value==='string'?value.slice(0,32768):'';
const content=(value:unknown):string=>Array.isArray(value)?value.filter(isObject).filter(part=>part['type']==='text').map(part=>text(part['text'])).join('\n').slice(0,32768):text(value);
/** Bounded projection into the RADAgent renderer contract, never raw RPC passthrough. */
export function uiEvent(frame:Record<string,unknown>):Record<string,unknown>|undefined {
  const type=frame['type'],stream=obj(frame['assistantMessageEvent']);
  if(type==='available_commands_update')return {t:'commands',items:Array.isArray(frame['commands'])?frame['commands'].filter(isObject).slice(0,500).map(command=>({name:text(command['name']).slice(0,128),description:text(command['description']).slice(0,256)})):[]};
  if(type==='message_update') {
    if(stream['type']==='toolcall_delta'&&typeof stream['delta']==='string'){
      const partial=obj(stream['partial']),index=stream['contentIndex'];const part=Array.isArray(partial['content'])&&typeof index==='number'?obj(partial['content'][index]):{};
      if(typeof part['id']==='string')return {t:'toolInputDelta',id:text(part['id']),name:text(part['name']),text:text(stream['delta'])};
    }
    if(stream['type']==='thinking_delta')return {t:'thinkingDelta',text:text(stream['delta'])};
    if(stream['type']==='thinking_end')return {t:'thinkingEnd'};
    if(stream['type']==='text_end')return {t:'assistantEnd'};
  }
  if(type==='tool_execution_start')return {t:'toolStart',id:text(frame['toolCallId']),name:text(frame['toolName']),detail:text(obj(frame['args'])['path']??obj(frame['args'])['command']??frame['intent']),input:JSON.stringify(obj(frame['args'])).slice(0,32768)};
  if(type==='tool_execution_update')return {t:'toolUpdate',id:text(frame['toolCallId']),text:content(obj(frame['partialResult'])['content'])};
  if(type==='tool_execution_end')return {t:'toolEnd',id:text(frame['toolCallId']),ok:frame['isError']!==true,result:content(obj(frame['result'])['content'])};
  if(type==='queue_update')return {t:'queue',steering:Array.isArray(frame['steering'])?frame['steering'].slice(0,32).map(value=>text(value).slice(0,1024)):[],followUp:Array.isArray(frame['followUp'])?frame['followUp'].slice(0,32).map(value=>text(value).slice(0,1024)):[]};
  if(type==='auto_compaction_start')return {t:'notice',text:'대화 컨텍스트 압축 중…',level:'info'};
  if(type==='auto_compaction_end')return {t:'notice',text:frame['aborted']?'컨텍스트 압축 취소됨':frame['errorMessage']?'컨텍스트 압축에 실패했습니다. OMP의 작업 상태와 제공자 설정을 확인해 주세요.':'컨텍스트 압축 완료',level:frame['errorMessage']?'warning':'info'};
  if(type==='auto_retry_start')return {t:'notice',text:text(frame['errorMessage']),level:'retry'};
  if(type==='auto_retry_end')return {t:'notice',text:frame['success']?'재시도 완료':text(frame['finalError']??'재시도 종료'),level:'info'};
  if(type==='notice')return {t:'notice',text:text(frame['message']),level:['info','warning','error'].includes(String(frame['level']))?frame['level']:'info'};
  if(type==='message_start'&&obj(frame['message'])['role']==='assistant'){const message=obj(frame['message']);return {t:'model',model:[text(message['provider']),text(message['model'])].filter(Boolean).join('/')};}
  if(type==='model_changed'){const model=obj(frame['model']);return {t:'model',model:[text(model['provider']??frame['provider']),text(model['id']??frame['modelId'])].filter(Boolean).join('/')};}
  if(type==='todo_auto_clear')return {t:'todos',items:[]};
  if(type==='extension_error')return {t:'notice',text:text(frame['error']),level:'error'};
  if(type==='subagent_progress'||type==='subagent_lifecycle') {
    const payload=obj(frame['payload']),progress=obj(payload['progress']??payload);
    return {t:'subagent',id:text(progress['id']),agent:text(progress['agent']),description:text(progress['description']),status:text(progress['status']),intent:text(progress['lastIntent']),tools:typeof progress['toolCount']==='number'&&Number.isFinite(progress['toolCount'])?progress['toolCount']:0};
  }
  return;
}
