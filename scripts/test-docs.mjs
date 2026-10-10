import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
const pairs=[['README.md','README.en.md'],['docs/INSTALLATION.md','docs/INSTALLATION.en.md'],['docs/UNIFIED-INSTALLER.ko.md','docs/UNIFIED-INSTALLER.md'],['docs/RAD-DESIGNER-DIAGNOSTICS.md','docs/RAD-DESIGNER-DIAGNOSTICS.en.md'],['docs/RELEASE-0.9.18.md','docs/RELEASE-0.9.18.en.md'],['docs/RELEASE-0.9.19.md','docs/RELEASE-0.9.19.en.md'],['docs/LOCALIZATION.md','docs/LOCALIZATION.en.md']];
pairs.push(['docs/GETTING-STARTED.ko.md','docs/GETTING-STARTED.en.md']);
pairs.push(['docs/RELEASE-0.9.20.md','docs/RELEASE-0.9.20.en.md']);
pairs.push(['docs/RELEASE-0.10.0.md','docs/RELEASE-0.10.0.en.md']);
pairs.push(['docs/VS-INTELLIGENCE.md','docs/VS-INTELLIGENCE.en.md']);
pairs.push(['docs/IDE-AGENT-ROADMAP.md','docs/IDE-AGENT-ROADMAP.en.md']);
pairs.push(['docs/IDE-AGENT-INTEGRATION.md','docs/IDE-AGENT-INTEGRATION.en.md']);
pairs.push(['docs/IDE-BENCHMARK.md','docs/IDE-BENCHMARK.en.md']);
pairs.push(['docs/RELEASE-0.11.0.md','docs/RELEASE-0.11.0.en.md']);
pairs.push(['docs/RELEASE-0.11.1.md','docs/RELEASE-0.11.1.en.md']);
for(const pair of pairs){
 const blocks=[];
 for(const file of pair){
  const text=readFileSync(file,'utf8').replaceAll('\r\n','\n');
  for(const[,target]of text.matchAll(/\]\(([^)]+)\)/g)){
   if(/^[a-z]+:|^#/i.test(target))continue;
   assert.ok(existsSync(resolve(dirname(file),target.split('#')[0])),`${file}: ${target}`);
  }
  blocks.push([...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm)].filter(m=>/^(powershell|bash|sh|json)?$/.test(m[1])).map(m=>m[2].split(/\r?\n/).filter(line=>line.trim()&&!/^\s*#/.test(line)).join('\n')));
 }
 assert.deepEqual(blocks[0],blocks[1],`Command examples differ: ${pair.join(' / ')}`);
}
const {version}=JSON.parse(readFileSync('package.json','utf8'));
for(const file of ['README.md','README.en.md','docs/INSTALLATION.md','docs/INSTALLATION.en.md','docs/UNIFIED-INSTALLER.md','docs/UNIFIED-INSTALLER.ko.md','docs/README.md'])assert.ok(readFileSync(file,'utf8').includes(version),`${file}: current version missing`);
console.log('PASS bilingual guide links, matching command examples and current versions');
