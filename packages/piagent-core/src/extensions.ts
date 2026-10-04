import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {isObject} from '@piagent/protocol';
import type {OmpOptions} from '@piagent/omp';
const execute=promisify(execFile);
/** Metadata only: never expose MCP commands, environments, tokens or plugin configuration. */
export async function extensions(options:OmpOptions,params:Record<string,unknown>):Promise<Record<string,unknown>> {
  const action=params['action'];
  if(!['listExtensions','manageExtensions','togglePlugin','toggleMcpServer'].includes(String(action)))throw new Error('Unknown extension action');
  const run=async(args:string[])=>execute(options.executable,[...(options.executableArgs??[]),...args],{cwd:options.cwd,windowsHide:true,timeout:20000,maxBuffer:512*1024});
  const projectFile=join(options.cwd,'.omp','mcp.json');
  const userFile=join(process.env['PI_CODING_AGENT_DIR']??join(homedir(),'.omp','agent'),'mcp.json');
  const sources=[userFile,join(options.cwd,'.mcp.json'),join(options.cwd,'mcp.json'),projectFile];
  let disabled:unknown[]=[];try{const user:unknown=JSON.parse(await readFile(userFile,'utf8'));if(isObject(user)&&Array.isArray(user['disabledServers']))disabled=user['disabledServers'];}catch{}
  const servers=new Map<string,Record<string,unknown>>();
  for(const source of sources) {
    let config:unknown;try{config=JSON.parse(await readFile(source,'utf8'));}catch(error){if(isObject(error)&&error['code']==='ENOENT')continue;throw new Error('Invalid MCP configuration');}
    if(isObject(config)&&isObject(config['mcpServers']))for(const [id,value] of Object.entries(config['mcpServers'])) {
      if(isObject(value))servers.set(id,{id,name:id,detail:source,enabled:!disabled.includes(id)&&value['disabled']!==true&&value['enabled']!==false});
    }
  }
  const result=await run(['plugin','list','--json']);const installed:unknown=JSON.parse(result.stdout);
  const plugins=isObject(installed)?Object.values(installed).filter(Array.isArray).flat().filter(isObject).map(value=>({id:String(value['name']??value['id']??''),name:String(value['name']??value['id']??''),kind:'plugin',enabled:value['enabled']!==false})).filter(value=>value.id):[];
  if(action==='togglePlugin') {
    if(typeof params['enabled']!=='boolean'||!plugins.some(value=>value.id===params['id']))throw new Error('Unknown plugin');
    await run(['plugin',params['enabled']?'enable':'disable',String(params['id'])]);
    return extensions(options,{action:'listExtensions'});
  }
  if(action==='manageExtensions') {
    await mkdir(join(options.cwd,'.omp'),{recursive:true});
    try{await writeFile(projectFile,JSON.stringify({mcpServers:{}},null,2),{flag:'wx'});}catch(error){if(!isObject(error)||error['code']!=='EEXIST')throw error;}
  }
  return {mcpServers:[...servers.values()],plugins,configFiles:action==='manageExtensions'?[projectFile]:[]};
}
