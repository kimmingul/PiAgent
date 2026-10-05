import {lstat,readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseDocument} from 'yaml';
import {isObject} from '@piagent/protocol';
/** Only the bound workspace's native OMP project file. Preserve unrelated YAML and refuse links. */
export async function projectConfig(cwd:string):Promise<{text:string;roles:Record<string,string>}> {
 const directory=join(cwd,'.omp'),path=join(directory,'config.yml');let text='';
 try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe OMP project directory');const file=await lstat(path);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size>1024*1024)throw new Error('Unsafe OMP project config');text=await readFile(path,'utf8');}catch(error){if(!isObject(error)||error['code']!=='ENOENT')throw error;}
 const doc=parseDocument(text);if(doc.errors.length)throw new Error('Invalid OMP project YAML');const data:unknown=doc.toJSON();if(data!==null&&!isObject(data))throw new Error('Expected OMP project mapping');const roles=isObject(data)&&isObject(data['modelRoles'])?data['modelRoles']:{};
 return {text,roles:Object.fromEntries(Object.entries(roles).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))};
}
export async function writeProjectRoles(cwd:string,expected:string,roles:Record<string,string>):Promise<void> {
 const directory=join(cwd,'.omp');await mkdir(directory,{recursive:true});
 await projectConfig(cwd);
 const lock=await open(join(directory,'.piagent-config.lock'),'wx');const temporary=join(directory,`.piagent-${randomUUID()}.tmp`);
 try{const current=await projectConfig(cwd);if(current.text!==expected)throw new Error('Project settings changed; reload before saving');const doc=parseDocument(current.text);doc.set('modelRoles',roles);const file=await open(temporary,'wx');try{await file.writeFile(doc.toString(),'utf8');await file.sync();}finally{await file.close();}if((await projectConfig(cwd)).text!==expected)throw new Error('Project settings changed; reload before saving');await rename(temporary,join(directory,'config.yml'));}
 finally{await unlink(temporary).catch(()=>{});await lock.close();await unlink(join(directory,'.piagent-config.lock'));}
}
