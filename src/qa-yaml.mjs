import YAML from 'yaml';
import {canonical} from './exporter.mjs';
// Flow format only for bounded records; hierarchy stays flat and readable.
// No precision rounding, data deletion, YAML anchors or custom tags.
export function serializeQA(screen){
 const doc=new YAML.Document(canonical(screen));
 for(const group of ['values','tokenResolutions','identities','mappings','styles','components','componentSets']){
  const map=doc.getIn(['catalogs',group]);for(const pair of map.items){if(YAML.isCollection(pair.value))pair.value.flow=true;}
 }
 for(const section of ['nodes','hiddenNodes'])for(const item of doc.get(section).items){
  for(const key of ['properties','propertyRefs','children','tokens','styleBindings','effectiveLayout']){const value=item.get(key,true);if(YAML.isCollection(value))value.flow=true;}
 }
 return '# Full QA evidence v1. Hydrate references with src/qa.mjs. No omitted source-node properties.\n'+doc.toString({lineWidth:0,aliasDuplicateObjects:false});
}
