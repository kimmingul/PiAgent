import {OmpProcess} from '../packages/piagent-omp/dist/index.js';
import {resolve} from 'node:path';
const executable=resolve(process.argv[2]??'.tools/omp-18.6.0/omp.exe');
const omp=new OmpProcess({executable,cwd:process.cwd(),executableArgs:['--no-session','--no-tools','--no-extensions','--no-skills','--no-rules','--no-lsp','--no-title','--no-pty'],requestTimeoutMs:30000,readyTimeoutMs:30000});
try {
 const ready=await omp.start();
 const state=await omp.request('get_state');
 const models=await omp.request('get_available_models');
 const levels=await omp.request('get_available_thinking_levels');
 if(!Array.isArray(models.data?.models)||!Array.isArray(levels.data?.levels))throw Error('Missing model/effort discovery');
 if(state.data?.model)await omp.request('set_model',{provider:state.data.model.provider,modelId:state.data.model.id});
 if(state.data?.thinkingLevel)await omp.request('set_thinking_level',{level:state.data.thinkingLevel});
 console.log(JSON.stringify({ready:ready.protocolVersion,v2:ready.supportedProtocolVersions?.includes(2),modelCount:models.data.models.length,levels:levels.data.levels,modelSelection:true},null,2));
} finally {await omp.stop();}
