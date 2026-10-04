import {lstat, readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isObject} from '@piagent/protocol';

export const PREFERENCES_CAPABILITY='chat.preferences.v1';
export const defaults={language:'auto',fontSize:13,showThinking:true,showTools:true,showTodos:true,showSubagents:true,notifications:false,highContrast:false,defaultApproval:'always-ask'};
export type Preferences=typeof defaults;
/** Private workspace preferences. Provider credentials remain owned by OMP. */
export class PreferencesStore {
  private static readonly writes=new Map<string,Promise<unknown>>();
  constructor(private readonly root:string) {}
  validate(value:unknown):Preferences {
    if(!isObject(value)||Object.keys(value).some(key=>!Object.hasOwn(defaults,key)))throw new Error('Unknown preference');
    const result={...defaults,...value};
    if(!['auto','ko','en','ja','de','fr'].includes(result.language)||!Number.isInteger(result.fontSize)||result.fontSize<10||result.fontSize>24||!['always-ask','write','yolo','plan'].includes(result.defaultApproval))throw new Error('Invalid preference');
    for(const key of ['showThinking','showTools','showTodos','showSubagents','notifications','highContrast'] as const)if(typeof result[key]!=='boolean')throw new Error('Invalid preference');
    return result;
  }
  async read():Promise<Preferences> {
    const path=join(this.root,'preferences.json');
    try {const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>8192)throw new Error('Invalid preferences file');return this.validate(JSON.parse(await readFile(path,'utf8')) as unknown);}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {...defaults};throw error;}
  }
  async save(value:unknown):Promise<Preferences> {
    const result=this.validate(value);
    const operation=(PreferencesStore.writes.get(this.root)??Promise.resolve()).catch(()=>{}).then(()=>this.persist(result));
    PreferencesStore.writes.set(this.root,operation);
    void operation.finally(()=>{if(PreferencesStore.writes.get(this.root)===operation)PreferencesStore.writes.delete(this.root);}).catch(()=>{});
    return operation;
  }
  private async persist(result:Preferences):Promise<Preferences> {
    await this.read();
    const temp=join(this.root,`preferences-${randomUUID()}.tmp`);
    try{await writeFile(temp,JSON.stringify(result),{flag:'wx',mode:0o600});await rename(temp,join(this.root,'preferences.json'));return result;}
    finally{await unlink(temp).catch(()=>{});}
  }
}
