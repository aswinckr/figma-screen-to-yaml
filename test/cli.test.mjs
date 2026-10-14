import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
const project=fileURLToPath(new URL('../',import.meta.url));
const invoke=(args,extra={})=>spawnSync(process.execPath,['src/cli.mjs',...args],{cwd:project,encoding:'utf8',...extra});

test('CLI offline bundle is deterministic, validates, discovers, and refuses overwrite',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'figma-yaml-test-'));
  try {
    const args=['export','--input','examples/screen.figma.json','--mapping','examples/components.json'];
    for(const dir of ['one','two']) {
      const r=invoke([...args,'--out',path.join(temp,dir),'--strict']);assert.equal(r.status,0,r.stderr);
    }
    for(const name of readdirSync(path.join(temp,'one'))) assert.equal(readFileSync(path.join(temp,'one',name),'utf8'),readFileSync(path.join(temp,'two',name),'utf8'));
    const measurements=YAML.parse(readFileSync(path.join(temp,'one','measurements.yaml'),'utf8'));
    assert.equal(measurements.nodes.length,5);
    assert.equal(invoke(['validate',path.join(temp,'one','screen.yaml')]).status,0);
    const dup=invoke([...args,'--out',path.join(temp,'one')]);assert.equal(dup.status,1);assert.match(dup.stderr,/already exists/);
    const discovery=invoke(['discover','--input','examples/screen.figma.json','--out',path.join(temp,'discovery')]);assert.equal(discovery.status,0,discovery.stderr);
    const catalog=JSON.parse(readFileSync(path.join(temp,'discovery','components.discovered.json'),'utf8'));
    assert.equal(catalog.entries[0].target,null);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('CLI strict mode writes useful diagnostics, then exits 2 for unknown components',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'figma-yaml-test-'));
  try {
    const r=invoke(['export','--input','examples/screen.figma.json','--out',path.join(temp,'unknown'),'--strict']);
    assert.equal(r.status,2,r.stderr);
    const d=JSON.parse(readFileSync(path.join(temp,'unknown','diagnostics.json'),'utf8'));
    assert.ok(d.summary.counts.UNMAPPED_COMPONENT>0);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('CLI live mode without a credential gives setup instructions without making a request',()=>{
  const r=invoke(['export','https://www.figma.com/design/FILE/test?node-id=1-2','--out',path.join(tmpdir(),`no-token-${process.pid}`)],{env:{...process.env,FIGMA_TOKEN:''}});
  assert.equal(r.status,1);assert.match(r.stderr,/Set FIGMA_TOKEN/);
});
test('rich CLI demo packages local image slots and replays offline without losing assets',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'figma-rich-test-'));
  try {
    const one=path.join(temp,'one'),two=path.join(temp,'two');
    const r=invoke(['export','--input','examples/rich.figma.json','--mapping','examples/rich.mapping.json','--asset-manifest','examples/assets.json','--out',one,'--strict']);assert.equal(r.status,0,r.stderr);
    const replay=invoke(['export','--input',path.join(one,'raw.figma.json'),'--mapping','examples/rich.mapping.json','--asset-manifest',path.join(one,'assets.json'),'--out',two,'--strict']);assert.equal(replay.status,0,replay.stderr);
    for(const name of ['screen.yaml','facts.json','assets.json','manifest.json'])assert.equal(readFileSync(path.join(one,name),'utf8'),readFileSync(path.join(two,name),'utf8'));
    const screen=YAML.parse(readFileSync(path.join(one,'screen.yaml'),'utf8'));
    const product=screen.body[0].children[2].children[0];assert.equal(product.slots.price.$component,'price');
    assert.ok(readFileSync(path.join(one,product.slots.photo.$image.src),'utf8').startsWith('<svg'));
  } finally {rmSync(temp,{recursive:true,force:true});}
});
