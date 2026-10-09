// Deterministic native-profile fixture: simulate disk changes in the exclusively
// owned test workspace. This is Core checkpoint integration, not IDE acceptance.
import readline from 'node:readline';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const dir=process.argv[process.argv.indexOf('--session-dir')+1];mkdirSync(dir,{recursive:true});
let sessionFile=join(dir,randomUUID()+'.jsonl');writeFileSync(sessionFile,'');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
emit({type:'ready',protocolVersion:1,supportedProtocolVersions:[1,2]});
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{
 const command=JSON.parse(line),response=data=>emit({type:'response',id:command.id,command:command.type,success:true,data});
 if(command.type==='new_session'){sessionFile=join(dir,randomUUID()+'.jsonl');writeFileSync(sessionFile,'');response({});return;}
 if(command.type==='get_state'){response({sessionFile,model:{provider:'fixture',id:'observed-turn'}});return;}
 if(command.type==='switch_session'){sessionFile=command.sessionPath;response({});return;}
 if(command.type==='prompt'){
  appendFileSync(sessionFile,JSON.stringify(command.message)+'\n');response({});emit({type:'agent_start'});
  if(command.message==='large-turn'){
   if(readFileSync(join(process.cwd(),'fixture-marker'),'utf8')!=='owned checkpoint test')throw Error('Not an owned test workspace');
   for(let index=0;index<5;index++)writeFileSync(join(process.cwd(),`Large${index}.cs`),'b'.repeat(30000));
  }
  emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:command.message==='large-turn'?'native disk edit completed':'next turn completed'}});
  emit({type:'session_settled',status:'completed'});return;
 }
 if(command.type==='abort')emit({type:'session_settled',status:'aborted'});
 response({});
});
lines.on('close',()=>process.exit(0));
