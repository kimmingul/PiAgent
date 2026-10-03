import { resolve } from 'node:path';
import { startDaemon } from './index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let pipeName = 'piagent-dev';
  let executable: string | undefined;
  let cwd = process.cwd();
  let workspaceRoot: string | undefined;
  let development = false;
  let allowWrites = false;
  let authFile: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') {
      console.log('PiAgent: --pipe <name> [--omp <omp.exe> --cwd <workspace> --workspace <root> --allow-writes] [--auth-file <private-file>] [--dev-pipe]');
      return;
    }
    if (flag === '--dev-pipe') { development = true; continue; }
    if (flag === '--allow-writes') { allowWrites = true; continue; }
    if (!['--pipe', '--omp', '--cwd', '--workspace', '--auth-file'].includes(flag ?? '')) throw new Error(`Unknown argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`);
    if (flag === '--pipe') pipeName = value;
    else if (flag === '--omp') executable = value;
    else if (flag === '--workspace') workspaceRoot = resolve(value);
    else if (flag === '--auth-file') authFile = resolve(value);
    else cwd = resolve(value);
  }
  if (development && (authFile || workspaceRoot || executable)) throw new Error('--dev-pipe is only for tool-free protocol development');
  const daemon = await startDaemon({ pipeName, onDiagnostic: error => console.error(error.message),
    allowWrites,
    ...(!development ? { secure: { ...(authFile ? { authFile } : {}) } } : {}),
    ...(executable ? { omp: { executable, cwd } } : {}), ...(workspaceRoot ? { workspaceRoot } : {}) });
  let shutdown: Promise<void> | undefined;
  const close = (): Promise<void> => {
    shutdown ??= daemon.close();
    return shutdown;
  };
  const signal = (): void => { void close().catch(error => { console.error(error); process.exitCode = 1; }); };
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    console.error(`PiAgent listening on ${daemon.path} (${process.platform}/${process.arch})`);
    console.error(`Transport: ${development ? 'development pipe, no authentication' : 'current-user ACL, local-only, authenticated'}`);
    console.error(`Chat ${executable ? 'enabled: isolated OMP sessions on demand' : 'disabled: pass --omp to enable'}`);
    console.error(`Workspace tools ${workspaceRoot ? (allowWrites ? 'enabled: writes require per-change approval' : 'enabled: read-only, negotiated per connection') : 'disabled: pass --workspace to enable'}`);
  } catch (error) { await close(); throw error; }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
