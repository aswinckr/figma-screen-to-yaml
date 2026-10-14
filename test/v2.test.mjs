import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {compile} from '../src/exporter.mjs';
import {selectSnapshot} from '../src/input.mjs';
import {validateScreen,validateExternal} from '../src/validation.mjs';
import {textRuns} from '../src/visuals.mjs';
import {frame,button,fixture,mapping} from './fixture.mjs';

test('mapped component internals, hidden nodes and unknown fields survive full fact extraction',()=>{
  const n=button();n.children[0].visible=false;n.children[0].customFutureField={value:0,enabled:false};
  const r=compile(selectSnapshot(fixture(frame('1:1',{children:[n]}))),{mapping});
  assert.equal(r.facts.nodes.length,3);assert.equal(r.measurements.nodes.length,2);
  assert.equal(r.facts.nodes[2].effectiveVisible,false);
  assert.deepEqual(r.facts.nodes[2].properties.customFutureField,{value:0,enabled:false});
});
test('mixed typography keeps text exactly, including UTF-16 emoji and newlines',()=>{
  const n=frame('2:1',{type:'TEXT',layoutMode:'NONE',characters:'Hi 😀\nX',style:{fontFamily:'Inter',fontSize:16,fontWeight:400,lineHeightPx:22},
    characterStyleOverrides:[0,0,0,1,1,0,0],styleOverrideTable:{1:{fontWeight:700,fills:[{type:'SOLID',color:{r:1,g:0,b:0}}]}}});
  const runs=textRuns(n);assert.equal(runs.map(r=>r.text).join(''),n.characters);assert.equal(runs[1].text,'😀');assert.equal(runs[1].style.fontWeight,700);
  const r=compile(selectSnapshot(fixture(frame('1:1',{children:[n]}))));
  assert.equal(r.screen.body[0].children[0].box.style.lineHeight,'22px');validateScreen(YAML.parse(YAML.stringify(r.screen)));
});
test('plain divider has color, thickness and authored placement',()=>{
  const line=frame('2:1',{type:'LINE',layoutMode:'NONE',size:{x:300,y:0},strokeWeight:1,strokes:[{type:'SOLID',color:{r:0.5,g:0.5,b:0.5}}]});
  const r=compile(selectSnapshot(fixture(frame('1:1',{children:[line]}))));
  assert.equal(r.screen.body[0].children[0].box.style.borderTop,'1px solid rgba(128, 128, 128, 1)');
});
function productFixture() {
  const price=button('3:1',{name:'Price',componentId:'10:2',componentProperties:{Amount:{type:'TEXT',value:'€12.00'}},children:[]});
  const title=frame('3:2',{name:'Title',type:'TEXT',characters:'Example meal',componentPropertyReferences:{characters:'Title#1'}});
  const product=button('2:1',{children:[price,title]});
  const raw=fixture(frame('1:1',{children:[product]}));raw.nodes['1:1'].components['10:2']={key:'demo-price-key',name:'Price'};
  const registry={version:1,entries:[{match:{componentKey:'demo-button-key'},target:'product',contentReviewed:true,
    contentRules:[{selector:{property:'Title#1'},to:'text'}],slotRules:{price:{selector:{componentKey:'demo-price-key'},kind:'component'}}},
    {match:{componentKey:'demo-price-key'},target:'price',propertyRules:[{from:'Amount',to:'props.value'}]}]};
  return {raw,registry};
}
test('nested slots use actual overridden instances, not library defaults or duplicated internal layout',()=>{
  const {raw,registry}=productFixture();const r=compile(selectSnapshot(raw),{mapping:registry});
  const c=r.screen.body[0].children[0].children[0];
  assert.equal(c.text,'Example meal');assert.equal(c.slots.price.$component,'price');assert.equal(c.slots.price.props.value,'€12.00');
  assert.equal(r.screen.body[0].children[0].children.length,1);assert.equal(r.facts.nodes.length,4);validateScreen(r.screen);
});
test('ambiguous content selectors do not choose a random descendant',()=>{
  const {raw,registry}=productFixture();raw.nodes['1:1'].document.children[0].children.push(frame('3:3',{type:'TEXT',characters:'Other',componentPropertyReferences:{characters:'Title#1'}}));
  const r=compile(selectSnapshot(raw),{mapping:registry});assert.ok(r.diagnostics.items.some(d=>d.code==='AMBIGUOUS_SELECTOR'));assert.equal(r.screen.body[0].children[0].children[0].text,undefined);
});
test('hidden ancestors cannot leak content through slot selectors',()=>{
  const {raw,registry}=productFixture();const p=raw.nodes['1:1'].document.children[0];p.children=[frame('4:1',{visible:false,children:p.children})];
  const r=compile(selectSnapshot(raw),{mapping:registry});assert.equal(r.screen.body[0].children[0].children[0].slots,undefined);
});
test('instance swap IDs require rules instead of becoming meaningless string props',()=>{
  const b=button();b.componentProperties.Swap={type:'INSTANCE_SWAP',value:'99:1'};
  const m=structuredClone(mapping);m.entries[0].propertyRules.push({from:'Swap',to:'props.icon'});
  const r=compile(selectSnapshot(fixture(frame('1:1',{children:[b]}))),{mapping:m});assert.ok(r.diagnostics.items.some(d=>d.code==='INSTANCE_SWAP_NEEDS_SLOT_RULE'));
});
test('slot image maps local bytes without retaining an expiring URL',()=>{
  const {raw,registry}=productFixture();registry.entries[0].slotRules.photo={selector:{nodeId:'3:2'},kind:'image',alt:'Example'};
  const r=compile(selectSnapshot(raw),{mapping:registry,assets:{'3:2':{path:'assets/test.png'}}});
  assert.equal(r.screen.body[0].children[0].children[0].slots.photo.$image.src,'assets/test.png');validateScreen(r.screen);
});
test('rendered image fallback does not emit children and baked effects twice',()=>{
  const n=frame('2:1',{fills:[{type:'IMAGE',imageRef:'fake'}],opacity:0.5,children:[button('3:1',{children:[]})]});
  const r=compile(selectSnapshot(fixture(frame('1:1',{children:[n]}))),{assets:{'2:1':{path:'assets/a.png',kind:'rendered-node'}}});
  const b=r.screen.body[0].children[0];assert.equal(b.children.length,0);assert.equal(b.box.style.opacity,undefined);assert.equal(r.facts.nodes.length,3);
});
test('negative main-axis gaps skip absolute and hidden siblings without changing authored padding',()=>{
  const children=[frame('2:1'),frame('2:2',{visible:false}),frame('2:3',{layoutPositioning:'ABSOLUTE'}),frame('2:4')];
  const r=compile(selectSnapshot(fixture(frame('1:1',{itemSpacing:-8,children}))));
  const b=r.screen.body[0];assert.equal(b.box.layout.gap,0);assert.deepEqual(b.box.layout.padding,[16,16,16,16]);
  assert.equal(b.children[0].box.style.marginTop,undefined);assert.equal(b.children[2].box.style.marginTop,undefined);assert.equal(b.children[3].box.style.marginTop,'-8px');
});
test('responsive mode respects explicit hug/fill while default snapshot keeps measured sizes',()=>{
  const s=selectSnapshot(fixture(frame('1:1',{children:[frame('2:1',{layoutSizingHorizontal:'FILL',layoutSizingVertical:'HUG'})]})));
  const a=compile(s),b=compile(s,{sizing:'responsive'});
  assert.equal(a.screen.body[0].children[0].box.style.width,'375px');assert.equal(b.screen.body[0].children[0].box.style.width,undefined);assert.equal(b.screen.body[0].children[0].box.style.alignSelf,'stretch');
});
test('renderer schema is independently checked and duplicate slot IDs are rejected',()=>{
  const {raw,registry}=productFixture();const r=compile(selectSnapshot(raw),{mapping:registry});
  assert.throws(()=>validateExternal(r.screen,{type:'object',required:['officialField']}),/External schema/);
  const c=r.screen.body[0].children[0].children[0];c.slots.duplicate=c.slots.price;assert.throws(()=>validateScreen(r.screen),/Duplicate/);
});
test('behavior is only copied from explicit template input',()=>{
  const source=selectSnapshot(fixture());assert.equal(compile(source).screen.behavior,undefined);
  const behavior={state:{count:0},interactions:[]};const r=compile(source,{template:{meta:{},body:[],behavior}});assert.deepEqual(r.screen.behavior,behavior);
});
test('partial source does not invent visibility and mapped components honor responsive sizing',()=>{
  const raw={id:'1:1',type:'FRAME',width:10,height:10};const r=compile(selectSnapshot(raw));assert.equal(r.facts.nodes[0].effectiveVisible,null);
  const b=button();b.layoutSizingHorizontal='FILL';const s=selectSnapshot(fixture(frame('1:1',{children:[b]})));
  assert.equal(compile(s,{mapping,sizing:'responsive'}).screen.body[0].children[0].box.style.alignSelf,'stretch');
});
