import { createHash } from 'node:crypto';
import {visualStyle,textRuns,resizingStyle} from './visuals.mjs';
import {extractFacts} from './facts.mjs';
import {applyNegativeGap} from './negative-gap.mjs';
import {compileComponent} from './components.mjs';
import { identity, findMapping, validateMapping, walk } from './input.mjs';

const own = (o,k) => Object.hasOwn(o,k);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const px = n => `${Object.is(n,-0) ? 0 : n}px`;
const nodeId = n => `figma-${Buffer.from(n.id).toString('hex')}`;
const align = { MIN: 'start', MAX: 'end', CENTER: 'center', BASELINE: 'baseline', SPACE_BETWEEN: 'space-between' };
const layoutFields = ['layoutMode','paddingTop','paddingRight','paddingBottom','paddingLeft','itemSpacing',
  'primaryAxisAlignItems','counterAxisAlignItems','primaryAxisSizingMode','counterAxisSizingMode',
  'layoutSizingHorizontal','layoutSizingVertical','layoutAlign','layoutGrow','layoutPositioning','layoutWrap',
  'counterAxisSpacing','counterAxisAlignContent','itemReverseZIndex','strokesIncludedInLayout',
  'gridRowCount','gridColumnCount','gridRowGap','gridColumnGap','gridRowsSizing','gridColumnsSizing',
  'gridAutoTracks','gridItemsPositioning','gridRowAnchorIndex','gridColumnAnchorIndex','gridRowSpan','gridColumnSpan',
  'gridChildHorizontalAlign','gridChildVerticalAlign','minWidth','maxWidth','minHeight','maxHeight'];
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => own(obj,k)).map(k => [k,obj[k]]));

export function dimensions(n) {
  if (finite(n.size?.x) && finite(n.size?.y)) return { width: n.size.x, height: n.size.y, source: 'size' };
  if (finite(n.width) && finite(n.height)) return { width: n.width, height: n.height, source: 'width/height' };
  if (n.absoluteBoundingBox) return { width: n.absoluteBoundingBox.width, height: n.absoluteBoundingBox.height, source: 'absoluteBoundingBox' };
  return null;
}
function transform(n, parent) {
  if (Array.isArray(n.relativeTransform)) return n.relativeTransform;
  if (finite(n.x) && finite(n.y)) return [[1,0,n.x],[0,1,n.y]];
  // Absolute AABB subtraction is not parent-local geometry under transformed ancestors.
  // Require a local transform or local x/y instead of silently guessing.
  return null;
}
export function relativeBounds(n, parent) {
  const d = dimensions(n), t = transform(n,parent);
  if (!d || !t) return null;
  // If size is only an already-rotated AABB, applying the transform again is wrong.
  if (d.source === 'absoluteBoundingBox' && (t[0][0] !== 1 || t[0][1] !== 0 || t[1][0] !== 0 || t[1][1] !== 1)) return null;
  const points = [[0,0],[d.width,0],[0,d.height],[d.width,d.height]].map(([x,y]) =>
    [t[0][0]*x+t[0][1]*y+t[0][2],t[1][0]*x+t[1][1]*y+t[1][2]]);
  const x = Math.min(...points.map(p=>p[0])), y = Math.min(...points.map(p=>p[1]));
  return { x,y,width:Math.max(...points.map(p=>p[0]))-x,height:Math.max(...points.map(p=>p[1]))-y };
}

export function compile(snapshot, { mapping = { version: 1, entries: [] }, template = { meta: { library: 'example-library' }, body: [] }, assets = {}, sizing = 'snapshot' } = {}) {
  validateMapping(mapping);
  if(!['snapshot','responsive'].includes(sizing))throw new Error('sizing must be snapshot or responsive.');
  const facts=extractFacts(snapshot);
  const hiddenIds=new Set(facts.nodes.filter(n=>n.effectiveVisible===false).map(n=>n.id));
  if (!template.meta || typeof template.meta !== 'object' || !Array.isArray(template.body) || template.body.length) {
    throw new Error('Template must have a meta object and an empty body array. It is a screen-layout template, not a per-component spec.');
  }
  if (Object.keys(template).some(k => !['meta','body','behavior'].includes(k))) throw new Error('Template supports meta/body plus explicitly supplied behavior.');
  const diagnostics = [], measurements = [], boundaries = [], assetCandidates = [];
  const add = (code,n,message,severity='warning') => diagnostics.push({ severity,code,nodeId:n.id,message });
  if (!snapshot.rest) add('PARTIAL_NODE_EXPORT',snapshot.document,'Bare node export: omitted fields are unknown, not API defaults. Re-fetch through REST for complete layout and component identity.');
  const rootSize = dimensions(snapshot.document);
  let emitted = 0, excluded = 0;

  function assetFor(n) {
    if(assets[n.id])return assets[n.id];
    if(hiddenIds.has(n.id))return null; // Hidden source remains in facts, but needs no visible asset.
    add('ASSET_NOT_EXPORTED',n,'No local asset is available. Run a live export or supply --asset-manifest.');return null;
  }
  function visit(n, parent, parentVisible = true, index = 0) {
    emitted++;
    const id = nodeId(n), d = dimensions(n), rel = parent ? relativeBounds(n,parent) : null;
    const t = parent ? transform(n,parent) : null;
    const visible = parentVisible === false || n.visible === false ? false : snapshot.rest || n.visible === true ? parentVisible : null;
    const mode = n.layoutMode ?? (snapshot.rest ? 'NONE' : null);
    const mapped = findMapping(n,snapshot,mapping);
    const pd = parent ? dimensions(parent) : null;
    const record = { id,figmaNodeId:n.id,name:n.name || '',type:n.type,parentId:parent ? nodeId(parent) : null,
      childIndex:index, effectiveVisible:visible, size:d, boundsInParent:rel,
      measuredEdgeDistances:rel && pd ? { top:rel.y,right:pd.width-rel.x-rel.width,bottom:pd.height-rel.y-rel.height,left:rel.x } : null,
      layout:pick(n,layoutFields), ...pick(n,['constraints','relativeTransform','absoluteBoundingBox','absoluteRenderBounds',
        'clipsContent','visible','opacity','isMask','maskType','scrollBehavior','overflowDirection','boundVariables','styles']) };
    if (n.type === 'INSTANCE') { record.component = identity(n,snapshot); record.componentProperties = n.componentProperties || {}; }
    measurements.push(record);
    if (!d) add('MISSING_SIZE',n,'No dimensions found; size omitted.');
    if (parent && !rel) add('MISSING_RELATIVE_GEOMETRY',n,'Cannot measure in parent coordinates. Fetch with geometry=paths; no distances guessed.');
    if (d?.source === 'absoluteBoundingBox') add('BOUNDS_SIZE_FALLBACK',n,'Only absolute bounds available; rotated local dimensions may be unavailable.');
    if (n.scrollBehavior && n.scrollBehavior !== 'SCROLLS') add('SCROLL_BEHAVIOR_RECORDED',n,'Fixed/sticky behavior is preserved in measurements, not inferred as pinned top/bottom in YAML.');
    if (n.isMask) add('MASK_NOT_COMPILED',n,'Mask geometry is retained in raw data; screen layout is not a visual reproduction.');

    const style = { boxSizing:'border-box' };
    if (d) { style.width=px(d.width); style.height=px(d.height); }
    if (visible === false) style.display='none';
    if (own(n,'opacity')) style.opacity=n.opacity;
    if (n.clipsContent === true) style.overflow='hidden';
    if (n.layoutAlign === 'STRETCH') style.alignSelf='stretch';
    // Measured sizes are intentionally fixed: this exporter describes this screen snapshot,
    // not invented responsive behavior. Original HUG/FILL rules stay in measurements.json.
    if (parent && ['HORIZONTAL','VERTICAL'].includes(parent.layoutMode) && n.layoutPositioning !== 'ABSOLUTE') style.flexShrink=0;
    const autoParent = parent && ['HORIZONTAL','VERTICAL','GRID'].includes(parent.layoutMode);
    const absolute = parent && (!autoParent || n.layoutPositioning === 'ABSOLUTE');
    style.position = absolute ? 'absolute' : 'relative';
    if(n.itemReverseZIndex)style.isolation='isolate';
    if(parent?.itemReverseZIndex)style.zIndex=parent.children.length-index;
    if (absolute) {
      if (t) { style.left=px(t[0][2]); style.top=px(t[1][2]); }
      else add('POSITION_NOT_COMPILED',n,'Missing local transform; absolute position cannot be emitted.');
    }
    if (t && (t[0][0] !== 1 || t[0][1] !== 0 || t[1][0] !== 0 || t[1][1] !== 1)) {
      style.transformOrigin='0 0'; style.transform=`matrix(${t[0][0]}, ${t[1][0]}, ${t[0][1]}, ${t[1][1]}, 0, 0)`;
      if (autoParent && !absolute) add('TRANSFORMED_FLOW_ITEM',n,'Transform preserved; CSS flow under rotation may differ from Figma. Compare before rendering use.');
    }
    if (parent?.layoutMode === 'GRID') {
      if (finite(n.gridColumnAnchorIndex)) style.gridColumn=`${n.gridColumnAnchorIndex+1} / span ${n.gridColumnSpan ?? 1}`;
      if (finite(n.gridRowAnchorIndex)) style.gridRow=`${n.gridRowAnchorIndex+1} / span ${n.gridRowSpan ?? 1}`;
      if (n.gridChildHorizontalAlign && n.gridChildHorizontalAlign !== 'AUTO') style.justifySelf=align[n.gridChildHorizontalAlign];
      if (n.gridChildVerticalAlign && n.gridChildVerticalAlign !== 'AUTO') style.alignSelf=align[n.gridChildVerticalAlign];
    }
    if(sizing==='responsive')resizingStyle(style,n,parent);
    const box = { id,style }, result = { box,children:[] };

    if (mapped) {
      const component=compileComponent(n,mapped,{snapshot,mapping,add,assetFor,nodeId});
      result.children.push(component);
      const internalCount=[...walk(n)].length-1; excluded+=internalCount;
      boundaries.push({ figmaNodeId:n.id,component:mapped.target,excludedInternalNodes:internalCount });
      // Do NOT copy the component's padding/layout into its outer placement wrapper.
      return result;
    }
    Object.assign(style,visualStyle(n,add));
    if (n.type === 'INSTANCE') add('UNMAPPED_COMPONENT',n,'No reviewed identity mapping. Keeping this instance as a container and traversing its children; not guessing library identity.');
    const layout = {};
    if (['HORIZONTAL','VERTICAL','GRID'].includes(mode)) {
      // REST omits documented zero defaults. Bare plugin/node exports remain unknown.
      // https://developers.figma.com/docs/rest-api/file-node-types/#frame
      const defaulted={};
      const layoutNumber=k=>{
        if(own(n,k))return n[k];
        if(snapshot.rest){defaulted[k]=0;return 0;}
        return undefined;
      };
      const padding=['paddingTop','paddingRight','paddingBottom','paddingLeft'].map(layoutNumber);
      if (padding.every(finite)) layout.padding=padding;
      else {
        add('MISSING_PADDING',n,'Not all four authored padding values are present; no complete padding array invented.');
        ['Top','Right','Bottom','Left'].forEach((side,i)=>{ if(finite(padding[i])) style[`padding${side}`]=px(padding[i]); });
      }
      if (mode === 'GRID') {
        if (visible !== false) style.display='grid';
        if (n.gridColumnsSizing) style.gridTemplateColumns=n.gridColumnsSizing;
        else add('GRID_TRACKS_MISSING',n,'Exact column tracks unavailable; column count is preserved, not converted into guessed equal-width tracks.');
        if (n.gridRowsSizing) style.gridTemplateRows=n.gridRowsSizing;
        if (finite(n.gridColumnGap)) style.columnGap=px(n.gridColumnGap);
        if (finite(n.gridRowGap)) style.rowGap=px(n.gridRowGap);
      } else {
        layout.direction=mode==='HORIZONTAL'?'horizontal':'vertical';
        const gap=layoutNumber('itemSpacing');
        if (finite(gap)) {
          if(gap>=0) layout.gap=gap;
          else if(n.layoutWrap==='WRAP')add('NEGATIVE_GAP',n,'Wrapped negative gap retained in facts; not safely expressible with a simple margin rule.');
          else layout.gap=0;
        } else add('MISSING_GAP',n,'Authored gap is missing; omitted.');
        const main=n.primaryAxisAlignItems ?? (snapshot.rest?'MIN':null), cross=n.counterAxisAlignItems ?? (snapshot.rest?'MIN':null);
        if (align[main]) layout.justify=align[main]; else add('MISSING_MAIN_ALIGNMENT',n,'Main-axis alignment is unknown.');
        if (align[cross]) layout.align=align[cross]; else add('MISSING_CROSS_ALIGNMENT',n,'Cross-axis alignment is unknown.');
        if (n.layoutWrap==='WRAP') {
          style.flexWrap='wrap';
          if(finite(n.counterAxisSpacing)) style[mode==='HORIZONTAL'?'rowGap':'columnGap']=px(n.counterAxisSpacing);
          if(n.counterAxisAlignContent==='SPACE_BETWEEN') style.alignContent='space-between';
        }
      }
      if(Object.keys(defaulted).length)record.apiDefaults=defaulted;
    } else if (mode && mode !== 'NONE') add('UNSUPPORTED_LAYOUT_MODE',n,`Layout mode ${mode} retained only in raw data.`);
    if (Object.keys(layout).length) box.layout=layout;
    if (n.type === 'TEXT') {
      if (typeof n.characters==='string') {
        const runs=textRuns(n);
        if(runs.length<=1)result.children.push({text:n.characters,id:`${id}-text`});
        else for(const [i,run] of runs.entries()) {
          result.children.push({box:{id:`${id}-run-${i}`,style:{display:'inline',...run.style}},children:[{text:run.text,id:`${id}-text-${i}`}]});
          if(run.hyperlink)add('TEXT_LINK_RECORDED',n,'Rich-text hyperlink retained in facts; no navigation behavior invented.');
        }
      } else add('MISSING_TEXT',n,'TEXT node has no characters. Layer name is not substituted for content.');
    }
    const paints=(n.fills || []).filter(p=>p.visible!==false && p.type==='IMAGE');
    if (paints.length || ['VECTOR','BOOLEAN_OPERATION','ELLIPSE','STAR','POLYGON'].includes(n.type)) {
      assetCandidates.push({figmaNodeId:n.id,type:n.type,imageRefs:paints.map(p=>p.imageRef||p.imageHash).filter(Boolean)});
      const asset=assetFor(n);
      if(asset) {
        // Rendered-node images include the descendants, paint, border, and effects.
        // Do not emit those a second time. Placement remains in the wrapper.
        if(asset.kind==='rendered-node') {
          for(const key of ['border','borderTop','borderRadius','boxShadow','backgroundColor','opacity'])delete style[key];
          style.backgroundImage=`url("${asset.path}")`;style.backgroundSize='100% 100%';style.backgroundRepeat='no-repeat';
          if(t && (t[0][0]!==1 || t[0][1]!==0 || t[1][0]!==0 || t[1][1]!==1))add('RASTER_TRANSFORM_REVIEW',n,'Node rendering may bake transforms into pixels; compare against reference.png before relying on rotated asset parity.');
          return result;
        }
        style.backgroundImage=`url("${asset.path}")`;style.backgroundSize='100% 100%';style.backgroundRepeat='no-repeat';
      }
    }
    const rendered=(n.children || []).map((child,i)=>visit(child,n,visible,i));
    applyNegativeGap(rendered,n.children || [],n);
    result.children.push(...rendered);
    return result;
  }
  const body=[visit(snapshot.document,null)];
  const screen={...(template.behavior?{behavior:structuredClone(template.behavior)}:{}),meta:{...structuredClone(template.meta),title:snapshot.document.name || 'Screen',
    ...(rootSize ? {size:`${rootSize.width} x ${rootSize.height}`} : {}),
    ...(snapshot.fileKey ? {figmaFileKey:snapshot.fileKey} : {}),figmaNodeId:snapshot.document.id},body};
  const gaps=[];
  for (const parent of measurements) {
    const mode=parent.layout.layoutMode;
    if (!['HORIZONTAL','VERTICAL'].includes(mode)) continue;
    const children=measurements.filter(m=>m.parentId===parent.id && m.effectiveVisible!==false && m.layout.layoutPositioning!=='ABSOLUTE');
    for(let i=1;i<children.length;i++) {
      const a=children[i-1],b=children[i]; if(!a.boundsInParent || !b.boundsInParent) continue;
      const axis=mode==='HORIZONTAL'?'x':'y',extent=axis==='x'?'width':'height';
      gaps.push({parentId:parent.id,from:a.id,to:b.id,axis,
        distance:b.boundsInParent[axis]-a.boundsInParent[axis]-a.boundsInParent[extent],
        definition:'signed AABB edge distance between consecutive flow children in authored order; not necessarily itemSpacing (wrap/space-between/rotation)'});
    }
  }
  const counts={}; for(const diag of diagnostics) counts[diag.code]=(counts[diag.code]||0)+1;
  return { screen, facts, measurements:{schemaVersion:1,units:'Figma px',
    note:'Measured edge distances are signed, parent-local axis-aligned geometry, NOT authored padding. Sizes in YAML describe this snapshot, not responsive rules.',
    source:{fileKey:snapshot.fileKey,nodeId:snapshot.document.id,version:snapshot.version},nodes:measurements,siblingGaps:gaps,boundaries,assetCandidates},
    diagnostics:{schemaVersion:1,status:diagnostics.length?'needs-review':'layout-exported',
      scope:'Structured screen draft; renderer compatibility and live visual fidelity require verification.',
      summary:{extractedNodes:facts.nodes.length,emittedNodes:emitted,recognizedComponents:boundaries.length,excludedComponentInternalNodes:excluded,counts},items:diagnostics} };
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
