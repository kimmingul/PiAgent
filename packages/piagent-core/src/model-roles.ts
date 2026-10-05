import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'yaml';
import {isObject} from '@piagent/protocol';
import type {OmpOptions} from '@piagent/omp';
import {projectConfig,writeProjectRoles} from './project-config.js';
const execute=promisify(execFile);
// Verified against OMP v18.6.1 config/model-roles.ts; custom roles come from OMP settings.
const kinds:Record<string,string[]>={default:['chat'],smol:['chat'],slow:['chat'],vision:['chat'],plan:['chat'],commit:['chat'],tiny:['chat','tiny'],memory:['chat','tiny'],task:['chat'],advisor:['chat'],image:['image'],web:['search'],speech:['tts'],dictation:['stt'],judge:['judge','tiny','chat']};
const strings=(value:unknown):Record<string,string>=>isObject(value)?Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==='string')):{};
export async function modelRoles(options:OmpOptions,fields:Record<string,unknown>={}):Promise<Record<string,unknown>>{
  const run=async(args:string[]):Promise<string>=>{const result=await execute(options.executable,[...(options.executableArgs??[]),...args],{cwd:options.cwd,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});return result.stdout;};
  const get=async(key:string):Promise<unknown>=>{const result:unknown=JSON.parse(await run(['config','get',key,'--json']));return isObject(result)?result['value']:undefined;};
  const [effective,tags,cycle,presets,directory,catalogue]=await Promise.all([get('modelRoles'),get('modelTags'),get('cycleOrder'),get('modelPresets'),run(['config','path']),run(['models','--json','--kind','all'])]);
  const root=directory.trim();if(!isAbsolute(root))throw new Error('OMP returned invalid config directory');
  let configText='';try{configText=await readFile(join(root,'config.yml'),'utf8');}catch(error){if(!isObject(error)||error['code']!=='ENOENT')throw new Error('Cannot read OMP global config');try{configText=await readFile(join(root,'config.yaml'),'utf8');}catch(fallback){if(!isObject(fallback)||fallback['code']!=='ENOENT')throw new Error('Cannot read OMP global config');}}
  const config:unknown=parse(configText),global=strings(isObject(config)?config['modelRoles']:undefined),ownedPresets=isObject(config)&&isObject(config['modelPresets'])?config['modelPresets']:{};
  const project=await projectConfig(options.cwd);const scope=fields['scope']??'global';if(!['global','project'].includes(String(scope)))throw new Error('Invalid model settings scope');
  const assignments=strings(effective);const metadata=isObject(tags)?tags:{};
  const ids=[...new Set([...Object.keys(kinds),...Object.keys(assignments),...Object.keys(metadata),...(Array.isArray(cycle)?cycle.filter((v):v is string=>typeof v==='string'):[])])].filter(id=>/^[a-zA-Z0-9_-]{1,80}$/.test(id));
  const raw:unknown=JSON.parse(catalogue);const models=(isObject(raw)&&Array.isArray(raw['models'])?raw['models']:[]).filter(isObject).map(model=>({selector:String(model['selector']??`${model['provider']}/${model['id']}`),name:String(model['name']??model['id']),kind:String(model['kind']??'chat'),efforts:Array.isArray(model['thinking'])?model['thinking'].filter((v):v is string=>typeof v==='string'):[]}));
  const revision=createHash('sha256').update(JSON.stringify({global,assignments,configText,project:project.text})).digest('hex');
  if(Object.keys(fields).some(key=>!['revision','changes','scope','op','name'].includes(key)))throw new Error('Invalid model role fields');
  const validate=(values:Record<string,unknown>):Record<string,string>=>{const result:Record<string,string>={};for(const [role,value]of Object.entries(values)){if(!ids.includes(role)||typeof value!=='string'||value.length>512)throw new Error('Invalid model role assignment');if(!value)continue;const alias=value.startsWith('@')?value.slice(1):'';if(!models.some(model=>(kinds[role]??['chat']).includes(model.kind)&&(value===model.selector||model.efforts.some(effort=>value===`${model.selector}:${effort}`)))&&(!ids.includes(alias)||alias===role))throw new Error('Model or effort is not supported for this role');result[role]=value;}return result;};
  if(fields['op']!==undefined){
    if(!['preset_save','preset_apply','preset_delete'].includes(String(fields['op']))||typeof fields['name']!=='string'||! /^[a-zA-Z][\w-]{0,79}$/.test(fields['name']))throw new Error('Invalid preset operation');
    if(fields['revision']!==revision||'changes'in fields)throw new Error('OMP role settings changed; reload before saving');const name=fields['name'];
    if(fields['op']==='preset_save'){const thinking=await get('defaultThinkingLevel');const next={...ownedPresets,[name]:{modelRoles:validate(assignments),...(typeof thinking==='string'?{defaultThinkingLevel:thinking}:{})}};await run(['config','set','modelPresets',JSON.stringify(next),'--json']);}
    else if(fields['op']==='preset_delete'){if(!Object.hasOwn(ownedPresets,name))throw new Error('Only global presets can be deleted here');const next={...ownedPresets};delete next[name];await run(['config','set','modelPresets',JSON.stringify(next),'--json']);}
    else{const preset=isObject(presets)?presets[name]:undefined;if(!isObject(preset)||!isObject(preset['modelRoles']))throw new Error('Unknown model preset');const next=validate(preset['modelRoles']);
      for(const role of Object.keys(next)){let at=role;const seen=new Set<string>();while(next[at]?.startsWith('@')){if(seen.has(at))throw new Error('Model role alias cycle');seen.add(at);at=next[at]!.slice(1);}}
      if(preset['defaultThinkingLevel']!==undefined&&(!['auto','off','minimal','low','medium','high','xhigh','max'].includes(String(preset['defaultThinkingLevel']))))throw new Error('Unsupported preset thinking level');
      // Applying a preset replaces roles owned by the selected scope, as OMP does.
      if(scope==='project')await writeProjectRoles(options.cwd,project.text,next);else await run(['config','set','modelRoles',JSON.stringify(next),'--json']);
      if(preset['defaultThinkingLevel']!==undefined)await run(['config','set','defaultThinkingLevel',String(preset['defaultThinkingLevel']),'--json']);
    }
    return {...await modelRoles(options,{scope}),saved:true,message:'프리셋을 처리했습니다. 기존 대화의 runtime 모델은 유지되며 새 대화에서 확인하세요.'};
  }
  if('changes' in fields){
    if(fields['revision']!==revision||!isObject(fields['changes']))throw new Error('OMP role settings changed; reload before saving');
    const next={...(scope==='project'?project.roles:global)};
    for(const [role,value]of Object.entries(fields['changes'])){
      if(!ids.includes(role)||typeof value!=='string'||value.length>512)throw new Error('Invalid model role assignment');
      if(value===''){delete next[role];continue;}
      const eligible=models.filter(model=>(kinds[role]??['chat']).includes(model.kind));
      const supported=eligible.some(model=>value===model.selector||model.efforts.some(effort=>value===`${model.selector}:${effort}`));
      const alias=value.startsWith('@')?value.slice(1):'';
      if(!supported&&(!ids.includes(alias)||alias===role))throw new Error('Model or effort is not supported for this role');
      next[role]=value;
    }
    // Detect alias cycles across global and project-effective role assignments.
    const combined={...assignments,...next};for(const role of ids){const seen=new Set<string>();let at=role;while(combined[at]?.startsWith('@')){if(seen.has(at))throw new Error('Model role alias cycle');seen.add(at);at=combined[at]!.slice(1);}}
    if(scope==='project')await writeProjectRoles(options.cwd,project.text,next);else await run(['config','set','modelRoles',JSON.stringify(next),'--json']);
    return {...await modelRoles(options,{scope}),saved:true,message:`OMP ${scope==='project'?'프로젝트':'전역'} 역할 설정을 저장했습니다. 새 대화에서 적용을 확인하세요. 환경변수와 runtime 설정이 우선할 수 있습니다.`};
  }
  return {revision,storageScope:scope,roles:ids.map(id=>({id,name:isObject(metadata[id])?String(metadata[id]['name']??id):id,kinds:kinds[id]??['chat'],value:assignments[id]??'',globalValue:global[id]??'',projectValue:project.roles[id]??''})),models,presets:isObject(presets)?Object.fromEntries(Object.entries(presets).filter(([,value])=>isObject(value)).map(([name,value])=>[name,{modelRoles:strings((value as Record<string,unknown>)['modelRoles']),global:Object.hasOwn(ownedPresets,name)}])):{},scope:`OMP ${scope==='project'?'프로젝트 (.omp/config.yml)':'전역'} 설정 · 표시값은 유효 설정 (프로젝트·환경변수 우선)`};
}
