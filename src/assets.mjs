import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {walk} from './input.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');

// TemPad assets/plan.ts informed classification; REST render requests replace its
// live node.exportAsync. Store local bytes, never expiring service URLs in YAML.
export function assetNodes(snapshot) {
  return [...walk(snapshot.document)].filter(n=>
    ['VECTOR','BOOLEAN_OPERATION','ELLIPSE','STAR','POLYGON'].includes(n.type) ||
    (n.fills || []).some(p=>p.visible!==false && p.type==='IMAGE'));
}
export async function collectAssets(snapshot,{token,fetchImpl=fetch,reference=false,nodeIds,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const entries={},files={},diagnostics=[];
  const ids=[...new Set([...(nodeIds || assetNodes(snapshot).map(n=>n.id)),...(reference?[snapshot.document.id]:[])])];
  if(!ids.length)return {entries,files,diagnostics};
  if(!token || !snapshot.fileKey)throw new Error('Asset export needs FIGMA_TOKEN and a source file key.');
  for(let offset=0;offset<ids.length;offset+=25) {
    const batch=ids.slice(offset,offset+25);
    const query=new URLSearchParams({ids:batch.join(','),format:'png',scale:'1',use_absolute_bounds:'true'});
    if(snapshot.version)query.set('version',snapshot.version);
    let payload;
    try {
      for(let attempt=0;attempt<3;attempt++) {
        const response=await fetchImpl(`https://api.figma.com/v1/images/${encodeURIComponent(snapshot.fileKey)}?${query}`,{
          headers:{'X-Figma-Token':token},redirect:'error',signal:AbortSignal.timeout(60000)});
        if(response.status===429) {
          const value=response.headers.get('retry-after');
          const seconds=value && /^\d+(\.\d+)?$/.test(value)?Number(value):NaN;
          if(!Number.isFinite(seconds) || seconds>30 || attempt===2)throw new Error(`Rate limited; retry ${Number.isFinite(seconds)?`after ${seconds} seconds`:'later'}.`);
          await sleep(seconds*1000);continue;
        }
        if(!response.ok)throw new Error(`Render API HTTP ${response.status}.`);
        payload=await response.json();if(payload.err || !payload.images)throw new Error('Invalid render response.');break;
      }
    } catch(error) {
      const message=/^(Rate limited|Render API HTTP|Invalid render)/.test(error.message)?error.message:'Render request failed.';
      batch.forEach(id=>diagnostics.push({severity:'warning',code:'ASSET_RENDER_FAILED',nodeId:id,message}));continue;
    }
    for(const id of batch) {
      const url=payload.images[id];
      if(!url){diagnostics.push({severity:'warning',code:'ASSET_RENDER_EMPTY',nodeId:id,message:'Figma returned no rendered image (possibly hidden/empty).'});continue;}
      try {
        const parsed=new URL(url);if(parsed.protocol!=='https:' || parsed.username || parsed.password)throw new Error('Invalid image URL');
        // Never send the API token to the asset host.
        const response=await fetchImpl(url,{signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw new Error('Download failed');
        const chunks=[];let size=0;
        for await(const chunk of response.body){size+=chunk.length;if(size>50*1024*1024)throw new Error('Asset exceeds 50 MB');chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);
        if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid PNG');
        const sha256=hash(bytes),filename=`assets/${sha256}.png`;files[filename]=bytes;
        entries[id]={path:filename,sha256,bytes:bytes.length,kind:'rendered-node',format:'png',sourceNodeId:id};
      } catch {diagnostics.push({severity:'warning',code:'ASSET_DOWNLOAD_FAILED',nodeId:id,message:'Could not download a valid PNG; retry export. Service URL omitted.'});}
    }
  }
  return {entries,files,diagnostics};
}
export async function loadLocalAssets(manifestPath) {
  const base=await realpath(path.dirname(path.resolve(manifestPath)));
  const input=JSON.parse(await readFile(manifestPath,'utf8'));const entries={},files={};
  for(const [nodeId,item] of Object.entries(input.entries || input)) {
    const file=typeof item==='string'?item:item.path;
    if(typeof file!=='string')throw new Error('Asset entry needs a path.');
    const resolved=await realpath(path.resolve(base,file));
    if(!resolved.startsWith(base+path.sep))throw new Error('Local asset paths must stay inside the manifest directory.');
    const bytes=await readFile(resolved),ext=path.extname(resolved).toLowerCase();
    if(!['.png','.jpg','.jpeg','.svg','.webp'].includes(ext))throw new Error('Only image files are accepted as assets.');
    const sha256=hash(bytes),filename=`assets/${sha256}${ext}`;files[filename]=bytes;
    entries[nodeId]={path:filename,sha256,bytes:bytes.length,
      kind:item.kind==='rendered-node'?'rendered-node':'user-supplied',
      ...(item.format?{format:item.format}:{}),sourceNodeId:nodeId};
  }
  return {entries,files,diagnostics:[]};
}
