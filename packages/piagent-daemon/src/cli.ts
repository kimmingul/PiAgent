import { resolve } from 'node:path';
import { startDaemon } from './index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let pipeName = 'piagent-dev';
  let executable: string | undefined;
  let cwd = process.cwd();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') {
      console.log('PiAgent: --pipe <name> [--omp <omp.exe> --cwd <workspace>]');
      return;
    }
    if (!['--pipe', '--omp', '--cwd'].includes(flag ?? '')) throw new Error(`Unknown argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`);
    if (flag === '--pipe') pipeName = value;
    else if (flag === '--omp') executable = value;
    else cwd = resolve(value);
  }
  const daemon = await startDaemon({ pipeName, onDiagnostic: error => console.error(error.message),
    ...(executable ? { omp: { executable, cwd } } : {}) });
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
    console.error(`Chat ${executable ? 'enabled: isolated, tool-free OMP sessions on demand' : 'disabled: pass --omp to enable'}`);
  } catch (error) { await close(); throw error; }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
