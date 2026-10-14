// Adapted from TemPad sanitize/negative-gap.ts (MIT, see THIRD-PARTY-NOTICES.md).
// Narrowed to non-wrapping authored flow: only later in-flow siblings receive a
// negative main-axis margin. Absolute and hidden nodes do not consume a gap.
export function applyNegativeGap(children,nodes,parent) {
  if(!(parent.itemSpacing<0) || parent.layoutWrap==='WRAP' || !['HORIZONTAL','VERTICAL'].includes(parent.layoutMode))return;
  const key=parent.layoutMode==='HORIZONTAL'?'marginLeft':'marginTop';let seen=false;
  nodes.forEach((n,i)=>{
    if(n.visible===false || n.layoutPositioning==='ABSOLUTE')return;
    const style=children[i]?.box?.style;
    if(seen && style)style[key]=addPxOrCalc(style[key],parent.itemSpacing);
    seen=true;
  });
}
function parsePxLiteral(value) {
  if(!value)return null;
  const match=value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  if(!match)return null;
  const n=Number(match[1]);return Number.isFinite(n)?n:null;
}
function addPxOrCalc(existing,deltaPx) {
  const px=parsePxLiteral(existing);
  if(px!=null)return `${px+deltaPx}px`;
  if(!existing)return `${deltaPx}px`;
  const sign=deltaPx<0?'-':'+';
  return `calc(${existing.trim()} ${sign} ${Math.abs(deltaPx)}px)`;
}
