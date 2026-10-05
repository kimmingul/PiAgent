import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [, ,command,action,key,value]=process.argv;const path=join(process.cwd(),'config.yml');const config=JSON.parse(readFileSync(path,'utf8'));const emit=value=>console.log(JSON.stringify(value));
if(command==='models'){emit({models:[{selector:'fixture/reasoning',name:'Reasoning',kind:'chat',thinking:['low','high']},{selector:'fixture/image',name:'Image',kind:'image',thinking:null}]});}
else if(command==='config'&&action==='path')console.log(process.cwd());
else if(action==='list')emit(Object.fromEntries(Object.entries(config).map(([key,value])=>[key,{value,type:typeof value==='boolean'?'boolean':'record',description:'Fixture setting'}])));
else if(action==='get')emit({value:config[key]??(key==='cycleOrder'?[]:{})});
else if(action==='set'){config[key]=JSON.parse(value);writeFileSync(path,JSON.stringify(config));emit({value:config[key]});}
else process.exit(1);
