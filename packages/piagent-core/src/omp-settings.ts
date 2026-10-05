import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {isObject} from '@piagent/protocol';
import type {OmpOptions} from '@piagent/omp';
const execute=promisify(execFile);
// No provider credentials or transport/workspace permission policies in this editor.
const keys=['advisor.enabled','advisor.evictStaleResults','prewalk.enabled','task.prewalk','memories.enabled','autolearn.enabled','autolearn.autoContinue','mnemopi.autoRecall','mnemopi.autoRetain','retry.enabled','retry.modelFallback','retry.waitForUsageReset','goal.enabled','goal.statusInFooter'] as const;
export async function ompSettings(options:OmpOptions,fields:Record<string,unknown>):Promise<Record<string,unknown>> {
 if(Object.keys(fields).some(key=>!['key','value','revision'].includes(key)))throw new Error('Invalid OMP settings fields');
 const run=async(args:string[]):Promise<unknown>=>{try{const result=await execute(options.executable,[...(options.executableArgs??[]),...args],{cwd:options.cwd,windowsHide:true,timeout:15000,maxBuffer:4*1024*1024});return JSON.parse(result.stdout);}catch{throw new Error('OMP settings command failed; refresh and check the installed OMP version');}};
 const data=await run(['config','list','--json']);if(!isObject(data))throw new Error('Invalid OMP settings catalogue');
 const settings=keys.filter(key=>isObject(data[key])&&data[key]['type']==='boolean'&&typeof data[key]['value']==='boolean').map(key=>({key,value:(data[key] as Record<string,unknown>)['value'],description:String((data[key] as Record<string,unknown>)['description']??'').slice(0,4096)}));
 const revision=createHash('sha256').update(JSON.stringify(settings)).digest('hex');
 if('key'in fields){if(fields['revision']!==revision)throw new Error('OMP settings changed; refresh before saving');if(typeof fields['key']!=='string'||!settings.some(item=>item.key===fields['key'])||typeof fields['value']!=='boolean')throw new Error('Unsupported OMP setting');
   const saved=await run(['config','set',fields['key'],String(fields['value']),'--json']);return {...await ompSettings(options,{}),saved:true,message:`전역 설정 저장 완료. ${isObject(saved)&&saved['overriddenBy']?'다른 설정 계층이 우선합니다. ':''}시작 시에만 적용되는 기능은 새 대화에서 확인하세요.`};
 }
 if('value'in fields||'revision'in fields)throw new Error('Setting key is required');return {revision,settings,scope:'OMP 전역 설정 · 프로젝트·환경변수·runtime 우선. Memory backend와 advisor 역할 모델은 OMP 설정과 모델 역할에서 지정하세요.'};
}
