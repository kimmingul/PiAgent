// Deterministic provider for native VS acceptance. Never calls an external model.
import readline from 'node:readline';
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const arg=k=>process.argv[process.argv.indexOf(k)+1],audit=process.argv.includes('--audit')?arg('--audit'):undefined;
const directory=process.argv.includes('--session-dir')?arg('--session-dir'):undefined;
let sessionFile;if(directory){mkdirSync(directory,{recursive:true});sessionFile=join(directory,randomUUID()+'.jsonl');writeFileSync(sessionFile,'');}
const send=frame=>process.stdout.write(JSON.stringify(frame)+'\n');
const record=value=>{if(audit)appendFileSync(audit,JSON.stringify(value)+'\n');};
send({type:'ready',protocolVersion:1,supportedProtocolVersions:[1,2]});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const c=JSON.parse(line),reply=data=>send({type:'response',id:c.id,command:c.type,success:true,data});
 if(c.type==='host_tool_result'){record(c);send({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:JSON.stringify(c.result)}});send({type:'session_settled',status:'completed'});return;}
 if(c.type==='get_state'){reply({sessionFile,model:{provider:'fixture',id:'vs-intelligence'}});return;}
 if(c.type==='get_session_stats'){reply({tokens:{input:10,output:10,total:20},cost:0});return;}
 if(c.type==='get_available_commands'){reply({commands:[]});return;}
 if(c.type!=='prompt'){reply({});return;}
 reply({});send({type:'agent_start'});
 if(c.message.startsWith('You are an editor suggestion engine.')){
  const body=JSON.parse(c.message.slice(c.message.lastIndexOf('\n')+1));record({editor:body.mode,file:body.file,position:body.position});
  const prefix=body.text.slice(0,body.position);
  const edit=body.mode==='completion'?{start:body.position,length:0,text:(/\breturn$/.test(prefix)?' ':'')+'a + b;'}:{start:body.text.indexOf('a + b'),length:5,text:'a - b'};
  send({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:JSON.stringify(edit)}});send({type:'session_settled',status:'completed'});return;
 }
 const marker=c.message.lastIndexOf('VS_CHECK:');
 if(marker>=0){const tool=JSON.parse(c.message.slice(marker+9));record({requested:tool});send({type:'host_tool_call',id:randomUUID(),toolName:tool.name,arguments:tool.args??{}});return;}
 send({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Use VS_CHECK:{"name":"ide_context","args":{}}'}});send({type:'session_settled',status:'completed'});
});
