import {isObject} from '@piagent/protocol';

export const IDE_CATALOG_CAPABILITY='ide.catalog.v1';
export type IdeAvailability='supported'|'partial'|'unavailable'|'blocked';
export interface IdeCatalogEntry {
  tool:string; operation?:string; availability:IdeAvailability;
  reasonCode?:string; reason?:string; languages?:string[]; frameworks?:string[]; backend?:string;
  implementationVersion?:string;
}
export interface IdeCatalog {
  schemaVersion:1; workspaceUri:string; revision:string; capturedAt:string; entries:IdeCatalogEntry[];
  implementationVersion?:string;
}
const bounded=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&Buffer.byteLength(v)<=max;
export function sameWorkspace(left:string,right:string):boolean {
  return new URL(left).href.replace(/\/$/,'').toLowerCase()===new URL(right).href.replace(/\/$/,'').toLowerCase();
}
/** A bounded adapter observation. Availability never grants access or bypasses consent. */
export function parseIdeCatalog(value:unknown,workspaceUri?:string):IdeCatalog {
  const fail=(reason='snapshot fields or size limits'):never=>{throw new Error('Invalid IDE catalog: '+reason);};
  if(!isObject(value)||Object.keys(value).some(k=>!['schemaVersion','workspaceUri','revision','capturedAt','entries','implementationVersion'].includes(k))
    ||value['schemaVersion']!==1||!bounded(value['workspaceUri'],4096)||!bounded(value['revision'],256)
    ||!bounded(value['capturedAt'],64)||!Number.isFinite(Date.parse(value['capturedAt']))
    ||!Array.isArray(value['entries'])||value['entries'].length>64||Buffer.byteLength(JSON.stringify(value))>65536)return fail();
  if(value['implementationVersion']!==undefined&&!bounded(value['implementationVersion'],128))return fail('implementationVersion must be a bounded nonempty string');
  try{if(new URL(value['workspaceUri']).protocol!=='file:'||workspaceUri&&!sameWorkspace(value['workspaceUri'],workspaceUri))return fail('workspace must match the bound local file URI');}catch{return fail('workspace must match the bound local file URI');}
  const keys=new Set<string>();
  for(const entry of value['entries']) {
    if(!isObject(entry)||Object.keys(entry).some(k=>!['tool','operation','availability','reasonCode','reason','languages','frameworks','backend','implementationVersion'].includes(k))
      ||!bounded(entry['tool'],128)||!/^ide_[a-z0-9_]+$/.test(entry['tool'])
      ||!['supported','partial','unavailable','blocked'].includes(String(entry['availability'])))return fail('entry fields, tool identifier or availability');
    for(const [key,max] of [['operation',128],['reasonCode',128],['reason',2048],['backend',128],['implementationVersion',128]] as const)
      if(entry[key]!==undefined&&!bounded(entry[key],max))return fail('entry '+key+' must be a bounded nonempty string');
    for(const key of ['languages','frameworks'])if(entry[key]!==undefined&&(!Array.isArray(entry[key])||entry[key].length>32||!entry[key].every(v=>bounded(v,128))))return fail('entry '+key+' must be a bounded string array');
    if(['unavailable','blocked'].includes(String(entry['availability']))&&(!entry['reasonCode']||!entry['reason']))return fail('unavailable/blocked entry requires reasonCode and reason');
    const key=String(entry['tool'])+'\0'+String(entry['operation']??'');if(keys.has(key))return fail('duplicate tool/operation entry');keys.add(key);
  }
  return structuredClone(value) as unknown as IdeCatalog;
}
export function catalogEntry(catalog:IdeCatalog,name:string,operation?:unknown):IdeCatalogEntry|undefined {
  return catalog.entries.find(e=>e.tool===name&&e.operation===operation)??catalog.entries.find(e=>e.tool===name&&e.operation===undefined);
}
export function actionable(entry:IdeCatalogEntry|undefined):boolean{return entry?.availability==='supported'||entry?.availability==='partial';}
