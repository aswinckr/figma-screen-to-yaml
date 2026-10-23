export function selectSnapshot(raw, requestedId) {
  let document, components = {}, componentSets = {}, styles = {}, rest = false;
  const nodeId = requestedId || raw._exportSource?.nodeId;
  if (raw.nodes) {
    const ids = Object.keys(raw.nodes).filter(k => raw.nodes[k]?.document);
    const id = nodeId || (ids.length === 1 ? ids[0] : null);
    if (!id) throw new Error('Snapshot contains multiple nodes: pass --node-id.');
    const entry = raw.nodes[id];
    if (!entry?.document) throw new Error(`Node ${id} is absent from this snapshot.`);
    ({ document, components = {}, componentSets = {}, styles = {} } = entry);
    rest = true;
  } else if (raw.document) {
    ({ document, components = {}, componentSets = {}, styles = {} } = raw);
    rest = true;
    if (nodeId && document.id !== nodeId) document = findNode(document, nodeId);
  } else if (raw.id && raw.type) {
    document = nodeId ? findNode(raw, nodeId) : raw;
  } else throw new Error('Expected Figma REST JSON, native JSON_REST_V1 export, or a node tree.');
  if (!document) throw new Error('Requested node is absent.');
  if (['DOCUMENT', 'CANVAS'].includes(document.type)) throw new Error('Select a screen frame, not the entire document/page. Use --node-id.');
  const seen = new Set();
  for (const node of walk(document)) {
    if (!node.id || typeof node.type !== 'string') throw new Error('Every node needs an id and type.');
    if (seen.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    seen.add(node.id);
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error(`Invalid children on ${node.id}`);
  }
  return { document, components, componentSets, styles, rest,
    fileKey: raw._exportSource?.fileKey || null, version: raw.version || raw._exportSource?.version || null };
}
export function* walk(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop(); yield node;
    if (Array.isArray(node.children)) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
}
function findNode(root, id) { return [...walk(root)].find(n => n.id === id); }

export function identity(node, snapshot) {
  const info = snapshot.components[node.componentId] || {};
  const set = snapshot.componentSets[info.componentSetId] || {};
  return { componentId: node.componentId || null, componentKey: info.key || null,
    componentSetKey: set.key || null, name: info.name || node.name,
    setName: set.name || null, remote: info.remote ?? null };
}

export function validateMapping(mapping) {
  if (mapping.version !== 1 || !Array.isArray(mapping.entries)) throw new Error('Mapping must have version: 1 and entries: [].');
  for (const e of mapping.entries) {
    if (e.match && Object.keys(e.match).some(k=>!['componentKey','componentSetKey','componentId','nodeId','fileKey'].includes(k))) throw new Error('Unknown identity matcher. Use componentKey/componentSetKey or file-scoped IDs.');
    if (!e.match || !['componentKey', 'componentSetKey', 'componentId', 'nodeId'].some(k => typeof e.match[k] === 'string' && e.match[k])) {
      throw new Error('Each mapping requires match.componentKey, componentSetKey, componentId or nodeId. Names alone are not identities.');
    }
    if ((e.match.componentId || e.match.nodeId) && !e.match.fileKey) throw new Error('Node/component IDs are file-scoped: add match.fileKey (use keys for cross-file reuse).');
    if (e.target !== null && (typeof e.target !== 'string' || !e.target.trim())) throw new Error('Mapping target must be a nonempty YAML component name or null for unresolved.');
    for (const field of ['props','when','propBindings']) if (e[field] != null && (typeof e[field] !== 'object' || Array.isArray(e[field]))) throw new Error(`${field} must be an object.`);
    if(e.failClosed!==undefined && typeof e.failClosed!=='boolean')throw new Error('failClosed must be a boolean.');
  }
}

export function findMapping(node, snapshot, mapping) {
  const info = identity(node, snapshot);
  const hits = mapping.entries.filter(e => e.target && Object.entries(e.match).every(([k,v]) =>
    k === 'nodeId' ? node.id === v : k === 'fileKey' ? snapshot.fileKey === v : info[k] === v
  ) && Object.entries(e.when || {}).every(([k,v]) => node.componentProperties?.[k]?.value === v));
  if (hits.length > 1) throw new Error(`Ambiguous component mapping for ${node.id}: ${hits.length} entries match. Make variant conditions disjoint.`);
  return hits[0] || null;
}

export function discover(snapshot, catalog = []) {
  const groups = new Map();
  for (const n of walk(snapshot.document)) {
    if (n.type !== 'INSTANCE') continue;
    const info = identity(n, snapshot);
    const groupKey = info.componentKey || info.componentId || `node:${n.id}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { ...info, instances: [], propertyValues: {} });
    const g = groups.get(groupKey); g.instances.push(n.id);
    for (const [name, prop] of Object.entries(n.componentProperties || {})) {
      g.propertyValues[name] ||= [];
      if (!g.propertyValues[name].some(v => JSON.stringify(v) === JSON.stringify(prop.value))) g.propertyValues[name].push(prop.value);
    }
  }
  const normalize = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return { version: 1, entries: [...groups.values()].map(g => ({
    match: g.componentKey ? { componentKey: g.componentKey } : g.componentId
      ? { fileKey: snapshot.fileKey || 'SET_FILE_KEY', componentId: g.componentId }
      : { fileKey: snapshot.fileKey || 'SET_FILE_KEY', nodeId: g.instances[0] },
    target: null,
    figmaName: g.name, componentSetKey: g.componentSetKey, componentSetName: g.setName,
    instanceCount: g.instances.length, exampleNodeId: g.instances[0], propertyValues: g.propertyValues,
    contentCandidates: [...walk([...walk(snapshot.document)].find(n=>n.id===g.instances[0]))].slice(1).filter(n=>n.type==='TEXT' || n.type==='INSTANCE' || (n.fills||[]).some(p=>p.type==='IMAGE')).map(n=>({id:n.id,name:n.name,type:n.type,visible:n.visible ?? null,propertyReferences:n.componentPropertyReferences || {},...(n.type==='INSTANCE'?{identity:identity(n,snapshot)}:{})})),
    specCandidates: catalog.filter(c => normalize(c.component) === normalize(g.setName || g.name)),
  })) };
}
