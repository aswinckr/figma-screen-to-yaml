export function parseFigmaUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Supply a Figma screen URL, or use --input for a saved JSON file.'); }
  if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname)) {
    throw new Error('Expected an https://figma.com/ or https://www.figma.com/ URL.');
  }
  const match = url.pathname.match(/^\/(?:design|file|proto)\/([a-zA-Z0-9]+)(?:\/|$)/);
  const rawId = url.searchParams.get('node-id');
  if (!match || !rawId) throw new Error('Copy a link to the selected screen frame (it must contain node-id).');
  const nodeId = rawId.replace(/^(\d+)-(\d+)$/, '$1:$2');
  if (!/^[\w:;.-]+$/.test(nodeId)) throw new Error('Invalid Figma node-id.');
  return { fileKey: match[1], nodeId, version: url.searchParams.get('version-id') || undefined };
}

export async function getScreen({ fileKey, nodeId, version }, {
  token, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), maxRetries = 2,
} = {}) {
  if (!token) throw new Error('Set FIGMA_TOKEN in .env or your environment. Offline --input and npm run demo need no token.');
  const query = new URLSearchParams({ ids: nodeId, geometry: 'paths' });
  if (version) query.set('version', version);
  const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?${query}`;
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { headers: { 'X-Figma-Token': token }, redirect: 'error', signal: AbortSignal.timeout(60000) });
    } catch {
      throw new Error('Figma request failed or timed out. Check your network and retry. No files were changed.');
    }
    if (response.status === 429) {
      const header = response.headers.get('retry-after');
      const seconds = header && /^\d+(\.\d+)?$/.test(header) ? Number(header)
        : header ? Math.max(0, (Date.parse(header) - Date.now()) / 1000) : NaN;
      // Never shorten Figma's requested delay. Long limits fail with an actionable retry message.
      if (!Number.isFinite(seconds) || seconds > 30 || attempt >= maxRetries) {
        throw new Error(`Figma rate limit reached. Retry ${Number.isFinite(seconds) ? `after at least ${Math.ceil(seconds)} seconds` : 'later (no usable Retry-After header)'}.`);
      }
      await sleep(Math.ceil(seconds * 1000));
      continue;
    }
    if (response.status >= 500 && attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
    if (response.status === 401 || response.status === 403) throw new Error('Figma denied access. Check token expiry, file_content:read scope, and permission to this file.');
    if (response.status === 404) throw new Error('Figma file not found or not accessible to this token.');
    if (!response.ok) throw new Error(`Figma returned HTTP ${response.status}.`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Figma returned invalid JSON.'); }
    if (data.err || !data.nodes?.[nodeId]?.document) throw new Error('Selected node was not returned. Check the node link and file access.');
    // No depth parameter: keep the complete selected subtree and metadata.
    return { ...data, _exportSource: { fileKey, nodeId, version: data.version || version || null } };
  }
}
