import {english} from './messages.en.js';
/** PiAgent-owned messages only. Model replies, code, credentials and tool results stay untouched. */
let language='ko';
type Label={source:string;args:unknown[];host?:boolean};
const labels=new Map<string,Label>();
const nodeLabels=new WeakMap<HTMLElement,Label>();
const nodeAttributes=new WeakMap<HTMLElement,Label>();
const renderLabel=(record:Label):string=>record.host?hostText(record.source):t(record.source,...record.args);
export function resolveLanguage(value:unknown,systemLanguage:string):string {
 if(typeof value==='string'&&['ko','en','ja','de','fr'].includes(value))return value;
 return /^ko(?:[-_]|$)/i.test(systemLanguage)?'ko':'en';
}
export function setLanguage(value:string):void {
 language=value;
 if(typeof document==='undefined')return;
 for(const node of Array.from(document.querySelectorAll<HTMLElement>('[data-piagent-label]'))){
  const record=nodeLabels.get(node)??labels.get(node.dataset['piagentLabel']!);
  if(record)node.textContent=renderLabel(record);
 }
 for(const node of Array.from(document.querySelectorAll<HTMLElement>('[data-piagent-attribute]'))){
  const record=nodeAttributes.get(node)??labels.get(node.dataset['piagentAttribute']!);
  if(record)node.setAttribute(node.dataset['piagentAttributeName']!,renderLabel(record));
 }
}
export function t(source:string,...args:unknown[]):string {
 const pattern=language==='ko'?source:english[source]??source;
 const text=args.length?pattern.replace(/\{(\d+)\}/g,(_,index:string)=>String(args[Number(index)]??'')):pattern;
 if(labels.size>1024)labels.delete(labels.keys().next().value!);
 if(Object.hasOwn(english,source))labels.set(text,{source,args});
 return text;
}
export function label(node:HTMLElement,text:string):void {
 node.textContent=text;
 delete node.dataset['piagentLabel'];
 nodeLabels.delete(node);
 if(!labels.has(text)&&Object.hasOwn(english,text))t(text);
 const record=labels.get(text);
 if(record){nodeLabels.set(node,record);node.dataset['piagentLabel']=text;node.textContent=renderLabel(record);}
}
export function attribute(node:HTMLElement,name:string,text:string):void {
 node.setAttribute(name,text);
 const record=labels.get(text);
 if(record){nodeAttributes.set(node,record);node.dataset['piagentAttribute']=text;node.dataset['piagentAttributeName']=name;}
}
export function hostText(value:unknown):string {
 const text=String(value??''),record=labels.get(text);
 if(record&&!record.host)return t(record.source,...record.args);
 const source=record?.source??text;
 const translated=source.split('\n').map(line=>t(line)).join('\n');
 if(source.includes('\n')&&source.split('\n').some(line=>Object.hasOwn(english,line)))labels.set(translated,{source,args:[],host:true});
 return translated;
}
/** Latest preference wins even when an earlier startup request finishes later. */
export function languageLoader<T>(load:(lang:string)=>Promise<T>,apply:(lang:string,items:T)=>void):(lang:string)=>Promise<void> {
 let generation=0;
 return async lang=>{
  const current=++generation;setLanguage(lang);
  try{const items=await load(lang);if(current===generation)apply(lang,items);}
  catch {if(lang!=='en'&&current===generation){try{const items=await load('en');if(current===generation)apply(lang,items);}catch{/* The current controls stay usable. */}}}
 };
}
