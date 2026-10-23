#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,access,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {getScreen,parseFigmaUrl} from './api.mjs';
import {selectSnapshot,discover,walk} from './input.mjs';
import {compile,canonical,digest} from './exporter.mjs';
import {collectAssets,loadLocalAssets} from './assets.mjs';
import {validateExternal,validateScreen} from './validation.mjs';
import {getVariables, hasSpacingBindings, normalizeVariables} from './variables.mjs';

import {compileQA} from './qa.mjs';
import {serializeQA} from './qa-yaml.mjs';
import {hasQABindings} from './qa-tokens.mjs';
import {createProgress} from './progress.mjs';
const progress=createProgress();
const onProgress=message=>progress.update(message);

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const help=`Figma → structured screen YAML (no MCP or AI)

  npm run export-screen -- "FIGMA_SCREEN_URL" --out exports/rdp
  npm run export-screen -- --input raw.figma.json --mapping components.json --out exports/rdp
  npm run discover -- "FIGMA_SCREEN_URL" --out exports/catalog
  npm run discover -- --input exports/rdp/raw.figma.json --out exports/catalog
  npm run validate -- exports/rdp/screen.yaml
  npm run demo

Options:
  --input PATH       Offline raw REST response, JSON_REST_V1 export or bare node JSON
  --mapping PATH     Reviewed component identity mappings (default config/components.json)
  --template PATH    meta/body template (default templates/screen.template.yaml)
  --node-id ID       Choose a node in a multi-node offline snapshot
  --file-key KEY     File identity for bare/offline JSON (never guess from another screen)
  --version ID       Pin a live Figma file version
  --out DIRECTORY   New output directory (default exports/screen or exports/discovery)
  --no-assets       Skip live PNG asset downloads (diagnose missing assets)
  --asset-manifest PATH  Offline node-ID → image-path JSON (paths relative to manifest)
  --reference       Also download a reference PNG for the entire frame
  --profile MODE    render (default), spacing (layout only), or qa (full QA evidence)
  --variables PATH  Saved Figma local-variables response for variable names in spacing/qa
  --tokens MODE     auto (default) or off; auto resolves live bindings
  --sizing MODE     snapshot (default) or responsive (explicit HUG/FILL rules)
  --schema PATH     Additionally validate against your renderer's JSON Schema
  --strict          Write diagnostics but exit 2 if review is needed
  --help            Show this help

Put FIGMA_TOKEN in .env in the current folder, or in your environment.
Existing output directories are never overwritten. Use a new --out directory.
Discovery suggests identities, NOT approved YAML aliases: edit target:null before mapping.
Exports complete facts plus a mapped screen draft. Business behavior is never inferred.
`;

async function loadEnv() {
  let text;
  try {text=await readFile(path.resolve('.env'),'utf8');} catch(e) {if(e.code==='ENOENT')return; throw e;}
  // Only consume this tool's credential. Do not evaluate shell expressions or load unrelated keys.
  const m=text.match(/^\s*(?:export\s+)?FIGMA_TOKEN\s*=\s*(.*?)\s*$/m);
  if(!process.env.FIGMA_TOKEN && m) {
    let value=m[1];
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    else value=value.replace(/\s+#.*$/,'');
    process.env.FIGMA_TOKEN=value;
  }
}
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const jsonText=value=>JSON.stringify(canonical(value),null,2)+'\n';

async function main() {
  const {values:opts,positionals}=parseArgs({allowPositionals:true,options:{
    input:{type:'string'},mapping:{type:'string'},template:{type:'string'},'node-id':{type:'string'},
    'file-key':{type:'string'},version:{type:'string'},out:{type:'string'},'no-assets':{type:'boolean'},'asset-manifest':{type:'string'},reference:{type:'boolean'},sizing:{type:'string'},schema:{type:'string'},strict:{type:'boolean'},help:{type:'boolean'},
    profile:{type:'string'},variables:{type:'string'},tokens:{type:'string'},
  }});
  const [command,argument,...extra]=positionals;
  if(opts.help || !command){console.log(help);return;}
  if(extra.length)throw new Error('Unexpected arguments. Quote the complete Figma URL.');
  if(command==='validate') {
    if(!argument)throw new Error('Supply a screen.yaml path.');
    const screen=YAML.parse(await readFile(argument,'utf8'));validateScreen(screen);if(opts.schema)validateExternal(screen,await json(opts.schema));console.log(screen.meta?.profile==='qa'?'Valid full QA evidence YAML (v1).':screen.meta?.profile==='spacing'?'Valid spacing audit YAML (v1).':'Valid screen interchange YAML (v2; optional external schema checked when supplied).');return;
  }
  if(!['export','discover'].includes(command))throw new Error('Unknown command. Use --help.');
  if(opts.input && argument)throw new Error('Use a Figma URL OR --input, not both.');
  if(!opts.input && !argument)throw new Error('Supply a Figma URL or --input JSON.');
  const profile=opts.profile || 'render', tokenMode=opts.tokens || 'auto';
  if(!['render','spacing','qa'].includes(profile))throw new Error('--profile must be render, spacing or qa.');
  if(!['auto','off'].includes(tokenMode))throw new Error('--tokens must be auto or off.');
  if(profile!=='render' && opts.sizing && opts.sizing!=='snapshot')throw new Error('Audit profiles require --sizing snapshot.');
  if(opts.variables && profile==='render')throw new Error('--variables requires --profile spacing or qa.');
  if(opts.variables && tokenMode==='off')throw new Error('Use --variables or --tokens off, not both.');
  const out=path.resolve(opts.out||`exports/${command==='export'?'screen':'discovery'}`);
  try {await access(out);throw new Error(`Output already exists: ${out}. Use a new --out directory.`);} catch(e){if(e.code!=='ENOENT')throw e;}
  onProgress('Starting export');
  let raw;
  if(opts.input){onProgress('Reading local Figma snapshot');raw=await json(opts.input);}
  else {
    await loadEnv();
    const location=parseFigmaUrl(argument);
    if(opts.version)location.version=opts.version;
    raw=await getScreen(location,{token:process.env.FIGMA_TOKEN,onProgress});
  }
  onProgress('Inspecting source layers and component identities');
  const snapshot=selectSnapshot(raw,opts['node-id']);
  if(opts['file-key']) {
    if(snapshot.fileKey && snapshot.fileKey!==opts['file-key'])throw new Error('--file-key conflicts with snapshot source.');
    snapshot.fileKey=opts['file-key'];
  }
  const catalog=await json(path.join(project,'config/spec-catalog.json'));
  const candidates=discover(snapshot,catalog);
  onProgress(`Read ${[...walk(snapshot.document)].length} layers; found ${candidates.entries.length} component identities`);
  const files={'raw.figma.json':jsonText(raw),'components.discovered.json':jsonText(candidates)};
  let result;
  if(command==='export') {
    const mapping=await json(opts.mapping||path.join(project,'config/components.json'));
    const template=YAML.parse(await readFile(opts.template||path.join(project,'templates/screen.template.yaml'),'utf8'));
    let variables=null,variableSource=null;
    const variableDiagnostics=[];
    if(profile!=='render') {
      if(opts.variables) {
        const saved=await json(opts.variables);
        if(saved.source?.fileKey && snapshot.fileKey && saved.source.fileKey!==snapshot.fileKey)throw new Error('Variable catalog belongs to a different Figma file.');
        variables=normalizeVariables(saved);
        variableSource=saved.source || {kind:'supplied-catalog',fileKey:snapshot.fileKey};
      } else if(tokenMode==='auto' && !opts.input && (profile==='qa'?hasQABindings(snapshot):hasSpacingBindings(snapshot))) {
        try {
          variables=await getVariables(snapshot.fileKey,{token:process.env.FIGMA_TOKEN,onProgress});
          // The variables endpoint cannot be version-pinned, unlike the frame.
          variableSource={kind:'current-api',fileKey:snapshot.fileKey,versionPinned:false};
        } catch(error) {
          variableDiagnostics.push({severity:'warning',code:'VARIABLES_UNAVAILABLE',nodeId:snapshot.document.id,message:error.message,...(error.details?{access:error.details}:{})});
          onProgress('Variable names unavailable; retaining source values and binding IDs');
        }
      }
    }
    let assetBundle={entries:{},files:{},diagnostics:[]};
    if(opts['asset-manifest']){onProgress('Loading local assets');assetBundle=await loadLocalAssets(opts['asset-manifest']);}
    else if(!opts.input && (opts.reference || (profile==='render' && !opts['no-assets']))) {
      onProgress('Planning required assets');
      const preview=profile==='render' && !opts['no-assets'] ? compile(snapshot,{mapping,template,sizing:opts.sizing || 'snapshot'}) : null;
      const nodeIds=preview ? preview.diagnostics.items.filter(d=>d.code==='ASSET_NOT_EXPORTED').map(d=>d.nodeId) : [];
      assetBundle=await collectAssets(snapshot,{token:process.env.FIGMA_TOKEN,reference:opts.reference,nodeIds,onProgress});
    }
    onProgress('Compiling screen YAML and source facts');
    result=(profile==='qa'?compileQA:compile)(snapshot,{mapping,template,assets:assetBundle.entries,sizing:opts.sizing || 'snapshot',profile,variables});
    if(profile==='qa')result.screen.meta.variableCatalogSource=variableSource;
    if(opts.reference) {
      const entry=assetBundle.entries[snapshot.document.id];
      const bytes=entry && assetBundle.files[entry.path];
      if(bytes?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))files['reference.png']=bytes;
      else assetBundle.diagnostics.push({severity:'warning',code:'REFERENCE_NOT_EXPORTED',nodeId:snapshot.document.id,
        message:'Requested frame PNG is missing. Retry a live export, or supply an asset manifest containing the frame PNG for offline replay.'});
    }
    result.diagnostics.items.push(...assetBundle.diagnostics,...variableDiagnostics);
    result.diagnostics.summary.counts={};
    for(const d of result.diagnostics.items)result.diagnostics.summary.counts[d.code]=(result.diagnostics.summary.counts[d.code] || 0)+1;
    result.diagnostics.status=result.diagnostics.items.length?'needs-review':'exported';
    Object.assign(files,assetBundle.files);
    files['assets.json']=jsonText({version:1,entries:assetBundle.entries});
    if(variables)files['variables.json']=jsonText({source:variableSource,meta:variables});
    files['facts.json']=jsonText(result.facts);
    onProgress('Validating and serializing output');
    if(opts.schema)validateExternal(result.screen,await json(opts.schema));
    validateScreen(result.screen);
    const serializedScreen=profile==='spacing'?{meta:canonical(result.screen.meta),body:canonical(result.screen.body)}:result.screen;
    files['screen.yaml']=profile==='qa'?serializeQA(result.screen):(profile==='spacing'?'# Spacing audit snapshot v1. Geometry comes from YAML; measurements.json is a cross-check. See docs/SPACING-AUDIT.md.\n':'# Generated screen draft (interchange schema v2). See measurements.json and diagnostics.json for provenance and limits.\n')+YAML.stringify(serializedScreen,{lineWidth:0,aliasDuplicateObjects:false});
    // Reparse to catch serialization issues with literal colons, false, null, newlines, etc.
    validateScreen(YAML.parse(files['screen.yaml']));
    files['measurements.json']=jsonText(result.measurements);
    files['measurements.yaml']=YAML.stringify(profile!=='render'?canonical(result.measurements):result.measurements,{lineWidth:0,aliasDuplicateObjects:false});
    files['diagnostics.json']=jsonText(result.diagnostics);
    if(profile!=='render') {
      result.diagnostics.summary.yamlBytes=Buffer.byteLength(files['screen.yaml']);
      files['diagnostics.json']=jsonText(result.diagnostics);
    }
    files['manifest.json']=jsonText({exporterVersion:'0.4.0',profile,sizing:opts.sizing || 'snapshot',
      ...(profile!=='render'?{variablesSha256:variables?digest(variables):null,variableSource}:{}),
      assetsSha256:digest(assetBundle.entries),inputSha256:digest(raw),mappingSha256:digest(mapping),
      templateSha256:digest(template),source:{fileKey:snapshot.fileKey,nodeId:snapshot.document.id,version:snapshot.version}});
  }
  // Stage a complete bundle, then publish it. Never overwrite existing output.
  onProgress(`Writing ${Object.keys(files).length} output files`);
  await mkdir(path.dirname(out),{recursive:true});
  const staging=`${out}.tmp-${process.pid}`;
  await mkdir(staging);
  try {
    for(const [name,content] of Object.entries(files)){await mkdir(path.dirname(path.join(staging,name)),{recursive:true});await writeFile(path.join(staging,name),content,{flag:'wx'});}
    await access(out).then(()=>{throw new Error('Output appeared while exporting; refusing to overwrite.');},e=>{if(e.code!=='ENOENT')throw e;});
    await rename(staging,out);
  } catch(e) {await rm(staging,{recursive:true,force:true});throw e;}
  onProgress('Export complete');
  console.log(`Saved ${out}`);
  if(result) {
    const s=result.diagnostics.summary;
    console.log(`${s.emittedNodes} active layout nodes; ${s.recognizedComponents} ${profile==='qa'?'component identities':'mapped component boundaries'}; ${result.diagnostics.items.length} review items.`);
    if(profile==='qa')console.log(`${s.hiddenNodesRetained} hidden nodes retained separately; all ${s.sourcePropertyCount} source properties preserved; ${s.yamlBytes} YAML bytes. See coverage and diagnostics.`);
    else if(profile==='spacing')console.log(`${s.hiddenNodesExcluded} hidden source nodes excluded; ${s.yamlBytes} YAML bytes. Read diagnostics.json before comparing.`);
    else console.log('Read diagnostics.json and facts.json. Renderer compatibility and visual fidelity still need verification.');
    if(opts.strict && result.diagnostics.items.length)process.exitCode=2;
  } else console.log(`${candidates.entries.length} component identities found. Set target on reviewed entries and use this file with --mapping.`);
}
main().catch(e=>{console.error(`Error: ${e.message}`);process.exitCode=1;}).finally(()=>progress.close());
