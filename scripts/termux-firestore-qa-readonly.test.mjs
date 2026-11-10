import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectQaRules} from './termux-firestore-qa-readonly.mjs';
const project='atrio-catolico-qa-geral';
const token='qa-mock-token-never-a-real-secret-1234567890';
const release='projects/'+project+'/releases/cloud.firestore';
const ruleset='projects/'+project+'/rulesets/fixture123';
const deny=[
 "rules_version = '2';",
 'service cloud.firestore {',
 'match /databases/{database}/documents {',
 'match /{document=**} {',
 'allow read, write: if false;',
 '}', '}', '}'
].join('\n');
function fake({source=deny,rel=release,set=ruleset,status=200,files=true}={}){
 const calls=[];
 const fetcher=async(url,o)=>{
   calls.push(url);
   assert.equal(o.method,'GET');
   assert.equal(o.redirect,'error');
   assert.equal(o.headers.Authorization,'Bearer '+token);
   assert.ok(url.startsWith('https://firebaserules.googleapis.com/v1/projects/'+project+'/'));
   if(status!==200)return new Response('',{status});
   if(url.endsWith('/releases/cloud.firestore'))
     return Response.json({name:rel,rulesetName:set});
   return Response.json({name:ruleset,source:{files:files?[{content:source}]:[]}});
 };
 return {calls,fetcher};
}
test('QA somente 2 GET, deny-all, sem ativacao e sem token no relatorio',async()=>{
 const f=fake();
 const r=await inspectQaRules({tokenProvider:async()=>token,fetcher:f.fetcher});
 assert.equal(f.calls.length,2);
 assert.equal(r.firestoreRulesCurrentlyDenyAll,true);
 assert.equal(r.safeToEnableChat,false);
 assert.equal(r.deployPerformed,false);
 assert.equal(r.productionContacted,false);
 assert.equal(JSON.stringify(r).includes(token),false);
 assert.match(r.sha256,/^[0-9a-f]{64}$/);
});
test('qualquer permissão adicional impede aprovacao do estado fechado',async()=>{
 for(const source of [
   deny.replace('if false;','if true;'),
   deny.replace('if false;','if request.auth != null;'),
   deny.replace('allow read, write: if false;','allow get: if false;')
 ]){
   const f=fake({source});
   const r=await inspectQaRules({tokenProvider:async()=>token,fetcher:f.fetcher});
   assert.equal(r.firestoreRulesCurrentlyDenyAll,false);
   assert.equal(r.safeToEnableChat,false);
 }
});
test('identidade errada bloqueada antes de qualquer GET fora do projeto QA',async()=>{
 for(const opts of [
   {rel:'projects/atrio-catolico/releases/cloud.firestore'},
   {set:'projects/atrio-catolico/rulesets/fixture123'}
 ]){
   const f=fake(opts);
   await assert.rejects(inspectQaRules({tokenProvider:async()=>token,fetcher:f.fetcher}),
     /qa_rules_readonly_release_identity_mismatch/);
   assert.equal(f.calls.length,1);
 }
});
test('erro de rede, API negada e ruleset incompleto falham fechados',async()=>{
 for(const opts of [{status:403},{files:false}]){
   const f=fake(opts);
   await assert.rejects(inspectQaRules({tokenProvider:async()=>token,fetcher:f.fetcher}),
     /qa_rules_readonly_(read_denied|ruleset_incomplete)/);
 }
 const f=fake();
 await assert.rejects(inspectQaRules({tokenProvider:async()=>'bad',fetcher:f.fetcher}),
   /qa_rules_readonly_missing_login/);
 assert.equal(f.calls.length,0);
});
