import fs from 'node:fs';import YAML from 'yaml';import {restoreQATree,readQANode} from '../src/qa.mjs';
function diff(a,b,path='',out=[]){if(a===b)return out;if(typeof a!==typeof b||a===null||b===null||typeof a!=='object'){out.push(path);return out;}for(const k of new Set([...Object.keys(a),...Object.keys(b)])){if(!(k in a)||!(k in b))out.push(path+'.'+k);else diff(a[k],b[k],path+'.'+k,out);}return out;}
for(let i=1;i<=2;i++){
 const dir=`two-screen-review/qa-screen-${i}`;const q=YAML.parse(fs.readFileSync(`${dir}/screen.yaml`,'utf8'));const raw=JSON.parse(fs.readFileSync(`${dir}/raw.figma.json`));const source=raw.nodes[q.meta.figmaNodeId].document;
 const mismatches=diff(restoreQATree(q),source);const nodes=q.nodes.map(n=>readQANode(q,n)); const tally={};for(const n of nodes)for(const [k,v]of Object.entries(n))if(v!==null&&(!Array.isArray(v)||v.length))tally[k]=(tally[k]||0)+1;
 const stats={title:q.meta.title,mismatches,active:q.nodes.length,hidden:q.hiddenNodes.length,propertyCount:q.coverage.sourcePropertyCount,root:source.absoluteBoundingBox,activeFields:tally,tokenStates:Object.values(q.catalogs.tokenResolutions).reduce((a,t)=>(a[t.status]=(a[t.status]||0)+1,a),{}),styleNames:Object.values(q.catalogs.styles).map(s=>s.name),accessibility:q.coverage.accessibility};
 const examples={text:nodes.filter(n=>n.type==='TEXT').slice(0,18).map(n=>({id:n.id,name:n.name,text:n.characters,style:n.style,styles:n.styles})),layout:nodes.filter(n=>n.layoutMode).slice(0,20).map(n=>({id:n.id,name:n.name,box:n.absoluteBoundingBox,padding:[n.paddingTop,n.paddingRight,n.paddingBottom,n.paddingLeft],gap:n.itemSpacing,align:n.primaryAxisAlignItems,radius:n.cornerRadius})),components:q.nodes.filter(n=>n.component).slice(0,20).map(n=>({name:n.name,identity:q.catalogs.identities[n.component],props:readQANode(q,n).componentProperties}))};
 fs.writeFileSync(`${dir}/review-proof.json`,JSON.stringify({stats,examples},null,2));
 console.log('SCREEN',i,JSON.stringify(stats));
 console.log('TEXT',JSON.stringify(examples.text.map(n=>({text:n.text,font:n.style.fontFamily,size:n.style.fontSize,weight:n.style.fontWeight,line:n.style.lineHeightPx,style:Object.values(n.styles||{}).map(id=>q.catalogs.styles[id]?.name)}))));
 console.log('LAYOUT',JSON.stringify(examples.layout));
 console.log('COMPONENTS',JSON.stringify(examples.components.slice(0,8)));
}
