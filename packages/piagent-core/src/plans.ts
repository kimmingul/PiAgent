import {randomUUID,createHash} from 'node:crypto';
import {mkdir,lstat,realpath,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
/** Plan mode has one explicit write exception: a new docs/plans document. */
export class Plans {
  constructor(private readonly root:string) {}
  async create(text:string):Promise<{path:string;hash:string}> {
    if(!text.trim()||Buffer.byteLength(text)>256*1024)throw new Error('Plan is empty or exceeds 256 KiB');
    for(const path of [join(this.root,'docs'),join(this.root,'docs','plans')]){await mkdir(path,{recursive:true});const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)throw new Error('Plan directory links are forbidden');}
    const path=`docs/plans/piagent-${randomUUID()}.md`;await writeFile(join(this.root,path),text,{flag:'wx'});return {path,hash:createHash('sha256').update(text).digest('hex')};
  }
  async read(plan:{path:string;hash:string}):Promise<string> {
    if(!/^docs\/plans\/piagent-[0-9a-f-]{36}\.md$/.test(plan.path))throw new Error('Invalid plan path');
    const path=join(this.root,plan.path),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>256*1024||await realpath(path)!==path)throw new Error('Invalid plan document');
    const text=await readFile(path,'utf8');if(createHash('sha256').update(text).digest('hex')!==plan.hash)throw new Error('Plan changed after preview. Request a new plan before executing');return text;
  }
}
