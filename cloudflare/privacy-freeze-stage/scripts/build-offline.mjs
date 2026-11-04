/**
 * Staging Worker source-module ARTIFACT, not a deploy/compile-to-executable
 * command. A deterministic, reviewed *source* graph plus SHA-256 manifest.
 * This NEVER embeds bindings, D1 IDs, account IDs, secrets or Wrangler config.
 * Calling this tool cannot upload, deploy, publish, or modify Cloudflare.
 *
 * IMPORTANT: sourceCommit is an assertion checked by CI against HEAD; its
 * presence alone is NOT a signature or independent proof of provenance.
 */
import {SourceTextModule} from 'node:vm';
import {createHash} from 'node:crypto';
import {
  readFileSync,writeFileSync,mkdirSync,realpathSync,lstatSync,readdirSync,
  existsSync
} from 'node:fs';
import {resolve,relative,dirname,join,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT_ENTRY='privacy-freeze-stage/src/index.js';
const ALLOWED=['privacy-freeze-stage/src/','account-deletion-audit/src/'];
const COMMIT=/^[a-f0-9]{40}$/;
const MAX_MODULES=96,MAX_BYTES=2_000_000,MAX_FILE_BYTES=250_000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=why=>{throw Error('qa_worker_source_artifact_denied:'+why);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const slash=x=>x.split(sep).join('/');
const digestRows=rows=>sha(rows.map(x=>
  x.path+'\0'+x.bytes+'\0'+x.sha256+'\n').join(''));

function absoluteSource(root,path){
  const raw=resolve(root,path);
  if(!raw.startsWith(root+sep))fail('path_outside_stage_tree');
  if(!existsSync(raw)||!lstatSync(raw).isFile()||
     lstatSync(raw).isSymbolicLink())fail('missing_or_linked_module');
  const canonical=realpathSync(raw);
  if(canonical!==raw)fail('linked_module');
  return raw;
}
export function inspectQaWorkerSourceGraph({repoRoot,sourceCommit}={}){
  if(typeof repoRoot!=='string'||!COMMIT.test(sourceCommit||''))
    fail('invalid_input');
  const root=realpathSync(resolve(repoRoot,'cloudflare'));
  const seen=new Map(),queue=[ROOT_ENTRY];
  let total=0;
  while(queue.length){
    const path=queue.shift();
    if(seen.has(path))continue;
    if(!ALLOWED.some(prefix=>path.startsWith(prefix))||
       !path.endsWith('.js'))fail('unreviewed_module');
    const filename=absoluteSource(root,path);
    const bytes=readFileSync(filename);
    if(bytes.length<1||bytes.length>MAX_FILE_BYTES)fail('invalid_module_size');
    total+=bytes.length;
    if(total>MAX_BYTES||seen.size>=MAX_MODULES)fail('source_graph_too_large');
    const source=bytes.toString('utf8');
    if(source.includes('\ufffd')||/\bimport\s*\(/.test(source)||
       /\brequire\s*\(/.test(source))fail('dynamic_or_opaque_import');
    let module;
    try{module=new SourceTextModule(source,{identifier:path});}
    catch{fail('module_syntax_invalid');}
    for(const specifier of module.dependencySpecifiers){
      if(typeof specifier!=='string'||!/^\.\.?\//.test(specifier)||
         extname(specifier)!=='.js'||specifier.includes('?')||
         specifier.includes('#'))fail('external_import_denied');
      const dependency=resolve(dirname(filename),specifier);
      if(!dependency.startsWith(root+sep))fail('dependency_outside_root');
      const next=slash(relative(root,dependency));
      if(!ALLOWED.some(prefix=>next.startsWith(prefix)))
        fail('dependency_not_on_allowlist');
      queue.push(next);
    }
    seen.set(path,{path,bytes:bytes.length,sha256:sha(bytes),source:bytes});
  }
  const records=[...seen.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const rows=records.map(({path,bytes,sha256})=>({path,bytes,sha256}));
  return Object.freeze({
    sourceCommit,entry:ROOT_ENTRY,moduleCount:rows.length,
    totalBytes:total,graphSha256:digestRows(rows),
    modules:Object.freeze(rows.map(x=>Object.freeze(x))),
    // Source integrity, not production readiness or security certification.
    sourceOnly:true,productionAuthorized:false,deployAuthorized:false
  });
}
export function verifyQaWorkerSourceArtifact({outDir}={}){
  if(typeof outDir!=='string')fail('invalid_output');
  const base=realpathSync(outDir);
  const manifest=JSON.parse(readFileSync(join(base,'manifest.json'),'utf8'));
  if(!plain(manifest)||manifest.sourceOnly!==true||
     manifest.productionAuthorized!==false||
     manifest.deployAuthorized!==false||
     !COMMIT.test(manifest.sourceCommit||'')||
     manifest.entry!==ROOT_ENTRY||
     !Array.isArray(manifest.modules)||
     manifest.modules.length<1||manifest.modules.length>MAX_MODULES)
    fail('invalid_manifest');
  const entries=new Set(),actual=[];
  for(const meta of manifest.modules){
    if(!plain(meta)||typeof meta.path!=='string'||
       !ALLOWED.some(prefix=>meta.path.startsWith(prefix))||
       !/^[a-f0-9]{64}$/.test(meta.sha256||'')||
       !Number.isSafeInteger(meta.bytes)||meta.bytes<1||
       meta.bytes>MAX_FILE_BYTES||entries.has(meta.path))
      fail('invalid_manifest_entry');
    entries.add(meta.path);
    const content=readFileSync(absoluteSource(join(base,'modules'),meta.path));
    if(content.length!==meta.bytes||sha(content)!==meta.sha256)
      fail('artifact_integrity_mismatch');
    actual.push(meta);
  }
  const walk=(root,rel='')=>{
    for(const d of readdirSync(join(root,rel),{withFileTypes:true})){
      if(d.isSymbolicLink())fail('artifact_symlink');
      const name=slash(join(rel,d.name));
      if(d.isDirectory())walk(root,name);
      else if(d.isFile()){
        if(!entries.has(name))fail('unexpected_module_file');
      }else fail('unexpected_artifact_entry');
    }
  };
  walk(join(base,'modules'));
  actual.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  if(manifest.moduleCount!==actual.length||
     manifest.totalBytes!==actual.reduce((n,x)=>n+x.bytes,0)||
     manifest.graphSha256!==digestRows(actual))
    fail('manifest_graph_digest_mismatch');
  return Object.freeze({
    valid:true,sourceCommit:manifest.sourceCommit,
    graphSha256:manifest.graphSha256,moduleCount:actual.length,
    deployAuthorized:false,productionAuthorized:false
  });
}
export function createQaWorkerSourceArtifact({repoRoot,sourceCommit,outDir}={}){
  if(typeof outDir!=='string'||existsSync(outDir))
    fail('output_directory_must_not_exist');
  const manifest=inspectQaWorkerSourceGraph({repoRoot,sourceCommit});
  // Repository-scoped, audited source paths only. Never copy configs/secrets.
  const cloudflare=realpathSync(resolve(repoRoot,'cloudflare'));
  mkdirSync(join(outDir,'modules'),{recursive:true});
  for(const item of manifest.modules){
    const bytes=readFileSync(absoluteSource(cloudflare,item.path));
    if(sha(bytes)!==item.sha256)fail('source_changed_during_packaging');
    const target=join(outDir,'modules',item.path);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,bytes,{flag:'wx',mode:0o600});
  }
  writeFileSync(join(outDir,'manifest.json'),
    JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  verifyQaWorkerSourceArtifact({outDir});
  return manifest;
}
const direct=process.argv[1]&&
  resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct){
  if(process.argv.length!==6||process.argv[2]!=='--build')
    fail('usage_build_repo_out_commit');
  const [, , ,repoRoot,outDir,sourceCommit]=process.argv;
  if(realpathSync(repoRoot)!==realpathSync(process.cwd()))fail('not_repository_root');
  const manifest=createQaWorkerSourceArtifact({repoRoot,sourceCommit,outDir});
  process.stdout.write('QA module source graph verified: '+
    manifest.moduleCount+' modules, digest '+manifest.graphSha256+
    '. Source ONLY; NO deployment, NOT production-ready.\n');
}
