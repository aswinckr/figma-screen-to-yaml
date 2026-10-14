import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/exporter.mjs';
import {selectSnapshot} from '../src/input.mjs';
import {validateScreen} from '../src/validation.mjs';
import {frame,button,fixture} from './fixture.mjs';

function setup(extraChildren=[]) {
  const n=button('2:1',{children:[
    frame('3:1',{type:'TEXT',name:'Title',characters:'Actual overridden dish'}),
    frame('3:2',{type:'TEXT',name:'Price',characters:'€12.25'}),
    frame('3:3',{name:'Photo'}),
    frame('3:4',{visible:false,children:[frame('4:1',{type:'TEXT',name:'Price',characters:'€7.20'})]}),
    ...extraChildren,
  ]});
  const snapshot=selectSnapshot(fixture(frame('1:1',{children:[n]})));
  const mapping={version:1,entries:[{match:{componentKey:'demo-button-key'},target:'productlist',failClosed:true,
    propBindings:{items:[{id:{$source:{field:'id'}},name:{$source:{selector:{name:'Title'},field:'characters'}},
      price:{$source:{selector:{name:'Price'},field:'characters'}},imageSrc:{$source:{selector:{name:'Photo'},asset:true}},
      featured:{$source:{selector:{name:'Featured'},exists:true}},quantity:0,disabled:false}]}}]};
  const assets={'3:3':{path:'assets/photo.png'}};
  return {snapshot,mapping,assets};
}
test('structured items use visible instance text and asset props, preserving nested types and provenance',()=>{
  const {snapshot,mapping,assets}=setup();const r=compile(snapshot,{mapping,assets});
  assert.deepEqual(r.screen.body[0].children[0].children[0].props.items,[{id:'2:1',name:'Actual overridden dish',price:'€12.25',imageSrc:{$asset:'assets/photo.png'},featured:false,quantity:0,disabled:false}]);
  assert.ok(r.measurements.componentReads.some(x=>x.sourceNodeId==='3:2'&&x.field==='characters'));
  assert.ok(!r.measurements.componentReads.some(x=>x.sourceNodeId==='4:1'));validateScreen(r.screen);
});
test('ambiguous required binding keeps generic source instead of silently dropping an item',()=>{
  const {snapshot,mapping,assets}=setup([frame('3:5',{type:'TEXT',name:'Price',characters:'€99'})]);
  const r=compile(snapshot,{mapping,assets});
  assert.ok(r.diagnostics.items.some(d=>d.code==='AMBIGUOUS_BINDING'));
  assert.ok(r.diagnostics.items.some(d=>d.code==='MAPPING_FALLBACK'));
  assert.equal(r.measurements.boundaries.length,0);assert.equal(r.measurements.componentReads.length,0);
  assert.equal(r.screen.body[0].children[0].children[1].children[0].text,'€12.25');
});
test('missing required asset requests export and keeps generic source until bytes are available',()=>{
  const {snapshot,mapping}=setup();const r=compile(snapshot,{mapping});
  assert.ok(r.diagnostics.items.some(d=>d.code==='ASSET_NOT_EXPORTED'&&d.nodeId==='3:3'));
  assert.ok(r.diagnostics.items.some(d=>d.code==='MAPPING_FALLBACK'));assert.equal(r.measurements.boundaries.length,0);
});
test('each builds typed objects in visible authored order, not hidden defaults',()=>{
  const {snapshot,mapping,assets}=setup();mapping.entries[0].propBindings={tabs:{$each:{selector:{type:'TEXT'},value:{label:{$source:{field:'characters'}},enabled:true}}}};
  const r=compile(snapshot,{mapping,assets});
  assert.deepEqual(r.screen.body[0].children[0].children[0].props.tabs,[{label:'Actual overridden dish',enabled:true},{label:'€12.25',enabled:true}]);
});
test('explicit child index distinguishes same-named siblings without guessing by content',()=>{
  const {snapshot,mapping,assets}=setup([frame('3:5',{name:'Discount',children:[frame('4:2',{type:'TEXT',name:'Percentage',characters:'30%'}),frame('4:3',{type:'TEXT',name:'Percentage',characters:'off'})]})]);
  mapping.entries[0].propBindings={discount:{$source:{selector:{name:'Percentage',childIndex:0},field:'characters'}}};
  assert.equal(compile(snapshot,{mapping,assets}).screen.body[0].children[0].children[0].props.discount,'30%');
});
test('instance-swap bindings cannot turn main-component IDs into overridden content',()=>{
  const {snapshot,mapping,assets}=setup();snapshot.document.children[0].componentProperties.Swap={type:'INSTANCE_SWAP',value:'99:1'};
  mapping.entries[0].propBindings={content:{$source:{property:'Swap'}}};const r=compile(snapshot,{mapping,assets});
  assert.ok(r.diagnostics.items.some(d=>d.code==='INSTANCE_SWAP_NEEDS_SLOT_RULE'));assert.equal(r.measurements.boundaries.length,0);
});
test('unknown expressions and unsupported fields fail explicitly',()=>{
  const {snapshot,mapping,assets}=setup();mapping.entries[0].propBindings={bad:{$source:{field:'children'}}};
  assert.throws(()=>compile(snapshot,{mapping,assets}),/field must/);
  mapping.entries[0].propBindings.bad={$source:{field:'name',evaluate:'run code'}};
  assert.throws(()=>compile(snapshot,{mapping,assets}),/Unknown/);
});
