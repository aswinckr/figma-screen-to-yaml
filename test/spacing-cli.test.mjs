import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {frame,fixture} from './fixture.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const read=(out,name)=>JSON.parse(readFileSync(path.join(out,name),'utf8'));
const invoke=(args,extra={})=>spawnSync(process.execPath,[path.join(project,'src/cli.mjs'),...args],{cwd:project,encoding:'utf8',...extra});

test('spacing CLI round-trips compact YAML, retains raw source, counts removals and refuses overwrite',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'spacing-cli-'));
  try {
    const source=path.join(temp,'raw.json');
    const raw=fixture(frame('1:1',{children:[frame('2:1',{visible:false,children:[frame('3:1')]}),frame('2:2')]}));
    writeFileSync(source,JSON.stringify(raw));
    const one=path.join(temp,'one'),two=path.join(temp,'two');
    for(const out of [one,two]) {
      const r=invoke(['export','--input',source,'--profile','spacing','--out',out,'--strict']);
      assert.equal(r.status,0,r.stderr);
      assert.match(r.stdout,/2 hidden source nodes excluded/);
      assert.equal(invoke(['validate',path.join(out,'screen.yaml')]).status,0);
    }
    for(const file of readdirSync(one))assert.deepEqual(readFileSync(path.join(one,file)),readFileSync(path.join(two,file)));
    assert.deepEqual(read(one,'raw.figma.json'),raw);
    const stats=read(one,'diagnostics.json').summary;
    assert.equal(stats.extractedNodes,4);assert.equal(stats.emittedNodes,2);
    assert.equal(stats.yamlBytes,readFileSync(path.join(one,'screen.yaml')).length);
    assert.equal(invoke(['export','--input',source,'--profile','spacing','--out',one]).status,1);
    assert.equal(invoke(['export','--input',source,'--profile','spacing','--sizing','responsive','--out',path.join(temp,'bad')]).status,1);
  } finally {rmSync(temp,{recursive:true,force:true});}
});

test('offline reference request cannot silently succeed without an image',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'spacing-reference-'));
  try {
    const out=path.join(temp,'out');
    const r=invoke(['export','--input','examples/screen.figma.json','--profile','spacing','--reference','--strict','--out',out]);
    assert.equal(r.status,2,r.stderr);
    assert.equal(read(out,'diagnostics.json').summary.counts.REFERENCE_NOT_EXPORTED,1);
  } finally {rmSync(temp,{recursive:true,force:true});}
});

// Mock at fetch boundary, exercising the real CLI options, export pipeline,
// image writes and token failures without accessing any private Figma file.
function mockLive(temp,{denyVariables=false}={}) {
  const raw=fixture(frame('1:1',{paddingLeft:12,explicitVariableModes:{c:'default'},
    boundVariables:{paddingLeft:{type:'VARIABLE_ALIAS',id:'spacing12'}},
    children:[frame('2:1',{type:'VECTOR'})]}));
  const variables={variables:{spacing12:{id:'spacing12',name:'spacing/st',resolvedType:'FLOAT',variableCollectionId:'c',valuesByMode:{default:12}}},
    variableCollections:{c:{id:'c',name:'Spacing',defaultModeId:'default',modes:[{modeId:'default',name:'Default'}]}}};
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4eoAAAAASUVORK5CYII=';
  const mock=path.join(temp,'fetch.mjs');
  writeFileSync(mock,`globalThis.fetch=async(url,options)=>{
    const u=new URL(url);
    if(u.pathname.endsWith('/nodes'))return Response.json(${JSON.stringify(raw)});
    if(u.pathname.endsWith('/variables/local'))return ${denyVariables?"new Response('',{status:403})":'Response.json({meta:'+JSON.stringify(variables)+'})'};
    if(u.pathname.startsWith('/v1/images/')){
      if(u.searchParams.get('ids')!=='1:1')throw new Error('Unexpected per-node assets');
      return Response.json({images:{'1:1':'https://assets.example/reference.png'}});
    }
    if(u.hostname==='assets.example'){
      if(options.headers?.['X-Figma-Token'])throw new Error('Credential leaked to asset host');
      return new Response(Buffer.from('${png}','base64'));
    }
    throw new Error('Unexpected request');
  };`);
  return {mock,png};
}
test('live spacing export downloads only the frame, resolves names, and replays entirely offline',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'spacing-live-'));
  try {
    const {mock,png}=mockLive(temp),one=path.join(temp,'one'),two=path.join(temp,'two');
    const r=spawnSync(process.execPath,['--import',mock,path.join(project,'src/cli.mjs'),'export',
      'https://www.figma.com/design/DEMOFILE/screen?node-id=1-1','--profile','spacing','--reference','--no-assets','--strict','--out',one],
      {cwd:temp,encoding:'utf8',env:{...process.env,FIGMA_TOKEN:'TEST_ONLY'}});
    assert.equal(r.status,0,r.stderr);
    assert.deepEqual(readFileSync(path.join(one,'reference.png')),Buffer.from(png,'base64'));
    const screen=YAML.parse(readFileSync(path.join(one,'screen.yaml'),'utf8'));
    assert.equal(screen.body[0].box.spacingTokens.paddingLeft.name,'spacing/st');
    assert.equal(screen.body[0].box.spacingTokens.paddingLeft.status,'resolved');
    assert.equal(read(one,'measurements.json').nodes.length,2);
    const replay=invoke(['export','--input',path.join(one,'raw.figma.json'),'--profile','spacing',
      '--variables',path.join(one,'variables.json'),'--asset-manifest',path.join(one,'assets.json'),
      '--reference','--strict','--out',two],{cwd:temp,env:{...process.env,FIGMA_TOKEN:''}});
    assert.equal(replay.status,0,replay.stderr);
    for(const file of readdirSync(one).filter(n=>n!=='assets'))assert.deepEqual(readFileSync(path.join(one,file)),readFileSync(path.join(two,file)),file);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('denied Variables API preserves numeric spacing, reference image and explicit diagnostics',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'spacing-denied-'));
  try {
    const {mock}=mockLive(temp,{denyVariables:true}),out=path.join(temp,'out');
    const r=spawnSync(process.execPath,['--import',mock,path.join(project,'src/cli.mjs'),'export',
      'https://www.figma.com/design/DEMOFILE/screen?node-id=1-1','--profile','spacing','--reference','--strict','--out',out],
      {cwd:temp,encoding:'utf8',env:{...process.env,FIGMA_TOKEN:'TEST_ONLY'}});
    assert.equal(r.status,2,r.stderr);
    const screen=YAML.parse(readFileSync(path.join(out,'screen.yaml'),'utf8'));
    assert.equal(screen.body[0].box.layout.padding[3],12);
    assert.equal(screen.body[0].box.spacingTokens.paddingLeft.status,'unresolved');
    assert.equal(read(out,'diagnostics.json').summary.counts.VARIABLES_UNAVAILABLE,1);
    assert.ok(readFileSync(path.join(out,'reference.png')).length>0);
    assert.ok(!readFileSync(path.join(out,'diagnostics.json'),'utf8').includes('TEST_ONLY'));
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('render profile supports reference-only export with --no-assets',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'render-reference-'));
  try {
    const {mock}=mockLive(temp),out=path.join(temp,'out');
    const r=spawnSync(process.execPath,['--import',mock,path.join(project,'src/cli.mjs'),'export',
      'https://www.figma.com/design/DEMOFILE/screen?node-id=1-1','--no-assets','--reference','--out',out],
      {cwd:temp,encoding:'utf8',env:{...process.env,FIGMA_TOKEN:'TEST_ONLY'}});
    assert.equal(r.status,0,r.stderr);assert.ok(readFileSync(path.join(out,'reference.png')).length>0);
    assert.equal(read(out,'diagnostics.json').summary.counts.ASSET_NOT_EXPORTED,1);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
