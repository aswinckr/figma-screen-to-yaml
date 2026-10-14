import {identity} from './input.mjs';
import {textRuns} from './visuals.mjs';

// Extraction is deliberately independent of component compilation: never stop at a
// mapped instance. Preserve unknown fields, hidden descendants, zero and false.
export function extractFacts(snapshot) {
  const nodes=[];
  function visit(n,parentId=null,inheritedVisible=true) {
    const visible=inheritedVisible===false || n.visible===false ? false : inheritedVisible===null ? null : snapshot.rest || n.visible===true ? inheritedVisible : null;
    const {children,...properties}=n;
    nodes.push({id:n.id,parentId,childIds:(children||[]).map(c=>c.id),effectiveVisible:visible,
      properties:structuredClone(properties),...(n.type==='INSTANCE'?{identity:identity(n,snapshot)}:{}),
      ...(n.type==='TEXT'?{textRuns:textRuns(n)}:{})});
    for(const child of children || [])visit(child,n.id,visible);
  }
  visit(snapshot.document);
  return {schemaVersion:2,source:{fileKey:snapshot.fileKey,nodeId:snapshot.document.id,version:snapshot.version},
    note:'Unfiltered selected subtree. Missing fields remain unknown. Token bindings are IDs unless a separate trusted catalog resolves them.',nodes};
}
