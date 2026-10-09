import {appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const index=process.argv.indexOf('--lifecycle-audit');
if(index<0||!process.argv[index+1])throw new Error('Lifecycle audit path missing');
const audit=process.argv[index+1],editor=process.argv.includes('--no-session'),instance=randomUUID();
appendFileSync(audit,JSON.stringify({type:'spawn',pid:process.pid,instance,editor})+'\n');
process.on('exit',code=>appendFileSync(audit,JSON.stringify({type:'exit',pid:process.pid,instance,code})+'\n'));
await import(editor?'./editor-omp.mjs':'./chat-omp.mjs');
