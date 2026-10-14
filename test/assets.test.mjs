import test from 'node:test';
import assert from 'node:assert/strict';
import {collectAssets,loadLocalAssets} from '../src/assets.mjs';
import {selectSnapshot} from '../src/input.mjs';
import {fixture,frame} from './fixture.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
const snapshot=()=>selectSnapshot(fixture(frame('1:1',{children:[frame('2:1',{type:'VECTOR',children:[]})]})));
test('REST asset requests pin version; asset hosts never receive credential; bytes are hashed locally',async()=>{
  let calls=0;
  const fetchImpl=async(url,opts)=>{
    calls++;
    if(url.startsWith('https://api.figma.com/')) {
      assert.equal(new URL(url).searchParams.get('version'),'demo-1');assert.equal(opts.headers['X-Figma-Token'],'test-only');
      return Response.json({images:{'2:1':'https://cdn.example.test/image.png'}});
    }
    assert.equal(opts.headers,undefined);return new Response(png);
  };
  const r=await collectAssets(snapshot(),{token:'test-only',fetchImpl});assert.equal(calls,2);assert.equal(r.diagnostics.length,0);
  assert.equal(r.files[r.entries['2:1'].path].length,png.length);assert.ok(!JSON.stringify(r.entries).includes('https:'));
});
test('null render and failed download give explicit node-level diagnostics',async()=>{
  const r=await collectAssets(snapshot(),{token:'test-only',fetchImpl:async()=>Response.json({images:{'2:1':null}})});
  assert.equal(r.diagnostics[0].code,'ASSET_RENDER_EMPTY');assert.deepEqual(r.entries,{});
});
test('long render Retry-After is reported without sleeping or early retry',async()=>{
  let count=0;const r=await collectAssets(snapshot(),{token:'test-only',fetchImpl:async()=>{count++;return new Response('',{status:429,headers:{'retry-after':'120'}});},sleep:()=>{throw new Error('must not sleep');}});
  assert.equal(count,1);assert.match(r.diagnostics[0].message,/120 seconds/);
});
test('network errors cannot expose signed URLs or tokens in diagnostics',async()=>{
  const r=await collectAssets(snapshot(),{token:'test-only',fetchImpl:async()=>{throw new Error('https://secret.example/?token=private');}});
  assert.ok(!JSON.stringify(r).includes('private'));assert.equal(r.diagnostics[0].code,'ASSET_RENDER_FAILED');
});
test('local manifest resolves files and rejects escaping its directory',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'asset-test-'));
  try {
    await writeFile(path.join(dir,'pixel.png'),png);await writeFile(path.join(dir,'assets.json'),JSON.stringify({'2:1':'pixel.png'}));
    const r=await loadLocalAssets(path.join(dir,'assets.json'));assert.equal(r.entries['2:1'].bytes,png.length);
    await writeFile(path.join(dir,'assets.json'),JSON.stringify({entries:{'2:1':{path:'pixel.png',kind:'rendered-node',format:'png'}}}));
    const replay=await loadLocalAssets(path.join(dir,'assets.json'));assert.equal(replay.entries['2:1'].kind,'rendered-node');assert.equal(replay.entries['2:1'].format,'png');
    await writeFile(path.join(dir,'assets.json'),JSON.stringify({'2:1':'../outside.png'}));
    await assert.rejects(loadLocalAssets(path.join(dir,'assets.json')));
  } finally {await rm(dir,{recursive:true,force:true});}
});
