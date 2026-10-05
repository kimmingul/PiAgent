interface Line {text:string;unterminated:boolean;}
interface Edit extends Line {kind:' '|'+'|'-';}
const decode=(bytes:Buffer):string=>new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes);
const lines=(text:string):Line[]=>{
  if(!text)return [];
  const parts=text.split('\n');if(text.endsWith('\n'))parts.pop();
  return parts.map((value,index)=>({text:value,unterminated:index===parts.length-1&&!text.endsWith('\n')}));
};
const key=(line:Line):string=>(line.unterminated?line.text:line.text.replace(/\r$/,''))+(line.unterminated?'\0':'');
const format=(text:string):string=>{const crlf=(text.match(/\r\n/g)??[]).length,lf=(text.match(/(?<!\r)\n/g)??[]).length;return `${crlf} CRLF / ${lf} LF`;};
/** Readable review, with byte-affecting line endings explicitly disclosed. Not an applyable patch. */
export function changeDiff(path:string,before:Buffer,after:Buffer):string {
  const old=decode(before),next=decode(after),left=lines(old),right=lines(next),edits:Edit[]=[];
  const add=(kind:Edit['kind'],line:Line):void=>{edits.push({...line,kind});};
  let formattingChanged=false;
  const equal=(a:Line,b:Line):void=>{if(a.text!==b.text)formattingChanged=true;add(' ',a);};
  let prefix=0;while(prefix<left.length&&prefix<right.length&&key(left[prefix]!)===key(right[prefix]!)){equal(left[prefix]!,right[prefix]!);prefix++;}
  let suffix=0;while(suffix<left.length-prefix&&suffix<right.length-prefix&&key(left[left.length-1-suffix]!)===key(right[right.length-1-suffix]!))suffix++;
  const a=left.slice(prefix,left.length-suffix),b=right.slice(prefix,right.length-suffix);
  // Bound memory/time even for adversarial 32 KiB files containing thousands of short lines.
  if((a.length+1)*(b.length+1)<=1_000_000){
    const width=b.length+1,table=new Uint32Array((a.length+1)*width);
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i*width+j]=key(a[i]!)===key(b[j]!)?table[(i+1)*width+j+1]!+1:Math.max(table[(i+1)*width+j]!,table[i*width+j+1]!);
    let i=0,j=0;while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&key(a[i]!)===key(b[j]!)){equal(a[i++]!,b[j++]!);}
      else if(i<a.length&&(j===b.length||table[(i+1)*width+j]!>=table[i*width+j+1]!))add('-',a[i++]!);
      else add('+',b[j++]!);
    }
  }else{for(const line of a)add('-',line);for(const line of b)add('+',line);}
  for(let i=0;i<suffix;i++)equal(left[left.length-suffix+i]!,right[right.length-suffix+i]!);
  const notes:string[]=[];
  if(old.replaceAll('\r\n','\n')!==old||next.replaceAll('\r\n','\n')!==next){
    const style=(text:string):string=>text.includes('\r\n')?( /(?<!\r)\n/.test(text)?'mixed':'CRLF'):(text.includes('\n')?'LF':'none');
    if(formattingChanged||style(old)!==style(next))notes.push(`줄바꿈 변경: ${format(old)} → ${format(next)}`);
  }
  const output=[...notes,`--- a/${path}`,`+++ b/${path}`];
  const ranges:{start:number;end:number}[]=[];
  for(let i=0;i<edits.length;i++)if(edits[i]!.kind!==' '){const start=Math.max(0,i-3),end=Math.min(edits.length,i+4),previous=ranges.at(-1);if(previous&&start<=previous.end)previous.end=end;else ranges.push({start,end});}
  let oldLine=1,newLine=1,cursor=0;
  for(const range of ranges){
    for(;cursor<range.start;cursor++){if(edits[cursor]!.kind!=='+')oldLine++;if(edits[cursor]!.kind!=='-')newLine++;}
    const slice=edits.slice(range.start,range.end),oldCount=slice.filter(line=>line.kind!=='+').length,newCount=slice.filter(line=>line.kind!=='-').length;
    output.push(`@@ -${oldCount?oldLine:oldLine-1},${oldCount} +${newCount?newLine:newLine-1},${newCount} @@`);
    for(const line of slice){output.push(line.kind+line.text.replaceAll('\r','␍').replaceAll('\ufeff','⟨BOM⟩'));if(line.unterminated)output.push('\\ No newline at end of file');if(line.kind!=='+')oldLine++;if(line.kind!=='-')newLine++;}cursor=range.end;
  }
  if(!ranges.length&&!before.equals(after))output.push('본문은 동일하며 위에 표시한 줄바꿈 형식만 변경됩니다.');
  return output.join('\n');
}
