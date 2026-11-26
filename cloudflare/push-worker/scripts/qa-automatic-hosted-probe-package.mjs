// Offline assembly only. Input is an operator-owned multipart Worker download.
// Never fetch, upload, import/evaluate the downloaded program or read secrets.
import {readFileSync,writeFileSync,mkdirSync,statSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SourceTextModule,createContext} from 'node:vm';
import {D1_PROBE_SCHEDULE_SCHEMA} from './qa-automatic-d1-probe-scheduled-lab.mjs';
export const BASELINE=Object.freeze({
 version:'6fcc1921-05da-4395-ae36-b8215eff8d1b',
 deployment:'af89cc1b-2ef9-443a-a38d-e60673b2ad17',
 compatibilityDate:'2026-10-26',
 modules:Object.freeze({
 'email-verification-policy.mjs':'64e2c4056bf3ce962782a4a88199e5455dea73fc1f6ad94f966aa859673c0bb0',
 'entry.mjs':'6725703d6ac84635b1f0a27f98330b2e8ed421ead7115fba03c1f58b41faab79',
 'index.js':'385677bd7bb92e487a7f3c03e0a60bfd72f1a6a315bdbe3f2ce1d64cba4fa8cc',
 'profile-interest-discussion.js':'77637257b6a1b0b45810c47eeda2328d39187a6fdec53cd41ccd35dbbaca63f5',
 'qa-geral.js':'4172ef814bcf55fb6d6db6060b04556f489a9311570049df854de01168a2325e',
 'qa-manual.js':'b7a759c4ffd417396dad8d12736ddb428f92536bd6802a0d198e5b7dbbe3b2c5',
 'qa-real-auth.js':'aacf64017a93995155db5893728270cc3d45fd06ca49b07b74f5436003c95361',
 'worker.mjs':'6fd0f5de4568ad9ebb57018c513fa57b78f573e60e9fb5dcd7f461ace565ccc7'
 })
});
const repo=realpathSync(fileURLToPath(new URL('../../../',import.meta.url)));
const probe='cloudflare/push-worker/scripts/qa-automatic-d1-probe-scheduled-lab.mjs';
const main='probe-entry.mjs';
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code)};
export function parsePinnedMultipart(raw,expected=BASELINE.modules){
 check(typeof raw==='string'&&Buffer.byteLength(raw)<=2*1024*1024,'snapshot_size');
 const boundary=raw.slice(0,raw.indexOf('\r\n'));
 check(/^--[A-Za-z0-9_-]{12,100}$/.test(boundary),'snapshot_boundary');
 const parts=raw.split(boundary);
 check(parts.shift()===''&&parts.pop()==='--\r\n','snapshot_framing');
 const modules=new Map();
 for(const part of parts){
  check(part.startsWith('\r\n')&&part.endsWith('\r\n'),'snapshot_part');
  const split=part.indexOf('\r\n\r\n');
  check(split>0,'snapshot_headers');
  const headers=part.slice(2,split).split('\r\n');
  const names=headers.map(h=>/^Content-Disposition: form-data; name="([A-Za-z0-9_.-]+)"$/i.exec(h)).filter(Boolean);
  check(names.length===1&&headers.every(h=>/^Content-Disposition: form-data; name="[A-Za-z0-9_.-]+"$/i.test(h)||/^Content-Type: (?:application|text)\/javascript(?:\+module)?$/i.test(h)),'snapshot_headers');
  const name=names[0][1],content=part.slice(split+4,-2);
  check(Object.hasOwn(expected,name)&&!modules.has(name)&&/^[A-Za-z0-9_-]+\.(?:mjs|js)$/.test(name),'snapshot_module');
  check(hash(content)===expected[name],'snapshot_hash_mismatch');
  modules.set(name,content);
 }
 check(modules.size===Object.keys(expected).length&&modules.has('entry.mjs'),'snapshot_incomplete');
 return modules;
}
const localName=(from,spec)=>{
 check(typeof spec==='string'&&(spec.startsWith('./')||spec.startsWith('../'))&&!spec.includes('\\'),'nonrelative_import');
 const dest=posix.normalize(posix.join(posix.dirname(from),spec));
 check(!dest.startsWith('../')&&!posix.isAbsolute(dest)&&/\.(?:mjs|js)$/.test(dest),'import_outside_package');
 return dest;
};
function assembleHostedModules(original,automatic=false){
 // Compile only, never link/evaluate downloaded code. Every static dependency
 // must resolve to the pinned baseline or the separately reviewed probe graph.
 check(typeof SourceTextModule==='function','requires_experimental_vm_modules');
 const context=createContext(Object.create(null)),modules=new Map(original),seen=new Set();
 const imports=(name,content)=>{
  check(!/\bimport\s*\(/.test(content),'dynamic_import_denied');
  const mod=new SourceTextModule(content,{context,identifier:name});
  return mod.dependencySpecifiers.map(spec=>localName(name,spec));
 };
 for(const [name,content] of original)
  for(const dependency of imports(name,content))check(original.has(dependency),'baseline_dependency_missing');
 function add(name){
  if(seen.has(name))return;
  seen.add(name);
  check(!original.has(name)&&/^(?:cloudflare\/push-worker\/scripts\/qa-automatic-[A-Za-z0-9-]+|firebase\/qa-geral-celular\/pilot\/conversation-push-[A-Za-z0-9-]+)\.mjs$/.test(name),'probe_import_outside_scope');
  const path=realpathSync(resolve(repo,name)),rel=relative(repo,path);
  check(!rel.startsWith('..')&&!isAbsolute(rel)&&rel.split('\\').join('/')===name,'probe_path_invalid');
  let content=readFileSync(path,'utf8');
  // Only the automatic relay's import is redirected to the byte-identical
  // hosted relay. Do not bring the newer Node-dependent QA API into this QA.
  if(automatic&&name==='cloudflare/push-worker/scripts/qa-automatic-d1-relay-candidate.mjs'){
   const anchor="import {createQaRelay} from '../src/qa-geral.js';";
   check(content.split(anchor).length===2&&original.has('qa-geral.js'),'hosted_relay_anchor');
   content=content.replace(anchor,"import {createQaRelay} from '../../../qa-geral.js';");
  }
  check(!/\b(?:process|Buffer|require|setInterval)\s*[.(]/.test(content),'non_web_runtime');
  modules.set(name,content);
  for(const dep of imports(name,content)){
   if(original.has(dep)){check(automatic&&name==='cloudflare/push-worker/scripts/qa-automatic-d1-relay-candidate.mjs'&&dep==='qa-geral.js','unexpected_baseline_dependency');continue}
   add(dep);
  }
 }
 const relay='cloudflare/push-worker/scripts/qa-automatic-d1-relay-candidate.mjs';
 const scheduler='cloudflare/push-worker/scripts/qa-automatic-d1-scheduled-candidate.mjs';
 if(automatic){add(relay);add(scheduler)}else add(probe);
 const entry=automatic?'automatic-entry.mjs':main;
 check(!modules.has(entry),'main_collision');
 const wrapper=(automatic?[
 "import manualWorker from './worker.mjs';",
 "import {createQaAutomaticCandidateRelay} from './"+relay+"';",
 "import {createQaScheduledCandidate} from './"+scheduler+"';",
 "const candidate=createQaAutomaticCandidateRelay({manualWorker,fetchImpl:(...args)=>fetch(...args)});",
 "const scheduled=createQaScheduledCandidate({candidate,report:r=>console.info({event:'qa_auto_schedule',...r})});",
 "export default {fetch:(request,env)=>candidate.fetch(request,env),scheduled:(controller,env)=>scheduled(controller,env)};",
 ""
 ]:[
 "import baseline from './entry.mjs';",
 "import {createQaProbeScheduledLab} from './"+probe+"';",
 "const scheduled=createQaProbeScheduledLab({fetchImpl:(...args)=>fetch(...args),report:r=>console.info({event:'qa_identity_probe',...r})});",
 "export default {fetch:(request,env,ctx)=>baseline.fetch(request,env,ctx),scheduled:(controller,env)=>scheduled(controller,env)};",
 ""
 ]).join('\n');
 for(const dep of imports(entry,wrapper))check(modules.has(dep),'wrapper_dependency_missing');
 modules.set(entry,wrapper);
 return modules;
}
export function assembleProbeModules(original){return assembleHostedModules(original)}
export function assembleHostedAutomaticModules(original){return assembleHostedModules(original,true)}
export function prepareHostedProbePackage(input,out){
 const file=resolve(input),dest=resolve(out);
 check(statSync(file).isFile()&&statSync(file).size<=2*1024*1024,'snapshot_size');
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(file));
 const original=parsePinnedMultipart(raw),modules=assembleProbeModules(original);
 // Refuse an existing directory. No deploy metadata, credentials or SQL
 // initialization is generated; only the diagnostic table definition.
 mkdirSync(dest,{mode:0o700});
 const save=(name,content)=>{
  const path=resolve(dest,name);
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  writeFileSync(path,content,{flag:'wx',mode:0o600});
 };
 for(const [name,content] of modules)save(name,content);
 save('schema-diagnostic.sql',D1_PROBE_SCHEDULE_SCHEMA+'\n');
 const manifest={kind:'qa-hosted-baseline-probe-review',deployable:false,activationAuthorized:false,
  baselineVersion:BASELINE.version,baselineDeployment:BASELINE.deployment,compatibilityDate:BASELINE.compatibilityDate,
  compatibilityFlags:[],mainModule:main,originalModules:{...BASELINE.modules},
  generatedModules:Object.fromEntries([...modules].filter(([n])=>!original.has(n)).map(([n,s])=>[n,hash(s)]))};
 save('manifest.json',JSON.stringify(manifest,null,2)+'\n');
 return {status:'prepared_for_review',originalModules:original.size,addedModules:modules.size-original.size,deployable:false,remoteWrites:false};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{check(process.argv.length===4,'usage_snapshot_and_new_directory');console.log(JSON.stringify(prepareHostedProbePackage(process.argv[2],process.argv[3]),null,2))}
 catch{console.error('Pacote bloqueado: snapshot, versão, dependências ou destino inválidos. Não publique.');process.exitCode=1}
}
