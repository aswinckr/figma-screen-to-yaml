import test from 'node:test';
import assert from 'node:assert/strict';
import {getVariables, normalizeVariables, resolveSpacingTokens, hasSpacingBindings} from '../src/variables.mjs';
import {compile} from '../src/exporter.mjs';
import {selectSnapshot} from '../src/input.mjs';
import {frame, fixture} from './fixture.mjs';
import {validateScreen} from '../src/validation.mjs';

export const catalog=()=>({variables:{
  semantic:{id:'semantic',key:'semantic-key',name:'spacing/st',resolvedType:'FLOAT',variableCollectionId:'c',valuesByMode:{light:{type:'VARIABLE_ALIAS',id:'base'},compact:8}},
  base:{id:'base',name:'spacing/12',resolvedType:'FLOAT',variableCollectionId:'c',valuesByMode:{light:12,compact:8}},
},variableCollections:{c:{id:'c',name:'Spacing',defaultModeId:'light',modes:[{modeId:'light',name:'Default'},{modeId:'compact',name:'Compact'}]}}});
const node=()=>frame('1:1',{paddingLeft:12,boundVariables:{paddingLeft:{type:'VARIABLE_ALIAS',id:'semantic'}}});

test('token names follow bindings, aliases and inherited collection modes, never numeric guesses',()=>{
  const root=frame('0:1',{explicitVariableModes:{c:'light'},children:[node()]});
  const r=compile(selectSnapshot(fixture(root)),{profile:'spacing',variables:catalog()});
  const token=r.screen.body[0].children[0].box.spacingTokens.paddingLeft;
  assert.equal(token.name,'spacing/st');assert.equal(token.status,'resolved');
  assert.equal(token.resolvedValue,12);assert.deepEqual(token.aliasChain.map(v=>v.id),['semantic','base']);
  assert.equal(r.screen.body[0].children[0].box.layout.padding[3],12);
  assert.deepEqual(resolveSpacingTokens({paddingLeft:12},catalog(),{c:'light'}),{});
  validateScreen(r.screen);
});
test('explicit child mode overrides ancestor; defaults outside captured context are not asserted as verified',()=>{
  const child=node();child.explicitVariableModes={c:'compact'};child.paddingLeft=8;
  const r=compile(selectSnapshot(fixture(frame('0:1',{explicitVariableModes:{c:'light'},children:[child]}))),{profile:'spacing',variables:catalog()});
  assert.equal(r.screen.body[0].children[0].box.spacingTokens.paddingLeft.resolvedValue,8);
  assert.equal(resolveSpacingTokens(node(),catalog()).paddingLeft.status,'mode-unverified');
});
test('missing catalogs, missing variables, alias cycles and mismatches never replace authored values',()=>{
  assert.equal(resolveSpacingTokens(node(),null).paddingLeft.reason,'catalog-unavailable');
  const missing=catalog();delete missing.variables.base;
  assert.equal(resolveSpacingTokens(node(),missing,{c:'light'}).paddingLeft.reason,'variable-missing');
  const cycle=catalog();cycle.variables.base.valuesByMode.light={type:'VARIABLE_ALIAS',id:'semantic'};
  assert.equal(resolveSpacingTokens(node(),cycle,{c:'light'}).paddingLeft.reason,'alias-cycle');
  const mismatch=resolveSpacingTokens(node(),catalog(),{c:'compact'}).paddingLeft;
  assert.equal(mismatch.status,'value-mismatch');assert.equal(mismatch.value,12);assert.equal(mismatch.resolvedValue,8);
});
test('invalid variable data and missing mode values fail explicitly',()=>{
  assert.throws(()=>normalizeVariables({}),/catalog/);
  const bad=catalog();bad.variables.semantic.id='different';assert.throws(()=>normalizeVariables(bad),/entry/);
  assert.equal(resolveSpacingTokens(node(),catalog(),{c:'absent'}).paddingLeft.reason,'mode-value-missing');
  const missing=catalog();delete missing.variables.semantic.valuesByMode.light;
  assert.equal(resolveSpacingTokens(node(),missing,{c:'light'}).paddingLeft.reason,'mode-value-missing');
});
test('bindings exclusively inside hidden trees do not trigger variable API requests',()=>{
  const n=node();n.visible=false;
  assert.equal(hasSpacingBindings({document:frame('0:1',{children:[n]})}),false);
});
test('variable API handles scope denial without leaking token or URL',async()=>{
  await assert.rejects(getVariables('FILE',{token:'SECRET',fetchImpl:async()=>new Response('',{status:403})}),/file_variables:read/);
  await assert.rejects(getVariables('FILE',{token:'SECRET',fetchImpl:async()=>{throw new Error('https://secret?token=SECRET');}}),error=>!error.message.includes('SECRET'));
});
test('variable API sends credentials only in headers and honors rate limits',async()=>{
  let attempts=0,waited=0;
  const result=await getVariables('FILE',{token:'SECRET',sleep:async ms=>{waited=ms;},fetchImpl:async(url,opts)=>{
    assert.ok(!url.includes('SECRET'));assert.equal(opts.headers['X-Figma-Token'],'SECRET');assert.equal(opts.redirect,'error');
    if(attempts++===0)return new Response('',{status:429,headers:{'retry-after':'2'}});
    return Response.json({meta:catalog()});
  }});
  assert.equal(waited,2000);assert.deepEqual(result,catalog());
  await assert.rejects(getVariables('FILE',{token:'SECRET',sleep:()=>assert.fail('must not retry early'),fetchImpl:async()=>new Response('',{status:429,headers:{'retry-after':'90'}})}),/90 seconds/);
});
