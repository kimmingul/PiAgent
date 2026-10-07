import {SessionStore} from '@piagent/core';
const store=new SessionStore(process.argv[2]);await store.initialize();
try{
  const lease=await store.acquire(process.argv[3]||undefined);
  if(process.argv[4])await lease.started(Number(process.argv[4]));
  lease.append('user','Persisted before abrupt termination');await lease.save();
  process.send({id:lease.record.savedSessionId});
  process.on('message',async()=>{await lease.release();process.disconnect();});
}catch(error){process.send({error:error.message});process.disconnect();}
