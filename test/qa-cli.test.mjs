import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {frame,fixture} from './fixture.mjs';
import {restoreQATree} from '../src/qa.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const read=(out,name)=>JSON.parse(readFileSync(path.join(out,name),'utf8'));
const invoke=(args,extra={})=>spawnSync(process.execPath,[path.join(project,'src/cli.mjs'),...args],{cwd:project,encoding:'utf8',...extra});

test('full QA CLI preserves all source data, validates the new schema and replays byte-for-byte',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'qa-cli-'));
 try{
  const raw=fixture(frame('1:1',{children:[frame('2:1',{visible:false,cornerRadius:8}),frame('2:2',{type:'TEXT',characters:'Text',style:{fontFamily:'Inter',fontSize:16},styles:{text:'text-style'}})]}));
  raw.nodes['1:1'].styles={'text-style':{name:'Text/Base',key:'text-key',styleType:'TEXT'}};
  const source=path.join(temp,'raw.json');writeFileSync(source,JSON.stringify(raw));
  const a=path.join(temp,'a'),b=path.join(temp,'b');
  const first=invoke(['export','--input',source,'--profile','qa','--strict','--out',a]);
  assert.equal(first.status,2,first.stderr);assert.equal(invoke(['validate',path.join(a,'screen.yaml')]).status,0);
  const doc=YAML.parse(readFileSync(path.join(a,'screen.yaml'),'utf8'));assert.deepEqual(restoreQATree(doc),raw.nodes['1:1'].document);
  assert.equal(doc.catalogs.styles['text-style'].name,'Text/Base');assert.equal(doc.hiddenNodes.length,1);
  assert.equal(read(a,'manifest.json').profile,'qa');assert.equal(read(a,'diagnostics.json').summary.yamlBytes,readFileSync(path.join(a,'screen.yaml')).length);
  assert.equal(invoke(['export','--input',path.join(a,'raw.figma.json'),'--profile','qa','--out',b]).status,0);
  for(const f of readdirSync(a))assert.deepEqual(readFileSync(path.join(a,f)),readFileSync(path.join(b,f)),f);
  assert.equal(invoke(['export','--input',source,'--profile','qa','--out',a]).status,1);
  assert.equal(invoke(['export','--input',source,'--profile','qa','--sizing','responsive','--out',path.join(temp,'bad')]).status,1);
 }finally{rmSync(temp,{recursive:true,force:true});}
});

function live(temp,denied){
 const raw=fixture(frame('1:1',{fills:[{type:'SOLID',color:{r:1,g:0,b:0,a:1},boundVariables:{color:{type:'VARIABLE_ALIAS',id:'red'}}}],explicitVariableModes:{c:'m'},cornerRadius:8}));
 const catalog={meta:{variables:{red:{id:'red',name:'Colors/Brand',resolvedType:'COLOR',variableCollectionId:'c',valuesByMode:{m:{r:1,g:0,b:0,a:1}}}},variableCollections:{c:{id:'c',name:'Theme',defaultModeId:'m',modes:[{modeId:'m',name:'Light'}]}}}};
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4eoAAAAASUVORK5CYII=';
 const mock=path.join(temp,'fetch.mjs');writeFileSync(mock,`globalThis.fetch=async(url,opts)=>{
 const u=new URL(url);
 if(u.pathname.endsWith('/nodes'))return Response.json(${JSON.stringify(raw)});
 if(u.pathname.endsWith('/variables/local'))return ${denied?"Response.json({err:'Missing scope file_variables:read'},{status:403})":'Response.json('+JSON.stringify(catalog)+')'};
 if(u.pathname.startsWith('/v1/images/')){if(u.searchParams.get('ids')!=='1:1')throw Error('Per-node asset request');return Response.json({images:{'1:1':'https://assets.example/frame.png'}});}
 if(u.hostname==='assets.example'){if(opts.headers?.['X-Figma-Token'])throw Error('Leaked token');return new Response(Buffer.from('${png}','base64'));}
 throw Error('Unexpected request');};`);
 return mock;
}
for(const denied of [false,true])test(`live full QA resolves non-spacing bindings or records access denial (denied=${denied})`,()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'qa-live-'));
 try{
  const mock=live(temp,denied),out=path.join(temp,'a');
  const r=spawnSync(process.execPath,['--import',mock,path.join(project,'src/cli.mjs'),'export','https://www.figma.com/design/DEMOFILE/test?node-id=1-1','--profile','qa','--reference','--out',out],{cwd:temp,encoding:'utf8',env:{...process.env,FIGMA_TOKEN:'TEST_SECRET'}});
  assert.equal(r.status,0,r.stderr);const doc=YAML.parse(readFileSync(path.join(out,'screen.yaml'),'utf8'));const token=Object.values(doc.catalogs.tokenResolutions)[0];
  assert.ok(readFileSync(path.join(out,'reference.png')).length);
  if(denied){assert.equal(token.reason,'catalog-unavailable');assert.equal(read(out,'diagnostics.json').items.find(i=>i.code==='VARIABLES_UNAVAILABLE').access.cause,'missing-scope');}
  else{
   assert.equal(token.name,'Colors/Brand');assert.equal(token.status,'resolved');assert.equal(read(out,'manifest.json').variableSource.versionPinned,false);
   const second=path.join(temp,'b');const replay=invoke(['export','--input',path.join(out,'raw.figma.json'),'--profile','qa','--reference','--variables',path.join(out,'variables.json'),'--asset-manifest',path.join(out,'assets.json'),'--out',second]);assert.equal(replay.status,0,replay.stderr);
   for(const f of readdirSync(out).filter(n=>n!=='assets'))assert.deepEqual(readFileSync(path.join(out,f)),readFileSync(path.join(second,f)),f);
  }
  assert.ok(!readFileSync(path.join(out,'screen.yaml'),'utf8').includes('TEST_SECRET'));
 }finally{rmSync(temp,{recursive:true,force:true});}
});
