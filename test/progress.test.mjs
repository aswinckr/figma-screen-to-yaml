import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgress} from '../src/progress.mjs';
import {getScreen} from '../src/api.mjs';
import {collectAssets} from '../src/assets.mjs';

test('progress emits elapsed stages and heartbeat, then cleans up on close',()=>{
  let time=0,tick,cleared=false;const lines=[];
  const progress=createProgress({now:()=>time,write:s=>lines.push(s),setTimer:fn=>{tick=fn;return 1;},clearTimer:()=>{cleared=true;}});
  progress.update('Fetching');time=10000;tick();time=12000;progress.update('Writing');time=22000;tick();
  progress.close();tick();progress.update('Ignored');
  assert.deepEqual(lines,['[0s] Fetching','[10s] Still working: Fetching (10s in this stage)','[12s] Writing','[22s] Still working: Writing (10s in this stage)']);assert.ok(cleared);
});
test('network retry is reported before sleeping; status contains no credential or URL',async()=>{
  const lines=[];let calls=0;
  await getScreen({fileKey:'PRIVATE_FILE',nodeId:'1:2'},{token:'PRIVATE_TOKEN',onProgress:s=>lines.push(s),sleep:async()=>assert.match(lines.at(-1),/waiting 3s/),fetchImpl:async()=>calls++?Response.json({nodes:{'1:2':{document:{id:'1:2'}}}}):new Response('',{status:429,headers:{'retry-after':'3'}})});
  assert.match(lines.join('\n'),/attempt 2\/3/);assert.doesNotMatch(lines.join('\n'),/PRIVATE/);
});
test('asset progress reports totals and failure outcome, not download secrets',async()=>{
  const lines=[];const snapshot={fileKey:'PRIVATE_FILE',document:{id:'1:1'}};
  await collectAssets(snapshot,{nodeIds:['2:1'],token:'PRIVATE_TOKEN',onProgress:s=>lines.push(s),fetchImpl:async()=>Response.json({images:{'2:1':null}})});
  assert.match(lines[0],/Assets requested: 1/);assert.match(lines.at(-1),/0\/1 saved; 1 failures/);assert.doesNotMatch(lines.join('\n'),/PRIVATE/);
});
