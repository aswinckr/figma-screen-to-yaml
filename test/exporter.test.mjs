import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {compile,relativeBounds,digest} from '../src/exporter.mjs';
import {selectSnapshot,discover} from '../src/input.mjs';
import {validateScreen} from '../src/validation.mjs';
import {fixture,frame,button,mapping} from './fixture.mjs';
const run=(root,options={mapping})=>compile(selectSnapshot(fixture(root)),options);

test('authored outer padding and gap are preserved; mapped internal spacing is excluded',()=>{
  const r=run(); const root=r.screen.body[0],boundary=root.children[0];
  assert.deepEqual(root.box.layout.padding,[16,16,16,16]);assert.equal(root.box.layout.gap,12);
  assert.equal(boundary.box.layout,undefined);assert.equal(boundary.children[0].component,'button-small');
  assert.equal(r.measurements.nodes.length,2);assert.equal(r.diagnostics.summary.excludedComponentInternalNodes,1);
  assert.equal(r.diagnostics.items.length,0);validateScreen(r.screen);
});
test('literal text, boolean false and null survive YAML serialization',()=>{
  const r=run();const parsed=YAML.parse(YAML.stringify(r.screen));validateScreen(parsed);
  const c=parsed.body[0].children[0].children[0];assert.equal(c.text,'Pay: "now"\nNext line');
  assert.equal(c.props.disabled,false);assert.equal(c.props.startContent,null);assert.equal(c.props.fullWidth,false);
});
test('measured edge distance does not replace authored padding',()=>{
  const r=run(frame('1:1',{layoutMode:'NONE',children:[button()]}));
  assert.equal(r.screen.body[0].box.layout,undefined);
  assert.equal(r.measurements.nodes[1].measuredEdgeDistances.left,16);
  assert.equal(r.screen.body[0].children[0].box.style.left,'16px');
});
test('zero gaps and padding are preserved',()=>{
  const r=run(frame('1:1',{paddingTop:0,paddingRight:0,paddingBottom:0,paddingLeft:0,itemSpacing:0}));
  assert.deepEqual(r.screen.body[0].box.layout.padding,[0,0,0,0]);assert.equal(r.screen.body[0].box.layout.gap,0);
});
test('hidden nodes stay in provenance and do not become visible grid containers',()=>{
  const r=run(frame('1:1',{visible:false,layoutMode:'GRID',gridColumnsSizing:'1fr 1fr',children:[button()]}));
  assert.equal(r.screen.body[0].box.style.display,'none');assert.equal(r.measurements.nodes[1].effectiveVisible,false);
});
test('free positioned children retain stacking order and negative overlap',()=>{
  const r=run(frame('1:1',{layoutMode:'NONE',children:[button('2:1',{relativeTransform:[[1,0,0],[0,1,200]]}),
    button('2:3',{relativeTransform:[[1,0,16],[0,1,-40]],children:[]})]}));
  assert.equal(r.measurements.nodes[1].figmaNodeId,'2:1');assert.equal(r.screen.body[0].children[1].box.style.top,'-40px');
  assert.equal(r.measurements.nodes[2].measuredEdgeDistances.top,-40);
});
test('absolute children are not counted as consecutive auto-layout gaps',()=>{
  const r=run(frame('1:1',{children:[button(),button('2:3',{layoutPositioning:'ABSOLUTE',children:[]})]}));
  assert.equal(r.screen.body[0].children[1].box.style.position,'absolute');assert.equal(r.measurements.siblingGaps.length,0);
});
test('GRID uses exact tracks/gaps and placement rather than guessed flex',()=>{
  const r=run(frame('1:1',{layoutMode:'GRID',gridColumnsSizing:'160px 1fr',gridColumnGap:8,gridRowGap:16,
    children:[button('2:1',{gridColumnAnchorIndex:1,gridRowAnchorIndex:0,gridColumnSpan:1})]}));
  assert.equal(r.screen.body[0].box.style.display,'grid');assert.equal(r.screen.body[0].box.style.gridTemplateColumns,'160px 1fr');
  assert.equal(r.screen.body[0].children[0].box.style.gridColumn,'2 / span 1');assert.equal(r.screen.body[0].box.layout.direction,undefined);
});
test('missing GRID track sizes are diagnosed, not replaced by equal tracks',()=>{
  const r=run(frame('1:1',{layoutMode:'GRID',gridColumnCount:2}));
  assert.equal(r.screen.body[0].box.style.gridTemplateColumns,undefined);assert.ok(r.diagnostics.items.some(d=>d.code==='GRID_TRACKS_MISSING'));
});
test('wrapped negative gaps are reported, not emitted as invalid CSS gap',()=>{
  const r=run(frame('1:1',{itemSpacing:-8,layoutWrap:'WRAP'}));assert.equal(r.screen.body[0].box.layout.gap,undefined);
  assert.equal(r.measurements.nodes[0].layout.itemSpacing,-8);assert.ok(r.diagnostics.items.some(d=>d.code==='NEGATIVE_GAP'));
});
test('unknown wrapper instance traverses to known nested library instance',()=>{
  const r=run(frame('1:1',{children:[frame('3:1',{type:'INSTANCE',componentId:'unknown',children:[button()]})]}));
  assert.equal(r.diagnostics.summary.recognizedComponents,1);assert.ok(r.diagnostics.items.some(d=>d.code==='UNMAPPED_COMPONENT'));
});
test('missing text is not fabricated from layer name',()=>{
  const r=run(frame('1:1',{children:[frame('2:1',{type:'TEXT',name:'Not actual text'})]}));
  assert.equal(r.screen.body[0].children[0].children.length,0);assert.ok(r.diagnostics.items.some(d=>d.code==='MISSING_TEXT'));
});
test('incomplete uploaded-style data stays explicitly incomplete',()=>{
  const raw={id:'1:1',name:'RDP',type:'FRAME',width:375,height:600,layoutMode:'VERTICAL',itemSpacing:8,children:[]};
  const r=compile(selectSnapshot(raw));assert.equal(r.measurements.nodes[0].effectiveVisible,null);
  assert.equal(r.screen.body[0].box.layout.padding,undefined);assert.ok(r.diagnostics.items.some(d=>d.code==='MISSING_PADDING'));
});
test('component keys work when layer names change; file-scoped IDs cannot leak across files',()=>{
  const s=selectSnapshot(fixture());assert.equal(compile(s,{mapping}).diagnostics.summary.recognizedComponents,1);
  const local={version:1,entries:[{match:{componentId:'10:1',fileKey:'OTHERFILE'},target:'button'}]};
  assert.equal(compile(s,{mapping:local}).diagnostics.summary.recognizedComponents,0);
});
test('ambiguous mappings fail rather than choose order-dependent matches',()=>{
  assert.throws(()=>run(undefined,{mapping:{version:1,entries:[mapping.entries[0],mapping.entries[0]]}}),/Ambiguous/);
});
test('discovery is unapproved, includes identity and exact property values',()=>{
  const d=discover(selectSnapshot(fixture()),[{component:'Button',spec:'button.spec.yaml'}]);
  assert.equal(d.entries[0].target,null);assert.equal(d.entries[0].match.componentKey,'demo-button-key');
  assert.deepEqual(d.entries[0].propertyValues['Disabled#11:1'],[false]);assert.equal(d.entries[0].specCandidates.length,1);
});
test('identical snapshot and mapping yield identical output without timestamps',()=>{
  assert.equal(JSON.stringify(run()),JSON.stringify(run()));
  assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
});
test('rotated geometry uses all four corners in parent coordinates',()=>{
  const b=relativeBounds(frame('2:1',{size:{x:20,y:10},relativeTransform:[[0,-1,50],[1,0,5]]}),frame('1:1'));
  assert.deepEqual(b,{x:40,y:5,width:10,height:20});
});
test('absolute bounds alone are not mislabeled as local geometry',()=>{
  const n={id:'2:1',absoluteBoundingBox:{x:50,y:20,width:10,height:10}};
  const p={id:'1:1',absoluteBoundingBox:{x:0,y:0,width:100,height:100}};
  assert.equal(relativeBounds(n,p),null);
});
test('duplicate source IDs and malformed templates are rejected',()=>{
  assert.throws(()=>selectSnapshot(fixture(frame('1:1',{children:[button(),button()]}))),/Duplicate/);
  assert.throws(()=>run(undefined,{mapping,template:{component:'Button'}}),/Template/);
});
test('schema rejects invented fields and duplicate YAML IDs',()=>{
  const s=run().screen;s.body[0].box.layout.fakePadding=2;assert.throws(()=>validateScreen(s),/schema/);
  const t=run().screen;t.body.push(t.body[0]);assert.throws(()=>validateScreen(t),/Duplicate/);
});
