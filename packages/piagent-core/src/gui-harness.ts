import {readFile} from 'node:fs/promises';
import {isObject} from '@piagent/protocol';

// Framework routing is packaged data, not IDE SDK logic in the Core.
const root=new URL('../harness/',import.meta.url);
async function resource(path:string):Promise<string> {
  if(!/^[a-zA-Z0-9/-]+\.(json|md)$/.test(path)||path.includes('..'))throw new Error('Invalid harness resource');
  const text=await readFile(new URL(path,root),'utf8');
  if(Buffer.byteLength(text)>64*1024)throw new Error('Harness resource exceeds limit');
  return text;
}
export async function guiHarness(snapshot:Record<string,unknown>):Promise<Record<string,unknown>|undefined> {
  const manifest:unknown=JSON.parse(await resource('manifest.json'));
  if(!isObject(manifest)||manifest['schemaVersion']!==1||!Array.isArray(manifest['frameworks']))throw new Error('Invalid GUI harness manifest');
  const entry=manifest['frameworks'].filter(isObject).find(item=>Array.isArray(item['ids'])&&item['ids'].includes(snapshot['framework']));
  if(!entry)return undefined;
  if(typeof entry['skill']!=='string'||typeof entry['catalog']!=='string')throw new Error('Invalid GUI harness entry');
  const [instructions,catalogText]=await Promise.all([resource(entry['skill']),resource(entry['catalog'])]);
  const catalog:unknown=JSON.parse(catalogText);
  return {schemaVersion:1,packageVersion:manifest['version'],instructions,catalog,
    authority:'Reference guidance only. Live snapshot capabilities, writable properties and allowed targets determine executable operations. Catalog entries do not imply installed controls or designer support.'};
}
