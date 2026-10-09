import readline from 'node:readline';
import {appendFileSync} from 'node:fs';
const auditIndex=process.argv.indexOf('--audit'),audit=auditIndex<0?undefined:process.argv[auditIndex+1];
const send=frame=>process.stdout.write(JSON.stringify(frame)+'\n');
for(const flag of ['--no-tools','--no-extensions','--no-skills','--no-rules','--no-lsp','--no-session'])if(!process.argv.includes(flag))process.exit(3);
send({type:'ready',protocolVersion:1,supportedProtocolVersions:[1,2]});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const command=JSON.parse(line);if(audit)appendFileSync(audit,JSON.stringify({pid:process.pid,type:command.type,tools:command.tools,args:process.argv.slice(2)})+'\n');
 const reply=data=>send({type:'response',id:command.id,command:command.type,success:true,data});
 if(command.type!=='prompt'){reply({});return;}
 reply({});
 const body=JSON.parse(command.message.slice(command.message.lastIndexOf('\n')+1));
 if(body.text.includes('WAIT_FOREVER'))return;
 const text=body.text.includes('INVALID_RESPONSE')?'bad-json':JSON.stringify(body.mode==='completion'?{start:body.position,length:0,text:'a + b;'}:{start:body.text.indexOf('+'),length:1,text:'-'});
 setTimeout(()=>{send({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:text}});send({type:'agent_end',isTerminal:false});send({type:'session_settled',status:'completed'});},20);
});
