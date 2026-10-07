import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {english} from '../ui/dist/messages.en.js';
import {resolveLanguage,setLanguage,t,hostText,label,languageLoader} from '../ui/dist/i18n.js';
import {Controller} from '../ui/dist/controller.js';

test('automatic language follows Korean Windows only; explicit choices override the system',()=>{
 for(const system of ['en-US','ja-JP','de-DE','fr-FR','unknown',''])assert.equal(resolveLanguage('auto',system),'en');
 for(const system of ['ko-KR','ko','KO-kr'])assert.equal(resolveLanguage('auto',system),'ko');
 assert.equal(resolveLanguage('en','ko-KR'),'en');assert.equal(resolveLanguage('ko','en-US'),'ko');
 assert.equal(resolveLanguage('invalid','en-US'),'en');assert.equal(resolveLanguage('ja','ko-KR'),'ja');
});
test('added UI translations cover every source message and preserve template placeholders',async()=>{
 const files=['account','bridge','controller','execution','git','interactions','roles','settings'];
 for(const name of files){
  const file=ts.createSourceFile(name,await readFile(new URL(`../ui/src/${name}.ts`,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='t'){
   const key=node.arguments[0].text;assert.ok(Object.hasOwn(english,key),`${name}: ${key}`);
  }ts.forEachChild(node,visit);};visit(file);
 }
 const placeholders=value=>[...value.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
 for(const[source,value]of Object.entries(english)){assert.ok(value.trim());assert.deepEqual(placeholders(value),placeholders(source),source);}
});
test('late startup translations cannot overwrite the saved language; a missing locale falls back safely',async()=>{
 const resolvers={},applied=[];
 const change=languageLoader(lang=>new Promise(resolve=>resolvers[lang]=resolve),(lang,items)=>applied.push([lang,items]));
 const startup=change('ko'),saved=change('en');resolvers.en('English');await saved;resolvers.ko('Korean');await startup;
 assert.deepEqual(applied,[['en','English']]);assert.equal(t('언어'),'Language');
 const fallback=languageLoader(async lang=>{if(lang==='ko')throw Error('missing');return 'fallback';},(lang,items)=>applied.push([lang,items]));
 await fallback('ko');assert.deepEqual(applied.at(-1),['ko','fallback']);setLanguage('ko');
});
test('English recovery and designer guidance keep user data and executable choices intact',()=>{
 setLanguage('en');try{
  const frames=[],sent=[];
  const c=new Controller(frame=>sent.push(frame),{emit:frame=>frames.push(frame),list(){},capabilities(){}});
  c.action({t:'unsupported'});assert.equal(frames.at(-1).text,'This feature is unavailable on the current connection.');
  c.receive({type:'session',sessionId:'locale'});c.action({t:'submit',id:'draft',text:'한국어 코드 {0}'});
  assert.equal(sent.at(-1).message,'한국어 코드 {0}');
  assert.match(hostText('폼 디자이너 조회 승인: 현재 프로젝트의 열린 폼과 컴포넌트 속성을 읽습니다. 폼을 변경하거나 저장하지 않습니다.'),/^Approve form designer inspection/);
  assert.match(hostText('OMP 전역 설정 · 표시값은 유효 설정 (프로젝트·환경변수 우선)'),/^OMP global settings/);
  assert.match(hostText('OMP 프로젝트 역할 설정을 저장했습니다. 새 대화에서 적용을 확인하세요. 환경변수와 runtime 설정이 우선할 수 있습니다.'),/^Saved project OMP model roles/);
  assert.equal(hostText('Unknown OMP diagnostic {0}'),'Unknown OMP diagnostic {0}');
 }finally{setLanguage('ko');}
});
test('switching languages updates owned labels without replacing inputs or disabled approval buttons',()=>{
 const button={dataset:{},disabled:true,textContent:'',setAttribute(name,value){this[name]=value;}},input={value:'unsaved draft'};
 globalThis.document={querySelectorAll:selector=>selector==='[data-piagent-label]'?[button]:[]};
 try{setLanguage('ko');label(button,t('확인'));setLanguage('en');assert.equal(button.textContent,'Confirm');assert.equal(button.disabled,true);assert.equal(input.value,'unsaved draft');
 label(button,'Provider-specific error');setLanguage('ko');assert.equal(button.textContent,'Provider-specific error');}
 finally{delete globalThis.document;setLanguage('ko');}
});
