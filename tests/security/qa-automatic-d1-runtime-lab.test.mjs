import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,SourceTextModule} from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {webcrypto} from 'node:crypto';
import {conversationPushIdentity as adminIdentity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
import {conversationPushIdentity as pureIdentity} from '../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
test('administrative identity reexports the exact frozen runtime object',()=>{
 assert.equal(adminIdentity,pureIdentity);
 assert.ok(Object.isFrozen(pureIdentity)&&Object.isFrozen(pureIdentity.accounts));
});
test('automatic HTTP module graph evaluates in a web API-only VM',async()=>{
 const repo=fileURLToPath(new URL('../../',import.meta.url));
 const root=resolve(repo,'cloudflare/push-worker/scripts/qa-automatic-d1-http-lab.mjs');
 const context=createContext({crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,
  AbortSignal,atob,btoa});
 const cache=new Map();
 async function load(path){
  const rel=relative(repo,path);
  assert.ok(!rel.startsWith('..')&&!isAbsolute(rel)&&path.endsWith('.mjs'));
  if(cache.has(path))return cache.get(path);
  const source=await readFile(path,'utf8');
  assert.doesNotMatch(source,/\b(?:process|Buffer|require|setInterval)\s*[.(]/);
  const mod=new SourceTextModule(source,{context,identifier:pathToFileURL(path).href,
   importModuleDynamically(){throw Error('dynamic_import_denied')}});
  cache.set(path,mod);
  return mod;
 }
 const entry=await load(root);
 await entry.link(async(spec,from)=>{
  assert.ok(spec.startsWith('./')||spec.startsWith('../'),'nonrelative import: '+spec);
  return load(resolve(dirname(fileURLToPath(from.identifier)),spec));
 });
 await entry.evaluate();
 assert.ok(cache.size>=10);
 assert.equal(typeof entry.namespace.createD1HttpCandidateLab,'function');
 let io=0;
 const candidate=entry.namespace.createD1HttpCandidateLab({db:{prepare(){io++;throw Error('unexpected')}},
  fetchImpl:async()=>{io++;throw Error('unexpected')},manualWorker:{fetch(){io++;throw Error('unexpected')}}});
 const result=await candidate.tick({});
 assert.equal(result.result.reason,'automation_disabled');
 assert.equal(result.httpUsage.actualExternalAttempts,0);
 assert.equal(io,0);
});
