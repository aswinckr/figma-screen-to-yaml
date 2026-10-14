import test from 'node:test';
import assert from 'node:assert/strict';
import {getScreen,parseFigmaUrl} from '../src/api.mjs';
const loc={fileKey:'FILE',nodeId:'1:2'};
const ok=()=>new Response(JSON.stringify({version:'v1',nodes:{'1:2':{document:{id:'1:2',type:'FRAME'}}}}),{status:200});
test('URL parser accepts selected screen links and normalizes node IDs',()=>{
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/FILE/name?node-id=1-2'),{...loc,version:undefined});
  assert.throws(()=>parseFigmaUrl('https://evil.example/design/FILE/name?node-id=1-2'),/Expected/);
  assert.throws(()=>parseFigmaUrl('https://figma.com/design/FILE/name'),/node-id/);
});
test('API requests preserve subtree, geometry and version; token only in header',async()=>{
  const data=await getScreen({...loc,version:'v0'},{token:'test-only',fetchImpl:async(url,options)=>{
    const parsed=new URL(url);assert.equal(parsed.searchParams.get('geometry'),'paths');assert.equal(parsed.searchParams.get('version'),'v0');
    assert.equal(parsed.searchParams.has('depth'),false);assert.equal(options.headers['X-Figma-Token'],'test-only');assert.ok(!url.includes('test-only'));
    assert.equal(options.redirect,'error');return ok();
  }});assert.equal(data._exportSource.fileKey,'FILE');
});
test('rate limits honor full short Retry-After',async()=>{
  let i=0;const waited=[];
  await getScreen(loc,{token:'test-only',sleep:async ms=>waited.push(ms),fetchImpl:async()=>i++?ok():new Response('',{status:429,headers:{'Retry-After':'3'}})});
  assert.deepEqual(waited,[3000]);
});
test('long Retry-After fails with guidance instead of retrying early',async()=>{
  await assert.rejects(getScreen(loc,{token:'test-only',fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':'300'}})}),/300 seconds/);
});
test('access denied, null nodes and absent credentials fail clearly',async()=>{
  await assert.rejects(getScreen(loc,{}),/FIGMA_TOKEN/);
  await assert.rejects(getScreen(loc,{token:'test-only',fetchImpl:async()=>new Response('',{status:403})}),/denied/);
  await assert.rejects(getScreen(loc,{token:'test-only',fetchImpl:async()=>new Response(JSON.stringify({nodes:{'1:2':null}}))}),/not returned/);
});
