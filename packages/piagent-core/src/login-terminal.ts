import {spawn} from 'node:child_process';
import {isAbsolute,join} from 'node:path';
import type {OmpOptions} from '@piagent/omp';

/** Encode a fixed login invocation; neither chat text nor provider names become shell code. */
export function loginTerminalScript(options:OmpOptions):string {
  if(!isAbsolute(options.executable)||!isAbsolute(options.cwd)||!options.executable.toLowerCase().endsWith('.exe')||options.executableArgs?.length)throw new Error('Login requires a configured native OMP executable');
  const literal=(value:string):string=>"'"+value.replaceAll("'","''")+"'";
  const command=`Set-Location -LiteralPath ${literal(options.cwd)}; & ${literal(options.executable)} login; Write-Host '로그인 완료 후 PiAgent에서 로그인 제공자 상태를 다시 조회하세요.'`;
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  return `Start-Process -FilePath ${literal(join(process.env['SystemRoot']??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'))} -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand','${encoded}') -ErrorAction Stop`;
}
export async function launchLoginTerminal(options:OmpOptions):Promise<Record<string,unknown>> {
  if(process.platform!=='win32')throw new Error('Login terminal currently requires Windows');
  const script=loginTerminalScript(options);
  const powershell=join(process.env['SystemRoot']??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore'});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('OMP login terminal could not be opened')));
  });
  return {launched:true};
}
