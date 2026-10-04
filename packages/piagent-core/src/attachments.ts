import {lstat,open,realpath} from 'node:fs/promises';
import {extname,isAbsolute} from 'node:path';
export interface Image {type:'image';data:string;mimeType:string;}
/** Adapter-selected paths remain references; supported image files become bounded RPC images. */
export async function images(paths:string[]):Promise<Image[]> {
  const result:Image[]=[];let total=0;
  for(const path of paths){
    if(!/\.(png|jpe?g|gif|webp)$/i.test(path))continue;
    if(!isAbsolute(path))throw new Error('Image attachments require absolute adapter-selected paths');
    const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>512*1024||await realpath(path)!==path)throw new Error('Images must be regular files up to 512 KiB');
    const handle=await open(path,'r');let data:Buffer;
    try{const before=await handle.stat();data=Buffer.alloc(stat.size+1);const {bytesRead}=await handle.read(data,0,data.length,0);const after=await handle.stat();if(before.ino!==stat.ino||before.dev!==stat.dev||bytesRead!==stat.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('Image changed during read');data=data.subarray(0,bytesRead);}finally{await handle.close();}
    const suffix=extname(path).toLowerCase();let mimeType:string;
    if(suffix==='.png'&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mimeType='image/png';
    else if(['.jpg','.jpeg'].includes(suffix)&&data[0]===255&&data[1]===216&&data[2]===255)mimeType='image/jpeg';
    else if(suffix==='.gif'&&['GIF87a','GIF89a'].includes(data.subarray(0,6).toString('ascii')))mimeType='image/gif';
    else if(suffix==='.webp'&&data.subarray(0,4).toString('ascii')==='RIFF'&&data.subarray(8,12).toString('ascii')==='WEBP')mimeType='image/webp';
    else throw new Error('Image type does not match file contents');
    const encoded=data.toString('base64');total+=encoded.length;if(total>700000||result.length>=8)throw new Error('Image payload exceeds 700 KiB or eight images');result.push({type:'image',data:encoded,mimeType});
  }return result;
}
