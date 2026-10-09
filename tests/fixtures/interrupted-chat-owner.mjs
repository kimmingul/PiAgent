// Production ChatSession in a separately killable test owner; no graceful cleanup
// runs when the parent terminates this process during an acknowledged turn.
import {SessionStore,ChatSession} from '@piagent/core';
import {fileURLToPath} from 'node:url';
const root=process.argv[2];
const store=new SessionStore(root);await store.initialize();
const options={executable:process.execPath,executableArgs:[fileURLToPath(new URL('./chat-omp.mjs',import.meta.url))],cwd:root};
const chat=new ChatSession(options,event=>process.send?.({type:'event',event}),undefined,undefined,{sessions:store});
const opened=await chat.handle('chat.open',{},false,false,true);process.send?.({type:'opened',opened});
process.on('message',async command=>{
 try{const result=await chat.handle('chat.prompt',{sessionId:opened.sessionId,message:command.message},false,false,true);process.send?.({type:'ack',id:command.id,result});}
 catch(error){process.send?.({type:'failed',id:command.id,error:error.message});}
});
