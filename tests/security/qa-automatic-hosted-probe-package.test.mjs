import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {SourceTextModule,createContext} from 'node:vm';
import {posix} from 'node:path';
import {parsePinnedMultipart,assembleProbeModules,assembleHostedAutomaticModules,BASELINE} from '../../cloudflare/push-worker/scripts/qa-automatic-hosted-probe-package.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const original=new Map(Object.keys(BASELINE.modules).map(name=>[name,'export const fixture=true;\n']));
original.set('entry.mjs',"import './worker.mjs';\nexport default {fetch:()=>new Response('existing relay',{status:202})};\n");
const expected=Object.fromEntries([...original].map(([n,s])=>[n,hash(s)]));
const boundary='--fixture-boundary-0123456789';
const pack=entries=>entries.map(([n,s])=>boundary+'\r\nContent-Disposition: form-data; name="'+n+'"\r\n\r\n'+s+'\r\n').join('')+boundary+'--\r\n';
test('multipart preserves exact original bytes, rejects drift, duplicates and unexpected parts',()=>{
 const raw=pack([...original]);
 assert.deepEqual(parsePinnedMultipart(raw,expected),original);
 assert.throws(()=>parsePinnedMultipart(raw),/snapshot_hash_mismatch/);
 assert.throws(()=>parsePinnedMultipart(pack([...original,['entry.mjs',original.get('entry.mjs')]]),expected),/snapshot_module/);
 assert.throws(()=>parsePinnedMultipart(pack([...original].slice(1)),expected),/snapshot_incomplete/);
 assert.throws(()=>parsePinnedMultipart(pack([...original,['../bad.js','x']]),expected),/snapshot_headers|snapshot_module/);
 assert.throws(()=>parsePinnedMultipart(raw.replace('existing relay','changed'),expected),/snapshot_hash_mismatch/);
});
test('wrapper retains every baseline module, links in Web-only VM and delegates HTTP unchanged',async()=>{
 const modules=assembleProbeModules(original);
 for(const [n,s] of original)assert.equal(modules.get(n),s);
 assert.ok(modules.size>original.size+10);
 let outbound=0;
 const context=createContext({crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortSignal,atob,btoa,
  fetch:()=>{outbound++;throw Error('unexpected network')},console:{info(){}}});
 const cache=new Map();
 function load(n){
  if(cache.has(n))return cache.get(n);
  assert.ok(modules.has(n),n);
  const m=new SourceTextModule(modules.get(n),{context,identifier:n,importModuleDynamically(){throw Error('dynamic import')}});
  cache.set(n,m);return m;
 }
 const entry=load('probe-entry.mjs');
 await entry.link((spec,from)=>load(posix.normalize(posix.join(posix.dirname(from.identifier),spec))));
 await entry.evaluate();
 const w=entry.namespace.default;
 const r=await w.fetch(new Request('https://qa.invalid/notice'),{});
 assert.equal(r.status,202);assert.equal(await r.text(),'existing relay');
 assert.equal((await w.scheduled({cron:'* * * * *',scheduledTime:Date.now()},{})).reason,'probe_disabled');
 assert.equal(outbound,0);
});
test('baseline graph refuses missing and nonrelative dependencies without executing snapshot',()=>{
 for(const s of ["import './missing.mjs';", "import 'node:fs';", "import('./worker.mjs');"]){
  const m=new Map(original);m.set('entry.mjs',s);
  assert.throws(()=>assembleProbeModules(m));
 }
});

test('automatic hosted package preserves baseline modules and maps only conversation routes',async()=>{
 const baseline=new Map(original);
 baseline.set('worker.mjs',"export default {fetch:()=>Response.json({status:'old_manual'})};");
 baseline.set('qa-geral.js',[
  "export function createQaRelay(worker){return {fetch(req,env){",
  "const p=new URL(req.url).pathname;",
  "if(p==='/notice')return worker.fetch(req,{PUSH_DB:env.QA_PUSH_DB});",
  "if(p==='/event')return req.json().then(e=>e.type==='chat_message'?worker.fetch(req,{}):Response.json({status:'old_other_event'}));",
  "return Response.json({status:'old_other_route'});}}}",
  ""
 ].join('\n'));
 const modules=assembleHostedAutomaticModules(baseline);
 for(const [name,content] of baseline)assert.equal(modules.get(name),content);
 assert.ok(!modules.has('probe-entry.mjs'));
 assert.ok(!modules.has('cloudflare/push-worker/src/qa-geral.js'));
 assert.match(modules.get('cloudflare/push-worker/scripts/qa-automatic-d1-relay-candidate.mjs'),/from '\.\.\/\.\.\/\.\.\/qa-geral\.js'/);
 let network=0;const context=createContext({crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortSignal,atob,btoa,
  fetch:()=>{network++;throw Error('unexpected network')},console:{info(){}}});
 const cache=new Map();
 function load(n){if(cache.has(n))return cache.get(n);assert.ok(modules.has(n),n);const m=new SourceTextModule(modules.get(n),{context,identifier:n});cache.set(n,m);return m}
 const entry=load('automatic-entry.mjs');
 await entry.link((spec,from)=>load(posix.normalize(posix.join(posix.dirname(from.identifier),spec))));
 await entry.evaluate();
 const worker=entry.namespace.default;
 assert.equal((await worker.fetch(new Request('https://qa.invalid/notice'),{})).status,503);
 assert.equal((await worker.fetch(new Request('https://qa.invalid/event',{method:'POST',body:JSON.stringify({type:'chat_message'})}),{})).status,503);
 assert.equal((await (await worker.fetch(new Request('https://qa.invalid/event',{method:'POST',body:JSON.stringify({type:'other'})}),{})).json()).status,'old_other_event');
 assert.equal((await (await worker.fetch(new Request('https://qa.invalid/other'),{})).json()).status,'old_other_route');
 assert.equal((await worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()},{})).reason,'schedule_disabled');
 assert.equal(network,0);
});
