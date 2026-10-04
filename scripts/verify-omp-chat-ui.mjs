import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {OmpProcess} from '@piagent/omp';
import {BtwService} from '../packages/piagent-core/dist/btw.js';
const argument=process.argv[2];const executable=argument?resolve(argument):undefined;if(!executable)throw new Error('Pass the native OMP executable');
const root=await mkdtemp(join(tmpdir(),'piagent-real-ui-'));
const flags=['--no-tools','--no-extensions','--no-skills','--no-rules','--no-lsp','--no-title','--no-pty','--session-dir',join(root,'main')];
const omp=new OmpProcess({executable,cwd:root,executableArgs:flags});let btw;
const evidence={version:execFileSync(executable,['--version'],{encoding:'utf8',windowsHide:true}).trim(),at:new Date().toISOString(),modelPrompt:process.argv.includes('--model-test')};
try {
  await omp.start();await omp.request('new_session');const state=(await omp.request('get_state')).data;
  evidence.mainFileCreated=!!state.sessionFile;
  evidence.commands=(await omp.request('get_available_commands')).data.commands.map(item=>item.name);
  evidence.models=(await omp.request('get_available_models')).data.models.length;
  const folder=join(root,'extra folder');await mkdir(folder);const folderFrames=[];omp.on('frame',frame=>{if(['command_output','notice','extension_ui_request'].includes(frame.type))folderFrames.push(frame);});
  await omp.request('prompt',{message:'/add-dir '+folder});await omp.request('prompt',{message:'/dirs'});evidence.folders=folderFrames.filter(frame=>typeof frame.text==='string'||typeof frame.message==='string').map(frame=>frame.text??frame.message);if(!evidence.folders.some(text=>text.includes(folder)&&text.startsWith('Added '))||evidence.folders.some(text=>text.includes('does not exist')))throw new Error('Folder root was not added: '+JSON.stringify(evidence.folders));
  const html=join(root,'export.html');await omp.request('export_html',{outputPath:html});evidence.exportHtml=(await readFile(html,'utf8')).length>100;
  if(evidence.modelPrompt) {
    const frames=[];btw=new BtwService(join(root,'btw'),{executable,cwd:root},frame=>frames.push(frame));
    const before=await readFile(state.sessionFile);const answer=await btw.ask('What is 2 + 2? Reply with the number only.',undefined,'isolated-verification','PiAgent verification',state.sessionFile,{provider:state.model.provider,id:state.model.id,thinking:'off'});
    let topic;for(let i=0;i<1800;i++){topic=frames.at(-1)?.topic;if(topic?.turns.at(-1).state!=='running'&&topic)break;await delay(100);}
    evidence.sideQuestion={id:answer.topicId,state:topic?.turns.at(-1).state,answer:topic?.turns.at(-1).a,error:topic?.turns.at(-1).error};
    evidence.mainUnchanged=before.equals(await readFile(state.sessionFile));
    await btw.close();btw=new BtwService(join(root,'btw'),{executable,cwd:root},frame=>frames.push(frame));
    await btw.ask('Double the number in your previous answer. Reply with the number only.',answer.topicId,'isolated-verification','PiAgent verification');
    for(let i=0;i<1800;i++){topic=frames.at(-1)?.topic;if(topic?.turns.length===2&&topic.turns[1].state!=='running')break;await delay(100);}
    evidence.followUp={state:topic?.turns[1]?.state,answer:topic?.turns[1]?.a};
    if(evidence.sideQuestion.state!=='done'||!evidence.mainUnchanged)throw new Error('Actual BTW model test failed: '+JSON.stringify(evidence.sideQuestion));
  }
  const output=resolve('artifacts/chat-ui-implementation');await mkdir(output,{recursive:true});await writeFile(join(output,'real-omp.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {await btw?.close();await omp.stop();await rm(root,{recursive:true,force:true});}
