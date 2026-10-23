export const spacingFields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'itemSpacing', 'counterAxisSpacing', 'gridRowGap', 'gridColumnGap'];
const own = (obj, key) => Object.hasOwn(obj, key);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function normalizeVariables(payload) {
  const data = payload?.meta || payload;
  if (!object(data?.variables) || !object(data?.variableCollections)) {
    throw new Error('Variable catalog must contain variables and variableCollections (Figma local-variables response).');
  }
  for (const [id, variable] of Object.entries(data.variables)) {
    if (!object(variable) || variable.id !== id || typeof variable.name !== 'string' ||
        typeof variable.variableCollectionId !== 'string' || !object(variable.valuesByMode)) {
      throw new Error('Invalid variable catalog entry. Preserve the IDs and valuesByMode from Figma.');
    }
  }
  for (const [id, collection] of Object.entries(data.variableCollections)) {
    if (!object(collection) || collection.id !== id || !Array.isArray(collection.modes) ||
        collection.modes.some(mode => typeof mode.modeId !== 'string' || typeof mode.name !== 'string')) {
      throw new Error('Invalid variable collection. Preserve the collection IDs and modes from Figma.');
    }
  }
  return data;
}

export function hasSpacingBindings(snapshot) {
  function visit(node, visible = true) {
    if (!visible || node.visible === false) return false;
    return spacingFields.some(field => node.boundVariables?.[field]) ||
      (node.children || []).some(child => visit(child, true));
  }
  return visit(snapshot.document);
}

// No numeric value-to-name lookup: identity always follows an actual binding ID.
export function resolveSpacingTokens(node, catalog, modes = {}) {
  const tokens = {};
  for (const field of spacingFields) {
    const binding = node.boundVariables?.[field];
    if (!binding) continue;
    const token = {value: Number.isFinite(node[field]) ? node[field] : null,
      bindingId: typeof binding.id === 'string' ? binding.id : null, status: 'unresolved'};
    tokens[field] = token;
    if (binding.type !== 'VARIABLE_ALIAS' || !token.bindingId) {
      token.reason = 'unsupported-binding'; continue;
    }
    if (!catalog) { token.reason = 'catalog-unavailable'; continue; }
    const chain = [], seen = new Set();
    let id = binding.id, assumedMode = false;
    while (true) {
      if (seen.has(id)) { token.reason = 'alias-cycle'; break; }
      seen.add(id);
      const variable = catalog.variables[id];
      if (!variable) { token.reason = 'variable-missing'; break; }
      if (seen.size === 1) Object.assign(token, {name: variable.name, ...(variable.key ? {key: variable.key} : {})});
      const collection = catalog.variableCollections[variable.variableCollectionId];
      if (!collection) { token.reason = 'collection-missing'; break; }
      if (seen.size === 1) token.collection = collection.name || collection.id;
      if (variable.resolvedType !== 'FLOAT') { token.reason = 'not-numeric'; break; }
      const modeId = modes[collection.id] || collection.defaultModeId;
      const mode = collection.modes.find(item => item.modeId === modeId);
      if (!mode || !own(variable.valuesByMode, modeId)) { token.reason = 'mode-value-missing'; break; }
      assumedMode ||= !modes[collection.id];
      chain.push({id, name: variable.name, collectionId: collection.id, modeId});
      if (chain.length === 1) Object.assign(token, {
        modeId, mode: mode.name,
      });
      const value = variable.valuesByMode[modeId];
      if (value?.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') { id = value.id; continue; }
      if (!Number.isFinite(value)) { token.reason = 'not-numeric'; break; }
      token.resolvedValue = value;
      token.modeSource = assumedMode ? 'collection-default-unverified' : 'node-or-ancestor';
      token.status = assumedMode ? 'mode-unverified' : 'resolved';
      if (token.value !== null && Math.abs(value - token.value) > 1e-6) token.status = 'value-mismatch';
      break;
    }
    if (chain.length) token.aliasChain = chain;
  }
  return tokens;
}

export async function getVariables(fileKey, {token, fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onProgress = () => {}} = {}) {
  if (!token) throw new Error('Variable lookup needs FIGMA_TOKEN.');
  for (let attempt = 0; attempt < 3; attempt++) {
    onProgress(`Reading Figma variables: attempt ${attempt + 1}/3`);
    let response;
    try {
      response = await fetchImpl(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/variables/local`, {
        headers: {'X-Figma-Token': token}, redirect: 'error', signal: AbortSignal.timeout(60000),
      });
    } catch { throw new Error('Variable lookup failed or timed out. Numeric spacing is still available.'); }
    if (response.status === 429) {
      const header = response.headers.get('retry-after');
      const seconds = header && /^\d+(\.\d+)?$/.test(header) ? Number(header)
        : header ? Math.max(0, (Date.parse(header) - Date.now()) / 1000) : NaN;
      if (!Number.isFinite(seconds) || seconds > 30 || attempt === 2) {
        throw new Error(`Variable lookup rate limited; retry ${Number.isFinite(seconds) ? `after at least ${Math.ceil(seconds)} seconds` : 'later'}.`);
      }
      onProgress(`Variable lookup rate limited; waiting ${Math.ceil(seconds)}s`);
      await sleep(Math.ceil(seconds * 1000)); continue;
    }
    if (response.status >= 500 && attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
    if ([401, 403].includes(response.status)) {
      let detail='';
      try { const body=await response.json(); detail=String(body.err || body.message || '').toLowerCase(); } catch {}
      const cause=response.status===401?'authentication':
        /scope/.test(detail)?'missing-scope':/enterprise|plan|seat/.test(detail)?'account-eligibility':
        /file.*access|permission.*file/.test(detail)?'file-access':'undetermined';
      const error=new Error(`Variable lookup denied (HTTP ${response.status}, ${cause}): check file_variables:read, file access and Enterprise eligibility. Source values are retained; no token names guessed.`);
      error.details={httpStatus:response.status,cause};throw error;
    }
    if (!response.ok) throw new Error(`Variable lookup HTTP ${response.status}.`);
    let payload;
    try { payload = await response.json(); } catch { throw new Error('Variable lookup returned invalid JSON.'); }
    return normalizeVariables(payload);
  }
}
