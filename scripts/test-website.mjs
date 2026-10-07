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
assert.ok(html.includes('비공개 저장소의 다운로드는 GitHub 접근 권한이 필요합니다.'));
const translations = [...html.matchAll(/data-ko="([^"]*)" data-en="([^"]*)"/g)].map(([,ko,en]) => ({dataset:{ko,en},innerHTML:ko}));
assert.ok(translations.length > 35);
const buttons = Object.fromEntries(['#theme','#language'].map(id => [id,{addEventListener(type, fn){this.click=fn;},setAttribute(){}}]));
const document = {documentElement:{dataset:{}},querySelector:id=>buttons[id],querySelectorAll:()=>translations};
runInNewContext(readFileSync(resolve(root,'app.js'),'utf8'),{document,matchMedia:()=>({matches:false,addEventListener(){}})});
assert.equal(document.documentElement.dataset.theme,'light');
buttons['#theme'].click(); assert.equal(document.documentElement.dataset.theme,'dark');
buttons['#theme'].click(); assert.equal(document.documentElement.dataset.theme,'light');
buttons['#language'].click(); assert.equal(document.documentElement.lang,'en');
for(const item of translations) assert.equal(item.innerHTML,item.dataset.en);
buttons['#language'].click(); assert.equal(document.documentElement.lang,'ko');
for(const item of translations) assert.equal(item.innerHTML,item.dataset.ko);
console.log('PASS website assets, anchors, release links, bilingual toggle and theme toggle');
