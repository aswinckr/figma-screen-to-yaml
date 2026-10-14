export function frame(id,extra={}) {
  return {id,name:`Frame ${id}`,type:'FRAME',size:{x:375,y:600},relativeTransform:[[1,0,0],[0,1,0]],
    visible:true,layoutMode:'VERTICAL',paddingTop:16,paddingRight:16,paddingBottom:16,paddingLeft:16,
    itemSpacing:12,primaryAxisAlignItems:'MIN',counterAxisAlignItems:'CENTER',clipsContent:false,children:[],...extra};
}
export function button(id='2:1',extra={}) {
  return frame(id,{type:'INSTANCE',name:'Renamed by designer',componentId:'10:1',size:{x:343,y:48},
    relativeTransform:[[1,0,16],[0,1,16]],paddingLeft:99,itemSpacing:99,
    componentProperties:{'Label#11:0':{type:'TEXT',value:'Pay: "now"\nNext line'},'Disabled#11:1':{type:'BOOLEAN',value:false}},
    children:[frame('2:2',{type:'TEXT',characters:'Internal label',size:{x:100,y:20}})],...extra});
}
export function fixture(root=frame('1:1',{name:'Demo screen',children:[button()]})) {
  return {_exportSource:{fileKey:'DEMOFILE',nodeId:root.id,version:'demo-1'},version:'demo-1',nodes:{[root.id]:{
    document:root,components:{'10:1':{key:'demo-button-key',name:'Size=Small, Style=Text',componentSetId:'10:0',remote:true}},
    componentSets:{'10:0':{key:'demo-button-set-key',name:'Button'}}}}};
}
export const mapping={version:1,entries:[{match:{componentKey:'demo-button-key'},target:'button-small',contentReviewed:true,preset:'button-small',
  props:{fullWidth:false,startContent:null},propertyRules:[{from:'Label#11:0',to:'text'},{from:'Disabled#11:1',to:'props.disabled'}]}]};
