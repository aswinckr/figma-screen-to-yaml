// REST adapter. Rich text segmentation is inspired by TemPad's collect/text pipeline;
// REST characterStyleOverrides replace the live getStyledTextSegments() call.
const num = Number.isFinite;
const px = n => `${n}px`;
export function color(c, opacity = 1) {
  if (!c || ![c.r,c.g,c.b].every(num)) return undefined;
  return `rgba(${[c.r,c.g,c.b].map(v=>Math.round(v*255)).join(', ')}, ${(c.a ?? 1)*opacity})`;
}
export function textStyle(s = {}, fills = []) {
  const out = {};
  for (const k of ['fontFamily','fontWeight','fontSize']) if (s[k] !== undefined) out[k]=k==='fontSize'?px(s[k]):s[k];
  if (s.italic || /italic/i.test(s.fontStyle || '')) out.fontStyle='italic';
  if (s.fontName?.family) out.fontFamily=s.fontName.family;
  if (num(s.lineHeightPx)) out.lineHeight=px(s.lineHeightPx);
  else if (s.lineHeight?.unit==='PIXELS') out.lineHeight=px(s.lineHeight.value);
  else if (s.lineHeight?.unit==='PERCENT') out.lineHeight=`${s.lineHeight.value}%`;
  if (num(s.letterSpacing)) out.letterSpacing=px(s.letterSpacing);
  else if (s.letterSpacing?.unit==='PIXELS') out.letterSpacing=px(s.letterSpacing.value);
  else if (s.letterSpacing?.unit==='PERCENT') out.letterSpacing=`${s.letterSpacing.value/100}em`;
  if (s.textAlignHorizontal) out.textAlign=({LEFT:'left',RIGHT:'right',CENTER:'center',JUSTIFIED:'justify'})[s.textAlignHorizontal];
  const deco={UNDERLINE:'underline',STRIKETHROUGH:'line-through'}[s.textDecoration];
  if(deco)out.textDecoration=deco;
  const casing={UPPER:'uppercase',LOWER:'lowercase',TITLE:'capitalize'}[s.textCase];
  if(casing)out.textTransform=casing;
  const paints=(s.fills || fills).filter(p=>p.visible!==false);
  if(paints.length===1 && paints[0].type==='SOLID')out.color=color(paints[0].color,paints[0].opacity ?? 1);
  return Object.fromEntries(Object.entries(out).filter(([,v])=>v!==undefined));
}
export function textRuns(n) {
  if(typeof n.characters!=='string')return [];
  const base=n.style || n;
  if(!n.characterStyleOverrides?.length)return [{text:n.characters,start:0,end:n.characters.length,style:textStyle(base,n.fills)}];
  const runs=[];
  for(let start=0;start<n.characters.length;) {
    const key=n.characterStyleOverrides[start] ?? 0;let end=start+1;
    while(end<n.characters.length && (n.characterStyleOverrides[end] ?? 0)===key)end++;
    const override=n.styleOverrideTable?.[key] || {};
    runs.push({text:n.characters.slice(start,end),start,end,style:textStyle({...base,...override},n.fills),
      ...(override.hyperlink?{hyperlink:override.hyperlink}:{})});start=end;
  }
  return runs;
}
export function visualStyle(n,add) {
  const out={};const paints=(n.fills || []).filter(p=>p.visible!==false);
  if(n.type==='TEXT') {
    Object.assign(out,textStyle(n.style || n,n.fills),{whiteSpace:'pre-wrap'});
    if(n.style?.textAlignVertical && n.style.textAlignVertical!=='TOP')add('TEXT_VERTICAL_ALIGNMENT',n,'Vertical text alignment is retained in facts; baseline parity requires renderer verification.');
  } else if(paints.length===1 && paints[0].type==='SOLID')out.backgroundColor=color(paints[0].color,paints[0].opacity ?? 1);
  if(paints.some(p=>!['SOLID','IMAGE'].includes(p.type)) || paints.length>1)add('COMPLEX_PAINT',n,'Multiple/gradient paints retained in facts; use a rendered asset when exact paint composition is required.');
  const strokes=(n.strokes || []).filter(p=>p.visible!==false);
  if(strokes.length===1 && strokes[0].type==='SOLID' && num(n.strokeWeight)) {
    const c=color(strokes[0].color,strokes[0].opacity ?? 1);
    if(n.type==='LINE') {
      out.borderTop=`${n.strokeWeight}px ${n.strokeDashes?.length?'dashed':'solid'} ${c}`;
      out.height='0px';
      if(n.strokeDashes?.length)add('STROKE_DASH_APPROXIMATION',n,'CSS dashed line does not reproduce arbitrary Figma dash lengths; exact pattern remains in facts.');
    } else {
      out.border=`${n.strokeWeight}px solid ${c}`;
      if(n.strokeAlign && n.strokeAlign!=='INSIDE')add('STROKE_ALIGNMENT',n,'CSS border uses inside box sizing; center/outside alignment is retained in facts.');
    }
  } else if(strokes.length)add('COMPLEX_STROKE',n,'Unsupported stroke combination retained in facts.');
  if(num(n.cornerRadius))out.borderRadius=px(n.cornerRadius);
  else if(n.rectangleCornerRadii?.every(num))out.borderRadius=n.rectangleCornerRadii.map(px).join(' ');
  const shadows=[];
  for(const effect of n.effects || []) {
    if(effect.visible===false)continue;
    if(['DROP_SHADOW','INNER_SHADOW'].includes(effect.type) && effect.offset && num(effect.radius))shadows.push(`${effect.type==='INNER_SHADOW'?'inset ':''}${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread ?? 0}px ${color(effect.color)}`);
    else add('UNSUPPORTED_EFFECT',n,`Effect ${effect.type} retained in facts.`);
  }
  if(shadows.length)out.boxShadow=shadows.join(', ');
  return Object.fromEntries(Object.entries(out).filter(([,v])=>v!==undefined));
}

// Adapted from TemPad styles/layout.ts inferResizingStyles (MIT). Uses REST nodes,
// explicit authored layout only, camelCase output, and treats absolute items separately.
export function resizingStyle(style,n,parent) {
  if(n.layoutPositioning==='ABSOLUTE')return;
  const horizontal=parent?.layoutMode==='HORIZONTAL', vertical=parent?.layoutMode==='VERTICAL';
  if(n.layoutSizingHorizontal==='HUG')delete style.width;
  if(n.layoutSizingVertical==='HUG')delete style.height;
  if(n.layoutSizingHorizontal==='FILL') {
    if(horizontal){style.flexGrow=1;style.flexBasis=0;style.minWidth=0;delete style.width;}
    if(vertical){style.alignSelf='stretch';delete style.width;}
  }
  if(n.layoutSizingVertical==='FILL') {
    if(vertical){style.flexGrow=1;style.flexBasis=0;style.minHeight=0;delete style.height;}
    if(horizontal){style.alignSelf='stretch';delete style.height;}
  }
  for(const k of ['minWidth','maxWidth','minHeight','maxHeight'])if(num(n[k]))style[k]=px(n[k]);
}
