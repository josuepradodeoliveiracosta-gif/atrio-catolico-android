import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {SourceTextModule,createContext} from 'node:vm';
import {posix} from 'node:path';
import {parsePinnedMultipart,assembleProbeModules,BASELINE} from '../../cloudflare/push-worker/scripts/qa-automatic-hosted-probe-package.mjs';
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
