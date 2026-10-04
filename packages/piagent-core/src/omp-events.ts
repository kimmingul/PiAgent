import {isObject} from '@piagent/protocol';
const obj=(value:unknown):Record<string,unknown>=>isObject(value)?value:{};
const text=(value:unknown):string=>typeof value==='string'?value.slice(0,32768):'';
const content=(value:unknown):string=>Array.isArray(value)?value.filter(isObject).filter(part=>part['type']==='text').map(part=>text(part['text'])).join('\n').slice(0,32768):text(value);
/** Bounded projection into the RADAgent renderer contract, never raw RPC passthrough. */
export function uiEvent(frame:Record<string,unknown>):Record<string,unknown>|undefined {
  const type=frame['type'],stream=obj(frame['assistantMessageEvent']);
  if(type==='message_update') {
    if(stream['type']==='thinking_delta')return {t:'thinkingDelta',text:text(stream['delta'])};
    if(stream['type']==='thinking_end')return {t:'thinkingEnd'};
    if(stream['type']==='text_end')return {t:'assistantEnd'};
  }
  if(type==='tool_execution_start')return {t:'toolStart',id:text(frame['toolCallId']),name:text(frame['toolName']),detail:text(obj(frame['args'])['path']??obj(frame['args'])['command']??frame['intent'])};
  if(type==='tool_execution_update')return {t:'toolUpdate',id:text(frame['toolCallId']),text:content(obj(frame['partialResult'])['content'])};
  if(type==='tool_execution_end')return {t:'toolEnd',id:text(frame['toolCallId']),ok:frame['isError']!==true,result:content(obj(frame['result'])['content'])};
  if(type==='queue_update')return {t:'queue',steering:Array.isArray(frame['steering'])?frame['steering'].slice(0,32).map(value=>text(value).slice(0,1024)):[],followUp:Array.isArray(frame['followUp'])?frame['followUp'].slice(0,32).map(value=>text(value).slice(0,1024)):[]};
  if(type==='auto_compaction_start')return {t:'notice',text:'대화 컨텍스트 압축 중…',level:'info'};
  if(type==='auto_retry_start')return {t:'notice',text:text(frame['errorMessage']),level:'retry'};
  if(type==='extension_error')return {t:'notice',text:text(frame['error']),level:'error'};
  if(type==='subagent_progress'||type==='subagent_lifecycle') {
    const payload=obj(frame['payload']),progress=obj(payload['progress']??payload);
    return {t:'subagent',id:text(progress['id']),agent:text(progress['agent']),description:text(progress['description']),status:text(progress['status']),intent:text(progress['lastIntent']),tools:typeof progress['toolCount']==='number'&&Number.isFinite(progress['toolCount'])?progress['toolCount']:0};
  }
  return;
}
