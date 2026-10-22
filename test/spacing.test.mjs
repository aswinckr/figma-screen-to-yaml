import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {compile, relativeBounds} from '../src/exporter.mjs';
import {selectSnapshot} from '../src/input.mjs';
import {validateScreen} from '../src/validation.mjs';
import {frame, button, fixture, mapping} from './fixture.mjs';

const run = (root, options = {}) => compile(selectSnapshot(fixture(root)), {profile:'spacing', ...options});
function boxes(screen) {
  const result=[];
  function visit(node) { if(node.box)result.push(node.box); (node.children||[]).forEach(visit); }
  screen.body.forEach(visit);return result;
}
test('audit prunes inherited hidden subtrees, preserves offscreen and transparent layout, and keeps full facts', () => {
  const hidden=frame('2:1',{visible:false,children:[frame('3:1',{visible:true})]});
  const offscreen=frame('2:2',{relativeTransform:[[1,0,0],[0,1,9000]]});
  const transparent=frame('2:3',{opacity:0});
  const r=run(frame('1:1',{children:[hidden,offscreen,transparent]}));
  assert.deepEqual(boxes(r.screen).map(b=>b.source.nodeId),['1:1','2:2','2:3']);
  assert.equal(r.facts.nodes.length,5);
  assert.equal(r.diagnostics.summary.hiddenNodesExcluded,2);
  assert.equal(r.screen.body[0].children[0].box.source.childIndex,1);
  assert.ok(r.diagnostics.items.some(d=>d.code==='TRANSPARENT_LAYOUT'));
  validateScreen(YAML.parse(YAML.stringify(r.screen)));
});
test('audit includes mapped component internals without applying outer padding twice', () => {
  const r=run(frame('1:1',{children:[button()]}),{mapping});
  const b=r.screen.body[0].children[0];
  assert.equal(b.box.source.mappedTarget,'button-small');
  assert.equal(b.box.source.name,'Renamed by designer');
  assert.equal(b.box.layout.padding[3],99);
  assert.equal(b.children[0].box.source.nodeId,'2:2');
  assert.equal(b.children[0].children[0].text,'Internal label');
  assert.equal(r.measurements.nodes.length,r.facts.nodes.length);
  validateScreen(r.screen);
});
test('downloaded images never change audit structure or geometry', () => {
  const root=frame('1:1',{fills:[{type:'IMAGE',imageRef:'fixture'}],children:[button()]});
  const plain=run(root,{mapping});
  const image=run(root,{mapping,assets:{'1:1':{kind:'rendered-node',path:'assets/frame.png'}}});
  assert.deepEqual(image.screen,plain.screen);
  assert.deepEqual(image.measurements,plain.measurements);
  assert.equal(boxes(image.screen).length,3);
  assert.ok(!image.diagnostics.items.some(d=>d.code==='ASSET_NOT_EXPORTED'));
});
test('identity survives changed text and duplicate layer names', () => {
  const r=run(frame('1:1',{children:[
    frame('2:1',{name:'Title',type:'TEXT',characters:'Figma copy'}),
    frame('2:2',{name:'Title',type:'TEXT',characters:'Different copy'}),
  ]}));
  const [a,b]=r.screen.body[0].children;
  assert.equal(a.box.source.name,b.box.source.name);
  assert.notEqual(a.box.source.nodeId,b.box.source.nodeId);
  assert.equal(a.box.source.parentId,'1:1');
  assert.equal(a.children[0].text,'Figma copy');
});
test('paint is omitted but text metrics, raw stroke geometry and zero spacing survive', () => {
  const r=run(frame('1:1',{itemSpacing:0,paddingTop:0,children:[frame('2:1',{
    type:'TEXT',characters:'Line one\nLine two',style:{fontSize:16,lineHeightPx:22,fontWeight:600},
    fills:[{type:'SOLID',color:{r:1,g:0,b:0}}],strokeWeight:2,strokeAlign:'CENTER',
    strokesIncludedInLayout:true,effects:[{type:'DROP_SHADOW',offset:{x:2,y:2},radius:8}],
  })]}));
  const b=r.screen.body[0].children[0].box;
  assert.equal(b.style.lineHeight,'22px');assert.equal(b.style.fontSize,'16px');
  assert.equal(b.style.color,undefined);assert.equal(b.style.boxShadow,undefined);
  assert.equal(b.source.strokeWeight,2);assert.equal(b.source.strokeAlign,'CENTER');
  assert.equal(r.screen.body[0].box.layout.gap,0);assert.equal(r.screen.body[0].box.layout.padding[0],0);
  validateScreen(r.screen);
});
test('negative gaps retain visible authored order after hidden and absolute siblings', () => {
  const r=run(frame('1:1',{itemSpacing:-8,children:[frame('2:1'),
    frame('2:2',{visible:false}),frame('2:3',{layoutPositioning:'ABSOLUTE'}),frame('2:4')]}));
  const children=r.screen.body[0].children;
  assert.equal(children.length,3);assert.equal(children[1].box.style.marginTop,undefined);
  assert.equal(children[2].box.style.marginTop,'-8px');
  assert.equal(r.screen.body[0].box.source.itemSpacing,-8);
});
test('wrapped rows, exact grid tracks and transforms survive the compact profile', () => {
  const rotated=frame('2:2',{layoutPositioning:'ABSOLUTE',relativeTransform:[[0,-1,30],[1,0,10]],size:{x:20,y:10}});
  const grid=frame('2:1',{layoutMode:'GRID',gridColumnsSizing:'20px 40px',gridRowsSizing:'50px',gridColumnGap:8,gridRowGap:4});
  const root=frame('1:1',{layoutMode:'HORIZONTAL',layoutWrap:'WRAP',counterAxisSpacing:16,children:[grid,rotated]});
  const r=run(root),normal=compile(selectSnapshot(fixture(root)));
  assert.deepEqual(r.measurements.nodes,normal.measurements.nodes);
  assert.equal(r.screen.body[0].box.style.rowGap,'16px');
  assert.equal(r.screen.body[0].children[0].box.style.gridTemplateColumns,'20px 40px');
  const box=r.screen.body[0].children[1].box;
  assert.equal(box.style.transform,'matrix(0, 1, -1, 0, 0, 0)');
  assert.deepEqual(relativeBounds(rotated,root),{x:20,y:10,width:10,height:20});
  validateScreen(r.screen);
});
test('audit diagnoses unknown visibility, unsupported masks and missing grid tracks', () => {
  const r=compile(selectSnapshot({id:'1:1',type:'FRAME',width:100,height:100,layoutMode:'GRID',isMask:true}),{profile:'spacing'});
  assert.equal(r.screen.body[0].box.source.visible,null);
  for(const code of ['VISIBILITY_UNKNOWN','MASK_NOT_COMPILED','GRID_TRACKS_MISSING'])assert.ok(r.diagnostics.items.some(d=>d.code===code));
  assert.throws(()=>run(frame('1:1',{visible:false})),/hidden/);
  assert.throws(()=>run(frame('1:1'),{sizing:'responsive'}),/snapshot/);
});
test('audit schema rejects missing identity, hidden nodes and broken parent relationships', () => {
  const s=run(frame('1:1',{children:[frame('2:1')]})).screen;
  const missing=structuredClone(s);delete missing.body[0].box.source;
  assert.throws(()=>validateScreen(missing),/schema/);
  const hidden=structuredClone(s);hidden.body[0].box.source.visible=false;
  assert.throws(()=>validateScreen(hidden),/Hidden/);
  const broken=structuredClone(s);broken.body[0].children[0].box.source.parentId='wrong';
  assert.throws(()=>validateScreen(broken),/parent mismatch/);
});
test('synthetic hidden-heavy export shrinks while retained source measurements stay identical', () => {
  const root=frame('1:1',{children:[frame('2:1',{visible:false,children:
    Array.from({length:100},(_,i)=>frame(`3:${i}`,{type:'TEXT',characters:'Hidden keyboard key'}))}),frame('2:2')]});
  const snapshot=selectSnapshot(fixture(root)),full=compile(snapshot),audit=compile(snapshot,{profile:'spacing'});
  assert.ok(Buffer.byteLength(YAML.stringify(audit.screen))<Buffer.byteLength(YAML.stringify(full.screen))*0.15);
  assert.deepEqual(audit.measurements.nodes,full.measurements.nodes.filter(n=>n.effectiveVisible!==false));
  assert.deepEqual(audit.facts,full.facts);
});
