// Opt-in read-only smoke against an installed OMP. Never sends a prompt.
import { resolve } from 'node:path';
import { OmpProcess } from '@piagent/omp';
const [executable = 'omp', cwd = process.cwd()] = process.argv.slice(2);
const omp = new OmpProcess({ executable, cwd: resolve(cwd), readyTimeoutMs: 30_000, requestTimeoutMs: 10_000 });
omp.on('diagnostic', error => console.error(error.message));
try {
  const ready = await omp.start();
  console.log(JSON.stringify({ type: ready.type, protocolVersion: ready.protocolVersion ?? 1 }));
  const state = await omp.request('get_state');
  console.log(JSON.stringify({ command: state.command, success: state.success }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await omp.stop(); }
