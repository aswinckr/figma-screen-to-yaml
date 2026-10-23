import {compile,canonical} from './exporter.mjs';
import {identity,findMapping,validateMapping} from './input.mjs';
import {compileComponent} from './components.mjs';
import {variableBindings,resolveQAToken} from './qa-tokens.mjs';

// This is a categorization contract, NOT an export whitelist. Every additional
// Figma property survives and is listed in coverage.unclassifiedProperties.
export const qaFields={
 geometry:['size','width','height','x','y','relativeTransform','absoluteBoundingBox','absoluteRenderBounds','rotation','constraints','minWidth','maxWidth','minHeight','maxHeight','targetAspectRatio','preserveRatio'],
 layout:['layoutMode','layoutAlign','layoutGrow','layoutPositioning','layoutSizingHorizontal','layoutSizingVertical','layoutWrap','primaryAxisAlignItems','counterAxisAlignItems','primaryAxisSizingMode','counterAxisSizingMode','paddingTop','paddingRight','paddingBottom','paddingLeft','itemSpacing','counterAxisSpacing','counterAxisAlignContent','gridRowCount','gridColumnCount','gridRowsSizing','gridColumnsSizing','gridAutoTracks','gridItemsPositioning','gridRowGap','gridColumnGap','gridRowAnchorIndex','gridColumnAnchorIndex','gridRowSpan','gridColumnSpan','gridChildHorizontalAlign','gridChildVerticalAlign','strokesIncludedInLayout','itemReverseZIndex','clipsContent','scrollBehavior','overflowDirection'],
 typography:['characters','style','characterStyleOverrides','styleOverrideTable','textAutoResize','textTruncation','maxLines','lineTypes','lineIndentations','paragraphIndent','paragraphSpacing','listSpacing'],
 appearance:['fills','strokes','strokeWeight','individualStrokeWeights','strokeAlign','strokeDashes','strokeCap','strokeJoin','strokeMiterAngle','complexStrokeProperties','variableWidthPoints','cornerRadius','rectangleCornerRadii','cornerSmoothing','opacity','blendMode','effects','background','backgroundColor','isMask','maskType'],
 components:['componentId','componentProperties','componentPropertyDefinitions','componentPropertyReferences','overrides','exposedInstances','isExposedInstance','preferredValues'],
 iconsAndAssets:['fillGeometry','strokeGeometry','vectorNetwork','vectorPaths','booleanOperation','exportSettings'],
 accessibilityAndBehavior:['annotations','description','descriptionMarkdown','pluginData','sharedPluginData','reactions','interactions','transitionNodeID','transitionDuration','transitionEasing'],
 bindings:['boundVariables','styles','explicitVariableModes','resolvedVariableModes'],
 state:['visible','locked','isMaskOutline','devStatus']
};
const baseKeys=new Set(['id','name','type','children']);
const knownKeys=new Set([...baseKeys,...Object.values(qaFields).flat()]);
function pool(prefix){const values={},keys=new Map();return {values,intern(value){const copy=canonical(value),key=JSON.stringify(copy);if(keys.has(key))return keys.get(key);const id=`${prefix}${keys.size+1}`;keys.set(key,id);values[id]=copy;return id;}};}

export function compileQA(snapshot,{mapping={version:1,entries:[]},variables=null,assets={}}={}) {
 validateMapping(mapping);
 // The spacing compiler supplies independent layout diagnostics, never filters
 // the QA evidence tree. All source nodes, including hidden nodes, survive below.
 const base=compile(snapshot,{profile:'spacing',mapping,variables:null});
 const items=base.diagnostics.items.filter(i=>i.code!=='SPACING_TOKEN_REVIEW');
 const values=pool('p'),tokens=pool('t'),mappings=pool('m'),identities=pool('c');
 const active=[],hidden=[],stats={},unclassified=new Set();let propertyCount=0;
 const add=(code,n,message)=>items.push({code,nodeId:n.id,severity:'warning',message});
 const visibility=new Map(base.facts.nodes.map(n=>[n.id,n.effectiveVisible]));
 function visit(n,parent=null,index=0,inheritedModes={}){
  const modes={...inheritedModes,...n.resolvedVariableModes,...n.explicitVariableModes};
  const node={id:n.id,type:n.type,...(Object.hasOwn(n,'name')?{name:n.name}:{}),parentId:parent,childIndex:index,
    effectiveVisible:visibility.get(n.id),childrenPresent:Object.hasOwn(n,'children'),children:(n.children||[]).map(c=>c.id),properties:{},propertyRefs:{}};
  for(const key of Object.keys(n).sort()){
   if(baseKeys.has(key))continue;
   const value=n[key];propertyCount++;stats[key]=(stats[key]||0)+1;if(!knownKeys.has(key))unclassified.add(key);
   if((value!==null&&typeof value==='object')||(typeof value==='string'&&value.length>100))node.propertyRefs[key]=values.intern(value);
   else node.properties[key]=value;
  }
  // Stored source itemSpacing remains untouched. Readers use this effective
  // layout hint when SPACE_BETWEEN makes that authored value inactive.
  if(['HORIZONTAL','VERTICAL'].includes(n.layoutMode))node.effectiveLayout={mainAxisGap:n.primaryAxisAlignItems==='SPACE_BETWEEN'?0:n.itemSpacing??(snapshot.rest?0:null),
    gapSource:n.primaryAxisAlignItems==='SPACE_BETWEEN'?'distributed':Object.hasOwn(n,'itemSpacing')?'authored':snapshot.rest?'rest-default':'unknown'};
  const bindings=variableBindings(n);
  if(bindings.length)node.tokens=bindings.map(binding=>({path:binding.path,resolution:tokens.intern(resolveQAToken(binding.bindingId,variables,modes))}));
  if(n.styles)node.styleBindings=Object.entries(n.styles).map(([property,id])=>({property,id,status:snapshot.styles?.[id]?.name?'resolved':'unresolved'}));
  if(n.type==='INSTANCE')node.component=identities.intern(identity(n,snapshot));
  const mapped=findMapping(n,snapshot,mapping);
  if(mapped){
   const start=items.length;
   const result=compileComponent(n,mapped,{snapshot,mapping,add,nodeId:n=>n.id,assetFor:node=>{
    if(assets[node.id])return assets[node.id];add('MAPPING_ASSET_UNAVAILABLE',node,'Mapping references an asset not downloaded; source geometry and image references are retained.');return null;
   }});
   node.mapping=mappings.intern({definition:mapped,result,status:items.length===start?'resolved':'needs-review',provenance:'user-supplied-mapping-not-figma'});
  }
  (node.effectiveVisible===false?hidden:active).push(node);
  (n.children||[]).forEach((child,i)=>visit(child,n.id,i,modes));
 }
 visit(snapshot.document);
 const unresolved=Object.values(tokens.values).filter(t=>t.status!=='resolved');
 if(unresolved.length)add('QA_TOKEN_REVIEW',snapshot.document,`${unresolved.length} distinct token resolutions need review. Preserve source values; resolution is not an implementation comparison.`);
 const unresolvedStyles=[...active,...hidden].flatMap(n=>n.styleBindings||[]).filter(s=>s.status!=='resolved');
 if(unresolvedStyles.length)add('QA_STYLE_REVIEW',snapshot.document,`${unresolvedStyles.length} style bindings have no catalog name.`);
 add('QA_RUNTIME_EVIDENCE_REQUIRED',snapshot.document,'Android accessibility, touch targets, font scaling and runtime component/token usage are not verified by a Figma export.');
 const coverage={sourcePropertyCount:propertyCount,preservedPropertyCount:propertyCount,propertyCounts:stats,
   fieldsByCategory:qaFields,unclassifiedProperties:[...unclassified].sort(),
   missingFieldPolicy:'not-exposed, never inferred absent or passing; source empty lists are explicitly absent; defaults require documented source semantics',
   accessibility:{status:'runtime-evidence-required',designAnnotations:[...active,...hidden].filter(n=>n.propertyRefs.annotations||n.properties.annotations).length,
    requiredChecks:['authored accessibility expectations','labels and content descriptions','roles','states and actions','focus and traversal order','touch target bounds','contrast against actual composited background','font scaling and clipping','TalkBack on device']},
   limitations:['Only this selected subtree/state was fetched; other variants, screens and states require separate exports.',
    'Absent API fields and denied variable catalogs cannot be reconstructed; inspect unresolved/not-exposed records.',
    'Icon code tokens require explicit identity mappings; component names or vector appearance are not proof.',
    'Images retain source hashes and transforms; frame reference does not replace original asset bytes.',
    'All supplied properties are preserved; unsupported geometry, effects or fields still require a capable comparison adapter.']};
 const screen={meta:{profile:'qa',schemaVersion:1,title:snapshot.document.name||'Screen',units:'Figma px',figmaFileKey:snapshot.fileKey,
   figmaNodeId:snapshot.document.id,figmaVersion:snapshot.version,variableCatalogSource:variables?{kind:'supplied-catalog',versionPinned:false}:null,sourceKind:snapshot.rest?'rest':'partial-node'},
   catalogs:{values:values.values,tokenResolutions:tokens.values,identities:identities.values,mappings:mappings.values,
    styles:structuredClone(snapshot.styles||{}),components:structuredClone(snapshot.components),componentSets:structuredClone(snapshot.componentSets),variables:variables?structuredClone(variables):null},
   nodes:active,hiddenNodes:hidden,coverage};
 if(JSON.stringify(canonical(restoreQATree(screen)))!==JSON.stringify(canonical(snapshot.document)))throw new Error('QA source preservation check failed');
 base.screen=screen;
 base.diagnostics={schemaVersion:1,status:'needs-review',scope:'Full QA evidence export. Source preservation is verified separately from comparison coverage.',
   summary:{extractedNodes:active.length+hidden.length,emittedNodes:active.length,hiddenNodesRetained:hidden.length,recognizedComponents:identities?Object.keys(identities.values).length:0,
    sourcePropertyCount:propertyCount,unresolvedTokenResolutions:unresolved.length,counts:{}},items};
 return base;
}

// Public consumer API: comparisons must hydrate records rather than treating a
// missing inline field as absent. Never need facts.json to recover properties.
export function readQANode(screen,node){
 const properties={...structuredClone(node.properties)};
 for(const [key,ref]of Object.entries(node.propertyRefs)){
  if(!Object.hasOwn(screen.catalogs.values,ref))throw new Error(`Missing QA property reference: ${ref}`);
  properties[key]=structuredClone(screen.catalogs.values[ref]);
 }
 return {id:node.id,...(Object.hasOwn(node,'name')?{name:node.name}:{}),type:node.type,...properties};
}
export function restoreQATree(screen){
 const all=new Map([...screen.nodes,...screen.hiddenNodes].map(n=>[n.id,n]));const seen=new Set();
 function visit(id){if(seen.has(id))throw new Error('Cycle or repeated QA node');seen.add(id);const n=all.get(id);if(!n)throw new Error(`Missing QA node ${id}`);
  const value=readQANode(screen,n);if(n.childrenPresent)value.children=n.children.map(visit);return value;}
 const root=visit(screen.meta.figmaNodeId);if(seen.size!==all.size)throw new Error('Unreachable QA nodes');return root;
}
export function qaField(screen,node,key){
 const properties=readQANode(screen,node);
 if(!Object.hasOwn(properties,key))return {status:'not-exposed'};
 const value=properties[key];return {status:value===null||(Array.isArray(value)&&!value.length)?'explicitly-absent':'captured',value};
}
