import { lstat, realpath, opendir, open } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { isObject } from '@piagent/protocol';

export const WORKSPACE_CAPABILITY = 'workspace.read.v1';
export const workspaceTools = [
  { name: 'workspace_read_file', description: 'Read UTF-8 text lines from a relative file inside the configured read-only workspace. No IDE unsaved buffers.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, maxLines: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['path'], additionalProperties: false } },
  { name: 'workspace_search', description: 'Search literal text in UTF-8 workspace files. Returns bounded snippets and relative paths; ignored directories and secrets are excluded.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, caseSensitive: { type: 'boolean' }, maxResults: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'], additionalProperties: false } },
] as const;

const denied = (name: string): boolean => /^(\.git|\.svn|\.hg|\.ssh|\.aws|\.azure|node_modules|\.tools|artifacts|bin|obj)$/i.test(name)
  || /^(\.env($|\.)|credentials($|\.)|secrets($|\.))/i.test(name) || /\.(pem|key|pfx|p12|kdbx)$/i.test(name);
const integer = (value: unknown, fallback: number, max: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid numeric limit');
  return value;
};
/** Read-only filesystem service, configured by the daemon owner, never by model/adapter parameters. */
export class WorkspaceReader {
  private constructor(readonly root: string) {}
  static async create(root: string): Promise<WorkspaceReader> {
    if (!isAbsolute(root)) throw new Error('Workspace root must be absolute');
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw new Error('Workspace root must be a directory');
    return new WorkspaceReader(canonical);
  }
  private async path(value: unknown, allowRoot = false): Promise<string> {
    if (allowRoot && (value === undefined || value === '')) return this.root;
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 4096 || /[:\0]/.test(value) || isAbsolute(value)) throw new Error('Expected a relative workspace path');
    const parts = value.split(/[\\/]/);
    if (parts.some(part => !part || part === '.' || part === '..' || denied(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])($|\.)/i.test(part))) throw new Error('Path is excluded');
    let current = this.root;
    for (const part of parts) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Links are excluded'); }
    const canonical = await realpath(current);
    const rel = relative(this.root, canonical);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Path escapes workspace');
    return canonical;
  }
  private async bytes(path: string, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted();
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1 || before.size > 256 * 1024) throw new Error('Only unlinked UTF-8 files up to 256 KiB are readable');
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat();
      if (stat.ino !== before.ino || stat.dev !== before.dev || stat.size > 256 * 1024 || stat.nlink > 1) throw new Error('File changed during open');
      const buffer = Buffer.alloc(256 * 1024 + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        signal.throwIfAborted();
        const part = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (!part.bytesRead) break;
        bytesRead += part.bytesRead;
      }
      signal.throwIfAborted();
      const after = await handle.stat();
      if (bytesRead > 256 * 1024 || (await realpath(path)) !== path || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
        throw new Error('File exceeds limit or changed during read');
      const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
      if (value.includes('\0')) throw new Error('Binary files are excluded');
      return buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }
  private async text(path: string, signal: AbortSignal): Promise<string> {
    return new TextDecoder('utf-8', { fatal: true }).decode(await this.bytes(path, signal));
  }
  /** Internal snapshot for approved changes; never exposes an arbitrary filesystem path on the wire. */
  async snapshot(value: unknown, signal: AbortSignal): Promise<{ absolute: string; bytes: Buffer }> {
    const absolute = await this.path(value);
    return { absolute, bytes: await this.bytes(absolute, signal) };
  }
  async execute(name: string, args: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!isObject(args)) throw new Error('Invalid tool arguments');
    const allowed = name === 'workspace_read_file' ? ['path', 'startLine', 'maxLines'] : name === 'workspace_search' ? ['query', 'path', 'caseSensitive', 'maxResults'] : [];
    if (!allowed.length || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unknown tool or arguments');
    if (name === 'workspace_read_file') {
      const path = await this.path(args['path']);
      const start = integer(args['startLine'], 1, 2147483647), count = integer(args['maxLines'], 100, 200);
      const lines = (await this.text(path, signal)).split(/\r?\n/);
      if (start > lines.length) throw new Error('Start line exceeds file');
      const selected: string[] = []; let bytes = 0;
      for (const line of lines.slice(start - 1, start - 1 + count)) {
        const size = Buffer.byteLength(line) + 1; if (bytes + size > 32768) break;
        selected.push(line); bytes += size;
      }
      if (!selected.length) throw new Error('Requested line exceeds 32 KiB output limit');
      return { path: relative(this.root, path).replaceAll('\\', '/'), startLine: start, endLine: start + selected.length - 1,
        text: selected.join('\n'), truncated: start - 1 + selected.length < lines.length };
    }
    const query = args['query'];
    if (typeof query !== 'string' || !query || Buffer.byteLength(query) > 256 || /[\r\n\0]/.test(query)
      || (args['caseSensitive'] !== undefined && typeof args['caseSensitive'] !== 'boolean')) throw new Error('Expected a single-line literal query up to 256 bytes');
    const limit = integer(args['maxResults'], 20, 50), base = await this.path(args['path'], true);
    const matches: Record<string, unknown>[] = []; let files = 0, entries = 0, truncated = false;
    const needle = args['caseSensitive'] === false ? query.toLowerCase() : query;
    const visit = async (path: string): Promise<void> => {
      signal.throwIfAborted();
      if (++entries > 5000 || files >= 500 || matches.length >= limit) { truncated = true; return; }
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        for await (const entry of await opendir(path)) {
          if (denied(entry.name) || entry.isSymbolicLink()) continue;
          if (entries >= 5000 || files >= 500 || matches.length >= limit) { truncated = true; break; }
          await visit(join(path, entry.name));
        }
      } else if (stat.isFile()) {
        files++;
        let content: string;
        try { content = await this.text(await this.path(relative(this.root, path)), signal); }
        catch { signal.throwIfAborted(); return; }
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index]!;
          const match = (args['caseSensitive'] === false ? line.toLowerCase() : line).indexOf(needle);
          if (match !== -1) {
            let start = Math.max(0, match - 128), end = Math.min(line.length, start + 512);
            if (start > 0 && line.charCodeAt(start) >= 0xdc00 && line.charCodeAt(start) <= 0xdfff) start--;
            if (end < line.length && line.charCodeAt(end - 1) >= 0xd800 && line.charCodeAt(end - 1) <= 0xdbff) end--;
            matches.push({ path: relative(this.root, path).replaceAll('\\', '/'), line: index + 1, text: line.slice(start, end) });
            if (matches.length >= limit) { truncated = true; break; }
          }
        }
      }
    };
    await visit(base); return { matches, filesScanned: files, truncated };
  }
}
