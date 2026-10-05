import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const {version}=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid PiAgent release version');
const target=new URL('packages/piagent-protocol/src/version.ts',root);
const source=`// Generated from the root package.json by scripts/generate-version.mjs.\nexport const CORE_VERSION = '${version}';\n`;
if(await readFile(target,'utf8').catch(()=> '')!==source)await writeFile(target,source);
