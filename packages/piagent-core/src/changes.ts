import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isObject } from '@piagent/protocol';
import { WorkspaceReader } from './workspace.js';

export const EDIT_CAPABILITY = 'workspace.edit.v1';
export const BATCH_CAPABILITY='workspace.edit.batch.v1';
export const batchEditTool={name:'workspace_propose_changes',description:'Propose replacing 1-8 existing Git-tracked UTF-8 files as one reviewed change set. Each file max 32 KiB, total max 128 KiB per side. Waits for explicit user approval.',parameters:{type:'object',properties:{files:{type:'array',minItems:1,maxItems:8,items:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}},reason:{type:'string'}},required:['files','reason'],additionalProperties:false}};
export const editTool = { name: 'workspace_propose_edit', description: 'Propose replacing one existing Git-tracked UTF-8 file (max 32 KiB). Waits for explicit user approval. Never approves itself. Include the complete replacement content.',
  parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, reason: { type: 'string' } }, required: ['path', 'content', 'reason'], additionalProperties: false } };
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const signal = (): AbortSignal => new AbortController().signal;
const decode = (bytes: Buffer): string => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
export interface FileEdit {path:string;before:Buffer;after:Buffer;beforeHash:string;afterHash:string;}
export interface TurnSnapshot {files:{path:string;bytes:Buffer}[];excluded:number;}
export interface Proposal {
  files?:FileEdit[];
  id: string; path: string; reason: string; before: Buffer; after: Buffer; beforeHash: string; afterHash: string; revision: string; expiresAt: number;
}
interface CheckpointFile {path:string;before:string;after:string;beforeHash:string;afterHash:string;}
interface Checkpoint { files?:CheckpointFile[]; version: 1; id: string; path: string; before: string; after: string; beforeHash: string; afterHash: string; createdAt: number;
  state: 'prepared' | 'applied' | 'restoring' | 'restored' | 'failed'; }
/** Exact full-file unified preview. CR is shown explicitly so CRLF changes cannot hide in the preview. */
function diff(path: string, before: Buffer, after: Buffer): string {
  const lines = (value: Buffer): string[] => {
    const text = decode(value); const parts = text.split('\n'); if (text.endsWith('\n')) parts.pop();
    return text === '' ? [] : parts.map(line => line.replaceAll('\r', '␍').replaceAll('\ufeff', '⟨BOM⟩'));
  };
  const left = lines(before), right = lines(after);
  return [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${left.length} +1,${right.length} @@`,
    ...left.map(line => `-${line}`), ...(before.length && before.at(-1) !== 10 ? ['\\ No newline at end of old file'] : []),
    ...right.map(line => `+${line}`), ...(after.length && after.at(-1) !== 10 ? ['\\ No newline at end of new file'] : [])].join('\n');
}
export function proposalView(proposal: Proposal): Record<string, unknown> {
  return { proposalId: proposal.id, path: proposal.path, reason: proposal.reason, revision: proposal.revision,
    beforeHash: proposal.beforeHash, afterHash: proposal.afterHash, expiresAt: proposal.expiresAt,
    files:(proposal.files??[proposal]).map(file=>({path:file.path,beforeHash:file.beforeHash,afterHash:file.afterHash})), diff:(proposal.files??[proposal]).map(file=>diff(file.path,file.before,file.after)).join('\n\n') };
}
/** Git-backed single-file checkpoints. Never touches the user's index, HEAD or branch. */
export class WorkspaceChanges {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private readonly reader: WorkspaceReader, private readonly directory: string) {}
  static async create(reader: WorkspaceReader): Promise<WorkspaceChanges> {
    const gitDir = join(reader.root, '.git');
    const stat = await lstat(gitDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Writes require a standalone Git repository root');
    for (const path of [join(gitDir, 'piagent'), join(gitDir, 'piagent', 'checkpoints'), join(gitDir, 'piagent', 'no-hooks')]) {
      await mkdir(path, { recursive: true });
      if ((await lstat(path)).isSymbolicLink() || (await realpath(path)) !== path) throw new Error('Checkpoint directory links are forbidden');
    }
    const emptyConfig = join(gitDir, 'piagent', 'empty-config');
    try { const created = await open(emptyConfig, 'wx'); await created.close(); }
    catch (error) { if (!isObject(error) || error['code'] !== 'EEXIST') throw error; }
    const configStat = await lstat(emptyConfig);
    if (!configStat.isFile() || configStat.isSymbolicLink() || configStat.nlink !== 1 || configStat.size !== 0) throw new Error('Invalid checkpoint Git configuration');
    const instance = new WorkspaceChanges(reader, join(gitDir, 'piagent', 'checkpoints'));
    const root = (await instance.git(['rev-parse', '--show-toplevel'])).toString('utf8').trim();
    if (await realpath(root) !== reader.root) throw new Error('Workspace must be the Git repository root');
    await instance.git(['rev-parse', '--verify', 'HEAD']);
    return instance;
  }
  private git(args: string[], input?: Buffer): Promise<Buffer> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    return new Promise((resolve, reject) => {
      const child = execFile('git', ['--no-optional-locks', '--literal-pathspecs', '-c', `core.hooksPath=${join(this.directory, '..', 'no-hooks')}`, ...args],
        { cwd: this.reader.root, windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'buffer',
          env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(this.directory,'..','empty-config'), GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' } },
        (error, stdout) => error ? reject(new Error('Git checkpoint operation failed')) : resolve(stdout));
      child.stdin?.on('error', () => {}); child.stdin?.end(input);
    });
  }
  private async tracked(path: string): Promise<void> {
    const value = (await this.git(['ls-files', '--stage', '-z', '--', path])).toString('utf8');
    const entries = value.split('\0').filter(Boolean);
    if (entries.length !== 1 || !/^100(?:644|755) [0-9a-f]+ 0\t/.test(entries[0]!) || entries[0]!.split('\t')[1] !== path)
      throw new Error('Only an existing, non-conflicted Git-tracked regular file can be edited');
  }
  async propose(args: unknown, abort: AbortSignal): Promise<Proposal> {
    if (!isObject(args) || Object.keys(args).some(key => !['path', 'content', 'reason'].includes(key))
      || typeof args['path'] !== 'string' || /[\r\n\t]/.test(args['path']) || typeof args['content'] !== 'string'
      || typeof args['reason'] !== 'string' || !args['reason'].trim() || Buffer.byteLength(args['reason']) > 1024
      || Buffer.byteLength(args['content']) > 32768 || /\0/.test(args['content']) || Buffer.from(args['content']).toString('utf8') !== args['content']) throw new Error('Invalid edit proposal');
    const snapshot = await this.reader.snapshot(args['path'], abort);
    if (snapshot.bytes.length > 32768) throw new Error('Edits are limited to 32 KiB UTF-8 files');
    const path = relative(this.reader.root, snapshot.absolute).replaceAll('\\', '/'); await this.tracked(path); abort.throwIfAborted();
    const after = Buffer.from(args['content']); if (snapshot.bytes.equals(after)) throw new Error('Proposal makes no change');
    const beforeHash = hash(snapshot.bytes), afterHash = hash(after);
    return { id: randomUUID(), path, reason: args['reason'], before: snapshot.bytes, after, beforeHash, afterHash,
      revision: hash(JSON.stringify([path, beforeHash, afterHash])), expiresAt: Date.now() + 300_000 };
  }
  async proposeMany(args:unknown,abort:AbortSignal):Promise<Proposal> {
    if(!isObject(args)||Object.keys(args).some(key=>!['files','reason'].includes(key))||!Array.isArray(args['files'])||args['files'].length<1||args['files'].length>8)throw new Error('Invalid change set');
    const edits:Proposal[]=[];
    for(const file of args['files']) {
      if(!isObject(file)||Object.keys(file).some(key=>!['path','content'].includes(key)))throw new Error('Invalid change set file');
      edits.push(await this.propose({...file,reason:args['reason']},abort));
    }
    if(new Set(edits.map(file=>file.path.toLowerCase())).size!==edits.length)throw new Error('Duplicate change set path');
    if(edits.reduce((sum,file)=>sum+file.before.length,0)>131072||edits.reduce((sum,file)=>sum+file.after.length,0)>131072)throw new Error('Change set exceeds 128 KiB');
    const first=edits[0]!;
    const result={...first,id:randomUUID(),files:edits,revision:hash(JSON.stringify(edits.map(file=>[file.path,file.beforeHash,file.afterHash]))),expiresAt:Math.min(...edits.map(file=>file.expiresAt))};
    if(Buffer.byteLength(JSON.stringify(proposalView(result)))>900_000)throw new Error('Change set preview exceeds protocol limit');
    return result;
  }
  private async verifyFiles(files:FileEdit[],after=false):Promise<void> {
    for(const file of files){await this.tracked(file.path);const current=await this.reader.snapshot(file.path,signal());
      if(hash(current.bytes)!==(after?file.afterHash:file.beforeHash))throw new Error(after?'File changed since this checkpoint; restore would overwrite later edits':'File changed after preview; request a new proposal');}
  }
  private async replaceMany(files:FileEdit[],restore=false):Promise<void> {
    const attempted:FileEdit[]=[];
    try{for(const file of files){attempted.push(file);await this.replace(file.path,restore?file.after:file.before,restore?file.before:file.after,signal());}}
    catch(error){
      let recovered=true;
      for(const file of attempted.reverse()){
        const original=restore?file.after:file.before,changed=restore?file.before:file.after;
        try{const current=await this.reader.snapshot(file.path,signal());
          if(current.bytes.equals(changed))await this.replace(file.path,changed,original,signal());
          else if(!current.bytes.equals(original))recovered=false;
        }catch{recovered=false;}
      }
      if(!recovered)throw new Error('Change set interrupted; durable checkpoint recovery is required');
      throw new Error('Change set failed; all attempted files rolled back');
    }
  }
  private async batchFiles(checkpoint:Checkpoint):Promise<FileEdit[]> {
    return Promise.all(checkpoint.files!.map(async file=>({...file,...await this.blobs({...checkpoint,...file})})));
  }
  private applyMany(proposal:Proposal,abort:AbortSignal):Promise<Record<string,unknown>> {
    return this.serialize(async()=>{
      if(Date.now()>=proposal.expiresAt)throw new Error('Proposal expired');
      if((await readdir(this.directory)).filter(name=>name.endsWith('.json')).length>=1000)throw new Error('Checkpoint history limit reached');
      const files=proposal.files!;abort.throwIfAborted();await this.verifyFiles(files);
      const id=randomUUID();const records:CheckpointFile[]=[];const refs:string[]=[];
      for(const [index,file] of files.entries()){
        const before=(await this.git(['hash-object','-w','--stdin','--no-filters'],file.before)).toString().trim();
        const after=(await this.git(['hash-object','-w','--stdin','--no-filters'],file.after)).toString().trim();
        if(!oidPattern.test(before)||!oidPattern.test(after))throw new Error('Invalid Git object ID');
        records.push({path:file.path,before,after,beforeHash:file.beforeHash,afterHash:file.afterHash});
        refs.push(`create refs/piagent/checkpoints/${id}/${index}/before ${before}`,`create refs/piagent/checkpoints/${id}/${index}/after ${after}`);
      }
      const checkpoint:Checkpoint={...records[0]!,version:1,id,files:records,createdAt:Date.now(),state:'prepared'};
      await this.git(['update-ref','--stdin'],Buffer.from(refs.join('\n')+'\n'));await this.metadata(checkpoint);
      await this.verifyFiles(files);abort.throwIfAborted();
      // The entire set finishes or rolls back once the first write starts, despite chat cancellation.
      await this.replaceMany(files);checkpoint.state='applied';
      try{await this.metadata(checkpoint);}catch{return {applied:true,checkpointId:id,path:checkpoint.path,files:records.map(file=>({path:file.path})),warning:'Change set applied; inspect checkpoint journal'};}
      return {applied:true,checkpointId:id,path:checkpoint.path,files:records.map(file=>({path:file.path}))};
    });
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      const path = join(this.directory, 'write.lock');
      let lock;
      try { lock = await open(path, 'wx'); } catch { throw new Error('Workspace checkpoint lock is busy; inspect interrupted operations before retrying'); }
      try { return await action(); } finally { await lock.close(); await unlink(path); }
    });
    this.tail = operation.catch(() => {}); return operation;
  }
  async drain(): Promise<void> { await this.tail; }
  /** Observe native OMP/designer edits without attributing user edits or touching their index. */
  async beginTurn():Promise<TurnSnapshot> {
    await this.drain();const paths=(await this.git(['ls-files','-z'])).toString('utf8').split('\0').filter(Boolean);
    if(paths.length>500)throw new Error('Turn checkpoint is limited to 500 tracked files');
    const files:TurnSnapshot['files']=[];let excluded=0,total=0;
    for(const path of paths){try{await this.tracked(path);const snapshot=await this.reader.snapshot(path,signal());if(snapshot.bytes.length>32768||total+snapshot.bytes.length>8*1024*1024){excluded++;continue;}total+=snapshot.bytes.length;files.push({path,bytes:snapshot.bytes});}catch{excluded++;}}
    return {files,excluded};
  }
  async observeTurn(snapshot:TurnSnapshot):Promise<Record<string,unknown>> {
    await this.drain();const files:FileEdit[]=[];let excluded=snapshot.excluded;
    for(const old of snapshot.files){try{const current=await this.reader.snapshot(old.path,signal());if(current.bytes.equals(old.bytes))continue;if(current.bytes.length>32768){excluded++;continue;}files.push({path:old.path,before:old.bytes,after:current.bytes,beforeHash:hash(old.bytes),afterHash:hash(current.bytes)});}catch{excluded++;}}
    if(files.length>8||files.reduce((sum,file)=>sum+file.before.length+file.after.length,0)>256*1024)throw new Error('Observed turn exceeds eight files or 256 KiB; no complete turn checkpoint was recorded');
    if(!files.length)return {recorded:false,excluded};
    return this.serialize(async()=>{
      if((await readdir(this.directory)).filter(name=>name.endsWith('.json')).length>=1000)throw new Error('Checkpoint history limit reached');
      await this.verifyFiles(files,true);const id=randomUUID(),records:CheckpointFile[]=[],refs:string[]=[];
      for(const [index,file]of files.entries()) {
        const before=(await this.git(['hash-object','-w','--stdin','--no-filters'],file.before)).toString().trim(),after=(await this.git(['hash-object','-w','--stdin','--no-filters'],file.after)).toString().trim();
        if(!oidPattern.test(before)||!oidPattern.test(after))throw new Error('Invalid checkpoint Git object');records.push({path:file.path,before,after,beforeHash:file.beforeHash,afterHash:file.afterHash});refs.push(`create refs/piagent/checkpoints/${id}/${index}/before ${before}`,`create refs/piagent/checkpoints/${id}/${index}/after ${after}`);
      }
      await this.verifyFiles(files,true);await this.git(['update-ref','--stdin'],Buffer.from(refs.join('\n')+'\n'));
      await this.metadata({...records[0]!,version:1,id,files:records,createdAt:Date.now(),state:'applied'});
      return {recorded:true,checkpointId:id,files:records.map(file=>({path:file.path})),excluded};
    });
  }
  private async metadata(checkpoint: Checkpoint): Promise<void> {
    const temporary = join(this.directory, `${checkpoint.id}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify(checkpoint)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, join(this.directory, checkpoint.id + '.json'));
  }
  private async load(id: unknown): Promise<Checkpoint> {
    if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Invalid checkpoint');
    const path = join(this.directory, id + '.json'); const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192) throw new Error('Invalid checkpoint metadata');
    const data: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!isObject(data) || data['version'] !== 1 || data['id'] !== id || typeof data['path'] !== 'string'
      || !oidPattern.test(String(data['before'])) || !oidPattern.test(String(data['after']))
      || !/^[0-9a-f]{64}$/.test(String(data['beforeHash'])) || !/^[0-9a-f]{64}$/.test(String(data['afterHash']))
      || typeof data['createdAt'] !== 'number' || !['prepared','applied','restoring','restored','failed'].includes(String(data['state']))) throw new Error('Invalid checkpoint metadata');
    if(data['files']!==undefined&&(!Array.isArray(data['files'])||data['files'].length<1||data['files'].length>8||data['files'].some(file=>!isObject(file)||typeof file['path']!=='string'||!oidPattern.test(String(file['before']))||!oidPattern.test(String(file['after']))||!/^[0-9a-f]{64}$/.test(String(file['beforeHash']))||!/^[0-9a-f]{64}$/.test(String(file['afterHash'])))||new Set(data['files'].map(file=>String(file.path).toLowerCase())).size!==data['files'].length))throw new Error('Invalid checkpoint files');
    return data as unknown as Checkpoint;
  }
  private async blobs(checkpoint: Checkpoint): Promise<{ before: Buffer; after: Buffer }> {
    const before = await this.git(['cat-file', 'blob', checkpoint.before]); const after = await this.git(['cat-file', 'blob', checkpoint.after]);
    if (before.length > 32768 || after.length > 32768 || hash(before) !== checkpoint.beforeHash || hash(after) !== checkpoint.afterHash) throw new Error('Checkpoint content verification failed');
    return { before, after };
  }
  /** Keep the original handle/ACL/streams. A durable checkpoint exists before the first write. */
  private async replace(path: string, before: Buffer, after: Buffer, abort: AbortSignal): Promise<void> {
    const current = await this.reader.snapshot(path, abort);
    if (!current.bytes.equals(before)) throw new Error('File changed after preview; request a new proposal');
    const stat = await lstat(current.absolute); const handle = await open(current.absolute, 'r+');
    try {
      const opened = await handle.stat();
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1 || !opened.isFile()) throw new Error('File identity changed');
      const content = Buffer.alloc(32769); const count = await handle.read(content, 0, content.length, 0);
      if (!content.subarray(0, count.bytesRead).equals(before)) throw new Error('File changed after preview; request a new proposal');
      abort.throwIfAborted();
      const write = async (bytes: Buffer): Promise<void> => {
        let offset = 0; while (offset < bytes.length) { const result = await handle.write(bytes, offset, bytes.length - offset, offset); if (!result.bytesWritten) throw new Error('File write made no progress'); offset += result.bytesWritten; }
        await handle.truncate(bytes.length); await handle.sync();
      };
      // Once writing starts, complete or roll back using the same handle even if the chat is cancelled.
      try { await write(after); } catch {
        try { await write(before); } catch { throw new Error('Write interrupted; checkpoint recovery is required'); }
        throw new Error('Write failed; original content restored');
      }
    } finally { await handle.close(); }
    const verified = await this.reader.snapshot(path, signal());
    if (!verified.bytes.equals(after)) throw new Error('File changed during write; inspect the durable checkpoint before continuing');
  }
  apply(proposal: Proposal, abort: AbortSignal): Promise<Record<string, unknown>> {
    if(proposal.files)return this.applyMany(proposal,abort);
    return this.serialize(async () => {
      if (Date.now() >= proposal.expiresAt) throw new Error('Proposal expired');
      if ((await readdir(this.directory)).filter(name => name.endsWith('.json')).length >= 1000) throw new Error('Checkpoint history limit reached');
      abort.throwIfAborted(); await this.tracked(proposal.path);
      const current = await this.reader.snapshot(proposal.path, abort);
      if (hash(current.bytes) !== proposal.beforeHash) throw new Error('File changed after preview; request a new proposal');
      const before = (await this.git(['hash-object', '-w', '--stdin', '--no-filters'], proposal.before)).toString().trim();
      const after = (await this.git(['hash-object', '-w', '--stdin', '--no-filters'], proposal.after)).toString().trim();
      if (!oidPattern.test(before) || !oidPattern.test(after)) throw new Error('Invalid Git object ID');
      const checkpoint: Checkpoint = { version: 1, id: randomUUID(), path: proposal.path, before, after, beforeHash: proposal.beforeHash,
        afterHash: proposal.afterHash, createdAt: Date.now(), state: 'prepared' };
      await this.git(['update-ref', '--stdin'], Buffer.from(`create refs/piagent/checkpoints/${checkpoint.id}/before ${before}\ncreate refs/piagent/checkpoints/${checkpoint.id}/after ${after}\n`));
      await this.metadata(checkpoint);
      await this.replace(proposal.path, proposal.before, proposal.after, abort);
      checkpoint.state = 'applied';
      try { await this.metadata(checkpoint); } catch { return { checkpointId:checkpoint.id, path:checkpoint.path, applied:true, warning:'File applied; checkpoint state needs recovery inspection' }; }
      return { checkpointId: checkpoint.id, path: checkpoint.path, applied: true };
    });
  }
  async list(): Promise<Record<string, unknown>[]> {
    const entries = (await readdir(this.directory)).filter(name => name.endsWith('.json'));
    if (entries.length > 1000) throw new Error('Checkpoint history limit reached');
    const records = await Promise.all(entries.map(name => this.load(name.slice(0, -5))));
    return Promise.all(records.sort((a,b) => b.createdAt - a.createdAt).slice(0,50).map(async item => {
      let state: string = item.state;
      if (state === 'prepared' || state === 'restoring') {
        try {
          const files=item.files??[item];const current=await Promise.all(files.map(async file=>hash((await this.reader.snapshot(file.path,signal())).bytes)));
          state=current.every((value,index)=>value===files[index]!.afterHash)?'applied':current.every((value,index)=>value===files[index]!.beforeHash)?(item.state==='restoring'?'restored':'notApplied'):'recoveryRequired';
        } catch { state = 'recoveryRequired'; }
      }
      return { checkpointId:item.id, path:item.path, files:(item.files??[item]).map(file=>({path:file.path})), createdAt:item.createdAt, state };
    }));
  }
  async previewRestore(id: unknown): Promise<Record<string, unknown>> {
    const checkpoint = await this.load(id);
    if(checkpoint.files){if(checkpoint.state==='restored'||checkpoint.state==='failed')throw new Error('Checkpoint is not restorable');
      const files=await this.batchFiles(checkpoint);await this.verifyFiles(files,true);
      return {checkpointId:checkpoint.id,path:checkpoint.path,files:files.map(file=>({path:file.path})),revision:hash(JSON.stringify([checkpoint.id,files.map(file=>[file.path,file.afterHash,file.beforeHash])])),diff:files.map(file=>diff(file.path,file.after,file.before)).join('\n\n')};}
    const content=await this.blobs(checkpoint);
    if (checkpoint.state === 'restored' || checkpoint.state === 'failed') throw new Error('Checkpoint is not restorable');
    const current = await this.reader.snapshot(checkpoint.path, signal());
    if (hash(current.bytes) !== checkpoint.afterHash) throw new Error('File changed since this checkpoint; restore would overwrite later edits');
    return { checkpointId: checkpoint.id, path: checkpoint.path, revision: hash(JSON.stringify([checkpoint.id,checkpoint.afterHash,checkpoint.beforeHash])), diff:diff(checkpoint.path,content.after,content.before) };
  }
  restore(id: unknown, revision: unknown): Promise<Record<string, unknown>> {
    return this.serialize(async () => {
      const preview = await this.previewRestore(id); if (revision !== preview['revision']) throw new Error('Restore preview is stale');
      const checkpoint=await this.load(id);
      if(checkpoint.files){const files=await this.batchFiles(checkpoint);await this.verifyFiles(files,true);checkpoint.state='restoring';await this.metadata(checkpoint);await this.replaceMany(files,true);checkpoint.state='restored';
        try{await this.metadata(checkpoint);}catch{return {restored:true,checkpointId:checkpoint.id,warning:'Change set restored; inspect checkpoint journal'};}
        return {restored:true,checkpointId:checkpoint.id,files:files.map(file=>({path:file.path}))};}
      const content = await this.blobs(checkpoint); await this.tracked(checkpoint.path);
      checkpoint.state = 'restoring'; await this.metadata(checkpoint);
      await this.replace(checkpoint.path, content.after, content.before, signal());
      checkpoint.state = 'restored';
      try { await this.metadata(checkpoint); } catch { return { restored:true, checkpointId:checkpoint.id, path:checkpoint.path, warning:'File restored; checkpoint state needs recovery inspection' }; }
      return { restored: true, checkpointId: checkpoint.id, path: checkpoint.path };
    });
  }
}
