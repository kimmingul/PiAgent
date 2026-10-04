import type {OmpProcess} from '@piagent/omp';
import {isObject} from '@piagent/protocol';

export const OMP_CONTROL_CAPABILITY='omp.controls.v1';
/** Explicit commands, bounded fields; callers cannot replace session paths or tool registrations. */
export async function control(omp:OmpProcess, command:unknown, fields:unknown, busy:boolean):Promise<Record<string,unknown>> {
  if(typeof command!=='string'||!isObject(fields))throw new Error('Invalid OMP control');
  const shape:Record<string,readonly string[]>={
    get_state:[],get_available_models:[],get_available_thinking_levels:[],get_available_commands:[],
    set_model:['provider','modelId'],set_thinking_level:['level'],
    get_subagents:[],cancel_subagent:['subagentId'],steer_subagent:['subagentId','message'],
    get_subagent_messages:['subagentId','fromByte'],abort_retry:[],
    remove_queued_message:['message','queue'],promote_queued_message:['message'],
    set_fast_mode:['enabled'],set_auto_compaction:['enabled'],set_auto_retry:['enabled'],
    set_cache_warming:['mode'],set_session_name:['name'],get_login_providers:[],
  };
  const allowed=shape[command];
  if(!allowed||Object.keys(fields).some(key=>!allowed.includes(key)))throw new Error('OMP control unavailable');
  if(busy&&['set_model','set_thinking_level','set_session_name','set_cache_warming'].includes(command))throw new Error('Wait until the turn finishes');
  for(const key of allowed) {
    const value=fields[key];
    if(key==='fromByte'){if(value!==undefined&&(!Number.isSafeInteger(value)||Number(value)<0))throw new Error('Invalid cursor');continue;}
    if(key==='enabled'){if(typeof value!=='boolean')throw new Error('Expected boolean');continue;}
    if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)> (key==='message'?65536:256))throw new Error('Invalid control field');
  }
  if(command==='set_thinking_level'&&!['off','minimal','low','medium','high','xhigh','max','ultra'].includes(String(fields['level'])))throw new Error('Invalid thinking level');
  if(command==='remove_queued_message'&&!['steering','followUp'].includes(String(fields['queue'])))throw new Error('Invalid queue');
  if(command==='set_cache_warming'&&!['off','streaming','idle'].includes(String(fields['mode'])))throw new Error('Invalid cache warming mode');
  const response=await omp.request(command,fields);
  if(command==='get_available_models') {
    const data=isObject(response['data'])?response['data']:{};
    return {models:(Array.isArray(data['models'])?data['models']:[]).filter(isObject).slice(0,500).map(model=>({provider:String(model['provider']).slice(0,128),id:String(model['id']).slice(0,256),name:String(model['name']??model['id']).slice(0,256)}))};
  }
  // Raw get_state includes private session paths/system prompt. Return UI state only.
  if(command==='get_state') {
    const state=isObject(response['data'])?response['data']:{};
    const result=Object.fromEntries(['model','thinkingLevel','isStreaming','isCompacting','contextUsage','queuedMessages','sessionName','fastModeEnabled','autoCompactionEnabled','todoPhases','goal'].filter(key=>key in state).map(key=>[key,state[key]]));
    const model=isObject(state['model'])?state['model']:undefined;
    if(model)result['model']=Object.fromEntries(['provider','id','name'].map(key=>[key,String(model[key]??'').slice(0,256)]));
    if(Buffer.byteLength(JSON.stringify(result))>512*1024)throw new Error('OMP state exceeds adapter limit');
    return result;
  }
  const result=isObject(response['data'])?response['data']:{value:response['data']??null};
  if(Buffer.byteLength(JSON.stringify(result))>512*1024)throw new Error('OMP control result exceeds adapter limit');
  return result;
}
