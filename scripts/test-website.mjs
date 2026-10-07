import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

const root = resolve('website');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  if (target.startsWith('#')) {
    if (target.length > 1) assert.ok(html.includes(`id="${target.slice(1)}"`), `Missing anchor ${target}`);
  } else if (!/^[a-z]+:/i.test(target)) assert.ok(existsSync(resolve(root, target)), `Missing asset ${target}`);
}
const {version}=JSON.parse(readFileSync(resolve('package.json'),'utf8'));
assert.ok(html.includes(`releases/download/v${version}/PiAgent-Setup-${version}.exe`));
assert.ok(html.includes(`releases/tag/v${version}`));
assert.ok(html.includes('<link rel="canonical" href="https://kimmingul.github.io/PiAgent/">'));
assert.ok(!/PiAgent-site|비공개 저장소|private repository/.test(html));
const translations = [...html.matchAll(/data-ko="([^"]*)" data-en="([^"]*)"/g)].map(([,ko,en]) => ({dataset:{ko,en},innerHTML:ko}));
assert.ok(translations.length > 35);
function fixture({url='https://kimmingul.github.io/PiAgent/',saved=null,system='ko-KR',blocked=false}={}){
const attributes=Object.fromEntries(['Label','Title','Content','Href'].map(suffix=>[suffix,[...html.matchAll(new RegExp(`data-ko-${suffix.toLowerCase()}="([^"]*)" data-en-${suffix.toLowerCase()}="([^"]*)"`,'g'))].map(([,ko,en])=>({dataset:{['ko'+suffix]:ko,['en'+suffix]:en},setAttribute(key,value){this[key]=value;}}))]));
const buttons = Object.fromEntries(['#theme','#language'].map(id => [id,{addEventListener(type, fn){this.click=fn;},setAttribute(){}}]));
const document = {documentElement:{dataset:{}},querySelector:id=>buttons[id],querySelectorAll:selector=>selector==='[data-ko][data-en]'?translations:attributes[selector.match(/ko-(.*?)\]/)[1].replace(/^./,c=>c.toUpperCase())]};
const storage={value:saved,getItem(){if(blocked)throw Error('blocked');return this.value;},setItem(key,value){if(blocked)throw Error('blocked');this.value=value;}};
const location={href:url};
runInNewContext(readFileSync(resolve(root,'app.js'),'utf8'),{document,URL,location,navigator:{language:system},localStorage:storage,history:{replaceState(a,b,value){location.href=value;}},matchMedia:()=>({matches:false,addEventListener(){}})});
return {document,buttons,storage,location,attributes};
}
const {document,buttons,storage,location,attributes}=fixture();
assert.equal(document.documentElement.dataset.theme,'light');
buttons['#theme'].click(); assert.equal(document.documentElement.dataset.theme,'dark');
buttons['#theme'].click(); assert.equal(document.documentElement.dataset.theme,'light');
buttons['#language'].click(); assert.equal(document.documentElement.lang,'en');
for(const item of translations) assert.equal(item.innerHTML,item.dataset.en);
assert.equal(storage.value,'en');assert.ok(location.href.includes('lang=en'));
assert.equal(attributes.Content[0].content,attributes.Content[0].dataset.enContent);
assert.ok(attributes.Href[0].href.endsWith('README.en.md'));
buttons['#language'].click(); assert.equal(document.documentElement.lang,'ko');
for(const item of translations) assert.equal(item.innerHTML,item.dataset.ko);
assert.equal(fixture({saved:'en'}).document.documentElement.lang,'en');
assert.equal(fixture({url:'https://kimmingul.github.io/PiAgent/?lang=en#download',saved:'ko'}).document.documentElement.lang,'en');
assert.equal(fixture({system:'ja-JP'}).document.documentElement.lang,'en');
const denied=fixture({blocked:true,system:'en-US'});denied.buttons['#language'].click();assert.equal(denied.document.documentElement.lang,'ko');
const deep=fixture({url:'https://kimmingul.github.io/PiAgent/?lang=ko&from=test#download'});deep.buttons['#language'].click();assert.ok(deep.location.href.endsWith('lang=en&from=test#download'));
console.log('PASS website assets, anchors, release links, language persistence, direct links, metadata, guides and themes');
