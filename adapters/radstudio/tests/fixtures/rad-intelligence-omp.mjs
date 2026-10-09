// Deterministic provider for isolated native RAD acceptance. No external model.
import readline from 'node:readline';
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const audit=process.argv.includes('--audit')?arg('--audit'):undefined;
const directory=process.argv.includes('--session-dir')?arg('--session-dir'):undefined;
let sessionFile;
if(directory){mkdirSync(directory,{recursive:true});sessionFile=join(directory,randomUUID()+'.jsonl');writeFileSync(sessionFile,'');}
const send=frame=>process.stdout.write(JSON.stringify(frame)+'\n');
const record=value=>{if(audit)appendFileSync(audit,JSON.stringify(value)+'\n');};
send({type:'ready',protocolVersion:1,supportedProtocolVersions:[1,2]});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const command=JSON.parse(line),reply=data=>send({type:'response',id:command.id,command:command.type,success:true,data});
 if(command.type==='host_tool_result'){record(command);send({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:JSON.stringify(command.result)}});send({type:'session_settled',status:'completed'});return;}
 if(command.type==='get_state'){reply({sessionFile,model:{provider:'fixture',id:'rad-intelligence'}});return;}
 if(command.type==='get_session_stats'){reply({tokens:{input:10,output:10,total:20},cost:0});return;}
 if(command.type==='get_available_commands'){reply({commands:[]});return;}
 if(command.type!=='prompt'){reply({});return;}
 reply({});send({type:'agent_start'});
 if(command.message.startsWith('You are an editor suggestion engine.')){
  const body=JSON.parse(command.message.slice(command.message.lastIndexOf('\n')+1));
  record({editor:body.mode,file:body.file,position:body.position,context:body.context});
  const marker=body.text.indexOf('RAD_EDITOR_BEFORE');
  const edit=body.mode==='next-edit'&&marker>=0
    ?{start:marker,length:'RAD_EDITOR_BEFORE'.length,text:'RAD_EDITOR_AFTER'}
    :{start:body.position,length:0,text:'{ PiAgent RAD explicit preview fixture }'};
  send({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:JSON.stringify(edit)}});send({type:'session_settled',status:'completed'});return;
 }
 const marker=command.message.lastIndexOf('RAD_CHECK:');
 if(marker>=0){const tool=JSON.parse(command.message.slice(marker+10));record({requested:tool});send({type:'host_tool_call',id:randomUUID(),toolName:tool.name,arguments:tool.args??{}});return;}
 send({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Use RAD_CHECK:{"name":"ide_context","args":{}}'}});send({type:'session_settled',status:'completed'});
});
