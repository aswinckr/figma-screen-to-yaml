import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {selectSnapshot} from '../src/input.mjs';
import {compile} from '../src/exporter.mjs';
import {compileQA,readQANode,restoreQATree,qaField} from '../src/qa.mjs';
import {serializeQA} from '../src/qa-yaml.mjs';
import {variableBindings,resolveQAToken,hasQABindings} from '../src/qa-tokens.mjs';
import {getVariables} from '../src/variables.mjs';
import {validateScreen} from '../src/validation.mjs';
import {frame,fixture,button,mapping} from './fixture.mjs';

const alias=id=>({type:'VARIABLE_ALIAS',id});
function full(){
 const raw=fixture(frame('1:1',{name:'Full QA',futureFigmaField:{zero:0,no:false,empty:'',none:null},
  children:[button('2:1',{cornerRadius:8,rectangleCornerRadii:[1,2,3,4],cornerSmoothing:0.6,
   fills:[{type:'SOLID',color:{r:1,g:0,b:0,a:0.7},boundVariables:{color:alias('red')}},{type:'IMAGE',imageRef:'image-hash',scaleMode:'CROP',imageTransform:[[1,0,0.2],[0,1,0.1]]}],
   strokes:[{type:'SOLID',visible:false,color:{r:0,g:0,b:0}}],strokeDashes:[1,2,3,4],strokeCap:'ROUND',strokeJoin:'BEVEL',strokeAlign:'OUTSIDE',strokeWeight:2,individualStrokeWeights:{top:1,bottom:2,left:3,right:4},
   effects:[{type:'DROP_SHADOW',offset:{x:0,y:2},radius:4,color:{r:0,g:0,b:0,a:0.5}}],opacity:0.5,
   fillGeometry:[{path:'M0 0 L4 0 L4 4 Z',windingRule:'NONZERO'}],annotations:[{labelMarkdown:'Accessible name: Checkout'}],
   sharedPluginData:{audit:{role:'button'}},interactions:[{trigger:{type:'ON_CLICK'},actions:[]}],
   children:[frame('2:2',{type:'TEXT',characters:'Ab',style:{fontFamily:'Test',fontStyle:'Italic',fontSize:16,lineHeightUnit:'PERCENT',lineHeightPercentFontSize:125,textDecoration:'UNDERLINE',textTruncation:'ENDING',maxLines:2,paragraphSpacing:8},
    characterStyleOverrides:[0,1],styleOverrideTable:{1:{fontSize:20,fills:[{type:'SOLID',color:{r:0,g:1,b:0}}],hyperlink:{type:'URL',url:'https://example.org'}}},styles:{text:'style1'},boundVariables:{fontSize:alias('size')}})]}),
    frame('3:1',{visible:false,children:[frame('3:2',{visible:true})]})]}));
 raw.nodes['1:1'].styles={style1:{name:'Mobile/body/base',key:'style-key',styleType:'TEXT',remote:true}};
 return raw;
}
const make=()=>compileQA(selectSnapshot(full()));

test('full QA round-trip preserves every original property, hidden subtree, rich text and unknown future field',()=>{
 const snapshot=selectSnapshot(full()),result=compileQA(snapshot),screen=YAML.parse(serializeQA(result.screen));
 validateScreen(screen);assert.deepEqual(restoreQATree(screen),snapshot.document);
 assert.equal(screen.nodes.length,3);assert.equal(screen.hiddenNodes.length,2);
 assert.equal(screen.catalogs.styles.style1.name,'Mobile/body/base');
 assert.deepEqual(screen.nodes.find(n=>n.id==='2:2').styleBindings,[{id:'style1',property:'text',status:'resolved'}]);
 assert.ok(screen.coverage.unclassifiedProperties.includes('futureFigmaField'));
 assert.equal(screen.coverage.sourcePropertyCount,screen.coverage.preservedPropertyCount);
 assert.ok(!('library' in screen.meta));assert.ok(result.diagnostics.items.some(i=>i.code==='QA_RUNTIME_EVIDENCE_REQUIRED'));
});
test('hydration exposes paints, exact stroke patterns, corners and instance configurations without facts.json',()=>{
 const {screen}=make(),node=screen.nodes.find(n=>n.id==='2:1'),hydrated=readQANode(screen,node);
 assert.deepEqual(hydrated,full().nodes['1:1'].document.children[0].children?Object.fromEntries(Object.entries(full().nodes['1:1'].document.children[0]).filter(([k])=>k!=='children')):null);
 assert.deepEqual(hydrated.strokeDashes,[1,2,3,4]);assert.equal(hydrated.strokes[0].visible,false);
 assert.equal(hydrated.componentProperties['Disabled#11:1'].value,false);
 assert.equal(qaField(screen,node,'cornerRadius').status,'captured');
 assert.equal(qaField(screen,node,'notSupplied').status,'not-exposed');
 const n=screen.hiddenNodes[0];n.properties.effects=[];assert.equal(qaField(screen,n,'effects').status,'explicitly-absent');
});
test('deduplication is deterministic and does not make edits to shared dictionaries during hydration',()=>{
 const snap=selectSnapshot(fixture(frame('1:1',{children:[frame('a',{fills:[{type:'SOLID',color:{r:1,g:0,b:0}}]}),frame('b',{fills:[{type:'SOLID',color:{r:1,g:0,b:0}}]})]})));
 const a=compileQA(snap).screen,b=compileQA(selectSnapshot(JSON.parse(JSON.stringify(fixture(snap.document))))).screen;
 assert.equal(a.nodes[1].propertyRefs.fills,a.nodes[2].propertyRefs.fills);
 const hydrated=readQANode(a,a.nodes[1]);hydrated.fills[0].color.r=0;
 assert.equal(readQANode(a,a.nodes[2]).fills[0].color.r,1);assert.equal(serializeQA(a),serializeQA(b));
});
test('reviewed mapped component props are separate evidence and never seal internals',()=>{
 const r=compileQA(selectSnapshot(full()),{mapping});const n=r.screen.nodes.find(n=>n.id==='2:1');
 assert.equal(r.screen.catalogs.mappings[n.mapping].result.props.disabled,false);
 assert.equal(r.screen.catalogs.mappings[n.mapping].provenance,'user-supplied-mapping-not-figma');
 assert.ok(r.screen.nodes.find(n=>n.id==='2:2'));assert.deepEqual(restoreQATree(r.screen),selectSnapshot(full()).document);
});
test('QA validation rejects corrupt references, duplicate IDs, parent/order errors and overwritten identity',()=>{
 for(const mutate of [s=>s.nodes[1].propertyRefs.fills='missing',s=>s.nodes[1].id=s.nodes[0].id,s=>s.nodes[1].parentId='bad',s=>s.nodes[1].childIndex=9,s=>s.nodes[0].properties.id='bad',s=>s.nodes[0].properties.size={},s=>s.nodes[0].tokens=[{path:'/x',resolution:'missing'}]]){
  const {screen}=make();mutate(screen);assert.throws(()=>validateScreen(screen));
 }
});
test('partial exports distinguish unknown visibility and absent properties from REST defaults',()=>{
 const n={id:'x',type:'TEXT',characters:'x',size:{x:10,y:10}};const r=compileQA(selectSnapshot(n));
 assert.equal(r.screen.nodes[0].effectiveVisible,null);assert.equal(r.screen.meta.sourceKind,'partial-node');
 assert.equal(qaField(r.screen,r.screen.nodes[0],'fills').status,'not-exposed');assert.deepEqual(restoreQATree(r.screen),n);
});
test('distributed layout ignores stale positive and negative authored gaps in horizontal and vertical flows',()=>{
 for(const direction of ['HORIZONTAL','VERTICAL'])for(const gap of [134,-8]){
  const snapshot=selectSnapshot(fixture(frame('1:1',{layoutMode:direction,primaryAxisAlignItems:'SPACE_BETWEEN',itemSpacing:gap,children:[frame('a'),frame('b')]})));
  for(const profile of ['render','spacing']){
   const result=compile(snapshot,{profile});assert.equal(result.screen.body[0].box.layout.gap,0);
   assert.equal(result.screen.body[0].children[1].box.style.marginLeft,undefined);assert.equal(result.screen.body[0].children[1].box.style.marginTop,undefined);
  }
  const qa=compileQA(snapshot).screen;assert.equal(qa.nodes[0].effectiveLayout.mainAxisGap,0);assert.equal(readQANode(qa,qa.nodes[0]).itemSpacing,gap);
 }
});

const catalog={variables:Object.fromEntries([['size','FLOAT',16],['red','COLOR',{r:1,g:0,b:0,a:1}],['family','STRING','Inter'],['enabled','BOOLEAN',false]].map(([id,type,value])=>[id,{id,name:`tokens/${id}`,resolvedType:type,variableCollectionId:'c',valuesByMode:{light:value,dark:value}}])),variableCollections:{c:{id:'c',name:'Library',defaultModeId:'light',modes:[{modeId:'light',name:'Light'},{modeId:'dark',name:'Dark'}]}}};
test('QA resolves all variable types and bindings nested in paints, overrides and hidden states',()=>{
 for(const id of Object.keys(catalog.variables)){const t=resolveQAToken(id,catalog,{c:'light'});assert.equal(t.status,'resolved');assert.equal(t.name,`tokens/${id}`);assert.deepEqual(t.resolvedValue,catalog.variables[id].valuesByMode.light);}
 const snap=selectSnapshot(full());snap.document.explicitVariableModes={c:'light'};
 const s=compileQA(snap,{variables:catalog}).screen;assert.ok(s.nodes.find(n=>n.id==='2:1').tokens.some(t=>t.path==='/fills/0/boundVariables/color'));
 assert.equal(Object.values(s.catalogs.tokenResolutions).filter(t=>t.status!=='resolved').length,0);
 assert.equal(hasQABindings({document:frame('x',{visible:false,boundVariables:{fontFamily:alias('family')}})}),true);
 assert.deepEqual(variableBindings({'a/b':{'~key':alias('size')}}),[{path:'/a~1b/~0key',bindingId:'size'}]);
});
test('QA aliases, missing catalogs, types, inherited modes and source values are handled without guesses',()=>{
 assert.equal(resolveQAToken('size',catalog).status,'mode-unverified');assert.equal(resolveQAToken('size',null).reason,'catalog-unavailable');
 const c=structuredClone(catalog);c.variables.alias={id:'alias',name:'semantic',resolvedType:'FLOAT',variableCollectionId:'c',valuesByMode:{light:alias('size')}};
 assert.equal(resolveQAToken('alias',c,{c:'light'}).resolvedValue,16);c.variables.size.valuesByMode.light=alias('alias');assert.equal(resolveQAToken('alias',c,{c:'light'}).reason,'alias-cycle');
 c.variables.size.valuesByMode.light='wrong';assert.equal(resolveQAToken('size',c,{c:'light'}).reason,'type-mismatch');
 const raw=full();raw.nodes['1:1'].document.explicitVariableModes={c:'dark'};raw.nodes['1:1'].document.children[0].explicitVariableModes={c:'light'};
 const result=compileQA(selectSnapshot(raw),{variables:catalog});const text=result.screen.nodes.find(n=>n.id==='2:2');
 assert.equal(result.screen.catalogs.tokenResolutions[text.tokens[0].resolution].aliasChain[0].modeId,'light');
 assert.deepEqual(restoreQATree(result.screen),raw.nodes['1:1'].document);
});
test('denied variable diagnostics distinguish stated causes without leaking response contents or secrets',async()=>{
 for(const [status,body,cause]of [[401,'SECRET','authentication'],[403,'Missing scope file_variables:read SECRET','missing-scope'],[403,'Enterprise plan required SECRET','account-eligibility'],[403,'Forbidden SECRET','undetermined']]){
  await assert.rejects(getVariables('file',{token:'SECRET',fetchImpl:async()=>Response.json({err:body},{status})}),e=>e.details.httpStatus===status&&e.details.cause===cause&&!e.message.includes('SECRET'));
 }
});
