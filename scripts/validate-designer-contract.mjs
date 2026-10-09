// Replay raw captured adapter payloads through Core without SDK side effects.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateDesignerContract} from '../tests/helpers/designer-contract.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/validate-designer-contract.mjs <raw-json> [--allow-missing-restore]');
try{
 const emitted=JSON.parse((await readFile(resolve(file),'utf8')).replace(/^\uFEFF/,''));
 const result=await validateDesignerContract(emitted,{allowMissingRestore:process.argv.includes('--allow-missing-restore')});
 console.log(JSON.stringify({scope:'Raw adapter payload/Core contract replay; SDK mutation simulated; clock fixed at capture',...result}));if(!result.complete)process.exitCode=2;
}catch(error){console.error(JSON.stringify({complete:false,error:String(error.message).slice(0,500)}));process.exitCode=1;}
