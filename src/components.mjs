import {findMapping,identity} from './input.mjs';

export function selectDescendants(root,selector,snapshot) {
  const allowed=['nodeId','name','componentKey','property','type','path'];
  if(!selector || !Object.keys(selector).length || Object.keys(selector).some(k=>!allowed.includes(k)))throw new Error('Selector needs nodeId/name/componentKey/property/type/path.');
  const found=[];
  function visit(n,path) {
    if(n.visible===false)return;
    if(Object.entries(selector).every(([k,v])=> k==='nodeId'?n.id===v:k==='componentKey'?identity(n,snapshot).componentKey===v:
      k==='property'?Object.values(n.componentPropertyReferences || {}).includes(v):k==='path'?JSON.stringify(path)===JSON.stringify(v):n[k]===v))found.push(n);
    for(const c of n.children || [])visit(c,[...path,c.name]);
  }
  for(const c of root.children || [])visit(c,[c.name]);
  return found;
}
export function compileComponent(n,mapped,ctx,stack=new Set()) {
  const {snapshot,mapping,add,assetFor,nodeId}=ctx;
  if(stack.has(n.id))throw new Error(`Cyclic slot mapping at ${n.id}`);
  stack=new Set(stack).add(n.id);
  const c={component:mapped.target,id:`${nodeId(n)}-component`};
  if(mapped.preset)c.preset=mapped.preset;
  if(mapped.props)c.props=structuredClone(mapped.props);
  if(mapped.slots)c.slots=structuredClone(mapped.slots);
  function assign(to,value) {
    if(!/^(text|props\.[a-zA-Z][a-zA-Z0-9_]*)$/.test(to || ''))throw new Error('Mapping destination must be text or props.name.');
    if(to==='text') {
      if(typeof value!=='string'){add('TEXT_PROPERTY_TYPE',n,'Mapped text must be a string.');return;}
      c.text=value;
    } else {c.props ||= {};c.props[to.slice(6)]=value;}
  }
  for(const rule of mapped.propertyRules || []) {
    const prop=n.componentProperties?.[rule.from];
    if(!prop){add('PROPERTY_NOT_FOUND',n,`Missing exact property ${rule.from}.`);continue;}
    let value=prop.value;
    if(rule.values) {
      if(!Object.hasOwn(rule.values,String(value))){add('UNMAPPED_PROPERTY_VALUE',n,`No value mapping for ${rule.from}.`);continue;}
      value=rule.values[String(value)];
    } else if(prop.type==='INSTANCE_SWAP') {
      add('INSTANCE_SWAP_NEEDS_SLOT_RULE',n,`Use a slotRules selector for the actual descendant instance of ${rule.from}; a main-component ID is not its overridden content.`);continue;
    }
    assign(rule.to,value);
  }
  function selected(rule) {
    const hits=selectDescendants(n,rule.selector,snapshot);
    if(!hits.length){if(!rule.optional)add('SELECTOR_NOT_FOUND',n,`No visible match for ${JSON.stringify(rule.selector)}.`);return [];}
    if(!rule.all && hits.length!==1){add('AMBIGUOUS_SELECTOR',n,`Selector matched ${hits.length} nodes; refine it or explicitly set all:true.`);return [];}
    return hits;
  }
  for(const rule of mapped.contentRules || []) {
    const hits=selected(rule);if(!hits.length)continue;
    if(!['characters','name'].includes(rule.field || 'characters'))throw new Error('Content rule field must be characters or explicit name.');
    const values=hits.map(h=>h[rule.field || 'characters']);
    if(values.some(v=>v===undefined)){add('CONTENT_FIELD_MISSING',n,'Selected content field is missing.');continue;}
    assign(rule.to,rule.all?values:values[0]);
  }
  for(const [slot,rule] of Object.entries(mapped.slotRules || {})) {
    if(rule.when && !Object.entries(rule.when).every(([k,v])=>n.componentProperties?.[k]?.value===v))continue;
    const values=[];
    for(const hit of selected(rule)) {
      if(rule.kind==='text') {
        if(typeof hit.characters==='string')values.push({$text:hit.characters});
        else add('MISSING_TEXT',hit,'Slot text has no characters.');
      } else if(rule.kind==='image') {
        const asset=assetFor(hit);if(asset)values.push({$image:{src:asset.path,alt:rule.alt || '',...(Number.isFinite(hit.size?.x)?{width:hit.size.x,height:hit.size.y}:{})}});
      } else if(rule.kind==='component') {
        const nested=findMapping(hit,snapshot,mapping);
        if(!nested){add('UNMAPPED_SLOT_COMPONENT',hit,'Slot component needs an identity mapping.');continue;}
        const {component,...rest}=compileComponent(hit,nested,ctx,stack);
        values.push({$component:component,...rest});
      } else throw new Error(`Unsupported slot kind ${rule.kind}. Use component/text/image.`);
    }
    if(values.length){c.slots ||= {};c.slots[slot]=rule.all?values:values[0];}
  }
  if((n.children || []).length && mapped.contentReviewed!==true)add('COMPONENT_CONTENT_REVIEW',n,'All internals are retained in facts.json. Review property/content/slot rules, then set contentReviewed:true; unmapped internals are not emitted as duplicate boxes.');
  return c;
}
