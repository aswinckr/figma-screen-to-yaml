// Declarative structured values, not executable templates. Source reads use the
// actual instance and visible descendants; library defaults are never substituted.
export function resolveBinding(value, {root, select, assetFor, add, read}, destination) {
  const missing=Symbol('missing');
  function resolve(v,scope) {
    if(Array.isArray(v)) {
      const values=v.map(x=>resolve(x,scope));
      return values.includes(missing)?missing:values;
    }
    if(!v || typeof v!=='object')return v;
    if(Object.hasOwn(v,'$source')) {
      if(Object.keys(v).length!==1)throw new Error('$source must be the only expression key.');
      const rule=v.$source;
      if(!rule || typeof rule!=='object' || Array.isArray(rule))throw new Error('$source needs an object.');
      const allowed=['selector','field','property','asset','exists','values','all','join','optional'];
      if(Object.keys(rule).some(k=>!allowed.includes(k)))throw new Error('Unknown $source option.');
      const modes=['field','property','asset','exists'].filter(k=>Object.hasOwn(rule,k));
      if(modes.length!==1)throw new Error('$source needs exactly one of field/property/asset/exists.');
      const hits=rule.selector?select(scope,rule.selector):[scope];
      if(rule.exists===true) {
        for(const hit of hits)read(hit,'exists',destination);
        return hits.length>0;
      }
      if(!hits.length) {
        if(!rule.optional)add('BINDING_NOT_FOUND',root,`No visible source for ${destination}.`);
        return missing;
      }
      if(!rule.all && hits.length!==1) {
        add('AMBIGUOUS_BINDING',root,`${destination} matched ${hits.length} nodes. Refine the selector or use all:true.`);
        return missing;
      }
      const values=hits.map(hit=>{
        let result;
        if(rule.asset===true) {
          const asset=assetFor(hit);if(!asset)return missing;
          result={$asset:asset.path};
        } else if(rule.property) {
          const prop=hit.componentProperties?.[rule.property];
          if(prop?.type==='INSTANCE_SWAP') {
            add('INSTANCE_SWAP_NEEDS_SLOT_RULE',hit,'Select the overridden descendant, not the main-component swap ID.');return missing;
          }
          result=prop?.value;
        } else {
          if(!['characters','id','name'].includes(rule.field))throw new Error('Binding field must be characters/id/name.');
          result=hit[rule.field];
        }
        if(result===undefined){add('BINDING_FIELD_MISSING',hit,`Missing source value for ${destination}.`);return missing;}
        if(rule.values) {
          if(!Object.hasOwn(rule.values,String(result))){add('UNMAPPED_BINDING_VALUE',hit,`No explicit value mapping for ${destination}.`);return missing;}
          result=rule.values[String(result)];
        }
        read(hit,rule.asset?'asset':rule.property?`property:${rule.property}`:rule.field,destination);
        return result;
      });
      if(values.includes(missing))return missing;
      if(rule.join!==undefined) {
        if(!rule.all || typeof rule.join!=='string' || values.some(x=>typeof x!=='string'))throw new Error('join requires all:true and string values.');
        return values.join(rule.join);
      }
      return rule.all?values:values[0];
    }
    if(Object.hasOwn(v,'$each')) {
      if(Object.keys(v).length!==1)throw new Error('$each must be the only expression key.');
      const rule=v.$each;
      if(!rule || !rule.selector || !Object.hasOwn(rule,'value') || Object.keys(rule).some(k=>!['selector','value'].includes(k)))throw new Error('$each needs selector and value.');
      const hits=select(scope,rule.selector);
      if(!hits.length){add('BINDING_NOT_FOUND',root,`No visible list items for ${destination}.`);return missing;}
      const values=hits.map(hit=>resolve(rule.value,hit));
      return values.includes(missing)?missing:values;
    }
    const pairs=Object.entries(v).map(([key,item])=>[key,resolve(item,scope)]);
    // Never construct a partial item after a required binding failed.
    return pairs.some(([,item])=>item===missing)?missing:Object.fromEntries(pairs);
  }
  const result=resolve(value,root);
  return result===missing?{resolved:false}:{resolved:true,value:result};
}
