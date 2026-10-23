// Find bindings at every depth, including paint colors, typography, component
// properties and overrides. Paths are JSON pointers into the original node.
const escape = key => String(key).replaceAll('~','~0').replaceAll('/','~1');
export function variableBindings(value, path='') {
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'VARIABLE_ALIAS') return [{path,bindingId:typeof value.id==='string'?value.id:null}];
  return Object.entries(value).filter(([key])=>path!==''||key!=='children')
    .flatMap(([key,child])=>variableBindings(child,`${path}/${escape(key)}`));
}
export function hasQABindings(snapshot) {
  const stack=[snapshot.document];
  while(stack.length){const n=stack.pop();if(variableBindings(n).length)return true;stack.push(...(n.children||[]));}
  return false;
}
export function resolveQAToken(bindingId,catalog,modes={}) {
  const result={bindingId,status:'unresolved'};
  if(!bindingId)return {...result,reason:'unsupported-binding'};
  if(!catalog)return {...result,reason:'catalog-unavailable'};
  let id=bindingId,assumed=false;const seen=new Set(),chain=[];
  while(true){
    if(seen.has(id))return {...result,aliasChain:chain,reason:'alias-cycle'};
    seen.add(id);const v=catalog.variables[id];
    if(!v)return {...result,aliasChain:chain,reason:'variable-missing'};
    if(chain.length===0)Object.assign(result,{name:v.name,key:v.key??null,type:v.resolvedType,collectionId:v.variableCollectionId});
    const c=catalog.variableCollections[v.variableCollectionId];
    if(!c)return {...result,aliasChain:chain,reason:'collection-missing'};
    const modeId=modes[c.id]||c.defaultModeId,mode=c.modes.find(m=>m.modeId===modeId);
    if(!mode||!Object.hasOwn(v.valuesByMode,modeId))return {...result,aliasChain:chain,reason:'mode-value-missing'};
    assumed ||= !modes[c.id];chain.push({id,name:v.name,collectionId:c.id,collection:c.name??null,modeId,mode:mode.name});
    const value=v.valuesByMode[modeId];
    if(value?.type==='VARIABLE_ALIAS'){id=value.id;continue;}
    const valid=v.resolvedType==='FLOAT'?Number.isFinite(value):v.resolvedType==='STRING'?typeof value==='string':
      v.resolvedType==='BOOLEAN'?typeof value==='boolean':v.resolvedType==='COLOR'?value&&['r','g','b'].every(k=>Number.isFinite(value[k]))&&(value.a===undefined||Number.isFinite(value.a)):false;
    if(!valid || v.resolvedType!==result.type)return {...result,aliasChain:chain,reason:'type-mismatch'};
    return {...result,status:assumed?'mode-unverified':'resolved',modeSource:assumed?'collection-default-unverified':'node-or-ancestor',aliasChain:chain,resolvedValue:structuredClone(value)};
  }
}
