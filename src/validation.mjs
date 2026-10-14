import Ajv from 'ajv';
import {readFile} from 'node:fs/promises';
const schema=JSON.parse(await readFile(new URL('../schemas/screen.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({allErrors:true,strict:true,allowUnionTypes:true}).compile(schema);
export function validateScreen(screen) {
  if(!validate(screen)) throw new Error(`YAML schema validation failed: ${JSON.stringify(validate.errors.slice(0,8))}`);
  const ids=new Set();
  function visit(n) {
    if(!n || typeof n!=='object')return;
    if(Array.isArray(n)){n.forEach(visit);return;}
    const id=n.box?.id || n.id;
    if(id!==undefined){if(ids.has(id))throw new Error(`Duplicate YAML id: ${id}`);ids.add(id);}
    if(n.children)visit(n.children);
    if(n.slots)Object.values(n.slots).forEach(visit);
    // Nested component markers may also appear inside props.
    if(n.props)walkProps(n.props);
  }
  function walkProps(value) {
    if(!value || typeof value!=='object')return;
    if(value.$component){visit(value);return;}
    Object.values(value).forEach(walkProps);
  }
  visit(screen.body);if(screen.pinned)Object.values(screen.pinned).forEach(visit);
  return true;
}
export function validateExternal(screen,schema) {
  const check=new Ajv({allErrors:true,strict:false,allowUnionTypes:true}).compile(schema);
  if(!check(screen))throw new Error(`External schema validation failed: ${JSON.stringify(check.errors.slice(0,8))}`);
}
