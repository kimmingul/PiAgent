import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {OmpOptions} from '@piagent/omp';
import {executionCommands} from './omp-controls.js';
const execute=promisify(execFile);
/** A declared PiAgent contract, separate from upstream command discovery. Unknown versions are not certified. */
export async function ompFeatures(options:OmpOptions):Promise<Record<string,unknown>> {
  let version='unknown';
  try{const result=await execute(options.executable,[...(options.executableArgs??[]),'--version'],{cwd:options.cwd,windowsHide:true,timeout:5000,maxBuffer:8192});version=/\bomp\/(\d+\.\d+\.\d+)\b/.exec(result.stdout)?.[1]??'unknown';}catch{/* RPC may still work; report unavailable version rather than certifying it. */}
  return {version,verifiedContract:version==='18.6.1',contractVersion:1,referenceVersion:'18.6.1',commands:[...executionCommands],excluded:['voice','generated-media','collaboration','sharing','broadcast','recording'],message:version==='18.6.1'?'OMP 18.6.1 RPC 계약 기준':'미검증 OMP 버전: 명령 실패 시 실제 OMP 오류를 표시합니다.'};
}
