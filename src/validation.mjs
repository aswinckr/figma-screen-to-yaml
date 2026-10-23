import Ajv from 'ajv';
import {restoreQATree,readQANode} from './qa.mjs';
import {variableBindings} from './qa-tokens.mjs';
import {readFile} from 'node:fs/promises';
const schema=JSON.parse(await readFile(new URL('../schemas/screen.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({allErrors:true,strict:true,allowUnionTypes:true}).compile(schema);
const spacingSchema=JSON.parse(await readFile(new URL('../schemas/spacing.schema.json',import.meta.url),'utf8'));
const validateSpacing=new Ajv({allErrors:true,strict:true,allowUnionTypes:true}).compile(spacingSchema);
const qaSchema=JSON.parse(await readFile(new URL('../schemas/qa.schema.json',import.meta.url),'utf8'));
const validateQA=new Ajv({allErrors:true,strict:true,allowUnionTypes:true}).compile(qaSchema);
export function validateScreen(screen) {
  const check = screen.meta?.profile === 'qa' ? validateQA : screen.meta?.profile === 'spacing' ? validateSpacing : validate;
  if(!check(screen)) throw new Error(`YAML schema validation failed: ${JSON.stringify(check.errors.slice(0,8))}`);
  if(screen.meta?.profile==='qa') {
    const all=[...screen.nodes,...screen.hiddenNodes],byId=new Map(all.map(n=>[n.id,n]));
    if(byId.get(screen.meta.figmaNodeId)?.parentId!==null)throw new Error('QA root parent must be null');
    if(byId.size!==all.length)throw new Error('Duplicate QA node ID');
    if(screen.nodes.some(n=>n.effectiveVisible===false)||screen.hiddenNodes.some(n=>n.effectiveVisible!==false))throw new Error('Invalid QA visibility partition');
    for(const n of all){
      for(const key of ['id','name','type','children'])if(Object.hasOwn(n.properties,key)||Object.hasOwn(n.propertyRefs,key))throw new Error('Reserved QA property');
      if(Object.keys(n.propertyRefs).some(k=>Object.hasOwn(n.properties,k)))throw new Error('Duplicate inline and referenced QA property');
      if(!n.childrenPresent&&n.children.length)throw new Error('QA children presence mismatch');
      if(n.parentId===null&&n.id!==screen.meta.figmaNodeId)throw new Error('Multiple QA roots');
      if(n.parentId!==null&&!byId.has(n.parentId))throw new Error('Missing QA parent');
      n.children.forEach((id,i)=>{const child=byId.get(id);if(!child||child.parentId!==n.id||child.childIndex!==i)throw new Error('QA parent/order mismatch');});
      for(const t of n.tokens||[])if(!Object.hasOwn(screen.catalogs.tokenResolutions,t.resolution))throw new Error('Missing QA token reference');
      const bindings=variableBindings(readQANode(screen,n));
      if(bindings.length!==(n.tokens||[]).length||bindings.some(b=>!(n.tokens||[]).some(t=>t.path===b.path&&screen.catalogs.tokenResolutions[t.resolution].bindingId===b.bindingId)))throw new Error('QA binding coverage mismatch');
      for(const [key,pool]of [['component','identities'],['mapping','mappings']])if(n[key]&&!Object.hasOwn(screen.catalogs[pool],n[key]))throw new Error('Missing QA catalog reference');
      for(const binding of n.styleBindings||[])if(binding.status==='resolved'&&!screen.catalogs.styles[binding.id]?.name)throw new Error('Missing QA style name');
    }
    restoreQATree(screen);return true;
  }
  const ids=new Set();
  function visit(n) {
    if(!n || typeof n!=='object')return;
    if(Array.isArray(n)){n.forEach(visit);return;}
    const id=n.box?.id || n.id;
    if(id!==undefined){if(ids.has(id))throw new Error(`Duplicate YAML id: ${id}`);ids.add(id);}
    if(n.children)visit(n.children);
    if(n.slots)Object.values(n.slots).forEach(visit);
    // Nested component markers may also appear inside props.
    if(n.props)walkProps(n.props);
  }
  function walkProps(value) {
    if(!value || typeof value!=='object')return;
    if(value.$component){visit(value);return;}
    Object.values(value).forEach(walkProps);
  }
  visit(screen.body);if(screen.pinned)Object.values(screen.pinned).forEach(visit);
  if (screen.meta?.profile === 'spacing') {
    const sourceIds = new Set();
    function checkSource(node, parentId = null) {
      if (!node.box) return;
      const source = node.box.source;
      if (sourceIds.has(source.nodeId)) throw new Error(`Duplicate source node ID: ${source.nodeId}`);
      sourceIds.add(source.nodeId);
      if (source.parentId !== parentId) throw new Error(`Audit source parent mismatch: ${source.nodeId}`);
      if (source.visible === false) throw new Error('Hidden nodes must not be emitted in spacing audit YAML.');
      node.children.forEach(child => checkSource(child, source.nodeId));
    }
    screen.body.forEach(node => checkSource(node));
  }
  return true;
}
export function validateExternal(screen,schema) {
  const check=new Ajv({allErrors:true,strict:false,allowUnionTypes:true}).compile(schema);
  if(!check(screen))throw new Error(`External schema validation failed: ${JSON.stringify(check.errors.slice(0,8))}`);
}
