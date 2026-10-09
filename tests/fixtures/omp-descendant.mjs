import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
const cleanup=process.argv[process.argv.indexOf('--cleanup-file')+1];
if(!cleanup)throw Error('Owned fixture cleanup path missing');
const descendant=spawn(process.execPath,['-e',"const fs=require('node:fs');process.send({ready:true});setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},100)",cleanup],{windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
descendant.once('message',()=>process.stdout.write(JSON.stringify({type:'ready',protocolVersion:1,supportedProtocolVersions:[1],descendantPid:descendant.pid})+'\n'));
process.stdin.resume();
setInterval(()=>{if(existsSync(cleanup))process.exit(0)},100); // Ignores stdin EOF; owned sentinel permits safe failure cleanup without targeting retired PIDs.
