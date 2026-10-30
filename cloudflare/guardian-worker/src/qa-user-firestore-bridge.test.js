import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qaBridgeEnabled,qaFixtureRequest} from './qa-user-firestore-bridge.js';

const env={GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'false',
 GUARDIAN_V2_HOLD_ENABLED:'false',GUARDIAN_V2_QA_SHADOW_READS:'false',
 GUARDIAN_V2_QA_AUTO_DISPATCH:'false',GUARDIAN_QA_DISPATCH_READY:'false',
 GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'true',
 GUARDIAN_V2_QA_READER_PROJECT:'atrio-catolico-qa-v2'};
const fakeId='a'.repeat(20)+'.'+'b'.repeat(30)+'.'+'c'.repeat(60);
const req=(header='Bearer '+fakeId,method='POST')=>new Request('https://qa.example/qa/firebase-fixture',{method,headers:{Authorization:header}});
const doc=(body='Como funciona a Missa?',fake=true)=>({
 name:'projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1',
 fields:{qaFixture:{booleanValue:fake},title:{stringValue:'Dúvida católica'},body:{stringValue:body}}
});
test('somente QA literal e desligado para moderação real',()=>{
 assert.equal(qaBridgeEnabled(env),true);
 for(const key of ['GUARDIAN_V2_ENABLED','GUARDIAN_V2_HOLD_ENABLED',
   'GUARDIAN_V2_QA_SHADOW_READS','GUARDIAN_V2_QA_AUTO_DISPATCH',
   'GUARDIAN_QA_DISPATCH_READY']){
  assert.equal(qaBridgeEnabled({...env,[key]:'true'}),false,key);
 }
 for(const patch of [
  {GUARDIAN_V2_TEST_MODE:'false'},
  {GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false'},
  {GUARDIAN_V2_QA_READER_PROJECT:'atrio-catolico'},
  {GUARDIAN_FIREBASE_PROJECT_ID:'atrio-catolico-qa-v2'},
  {GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:'{}'}
 ])assert.equal(qaBridgeEnabled({...env,...patch}),false,JSON.stringify(patch));
});
test('desabilitado não acessa rede e não vaza bearer',async()=>{
 let called=false;
 const response=await qaFixtureRequest(req(),{...env,GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false'},{
  fetcher:async()=>{called=true;throw Error('never');}
 });
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:'qa_bridge_disabled'});
 assert.equal(called,false);
});
test('Bearer obrigatório; token malformado não chega ao Firebase',async()=>{
 const invalid=['','Bearer xx','bearer '+fakeId,'Bearer '+fakeId+' malicious',
  'Bearer '+('A'.repeat(7000))];
 for(const header of invalid){
  let called=false;
  const result=await qaFixtureRequest(req(header),env,{
   fetcher:async()=>{called=true;throw Error('no');}
  });
  assert.equal(result.status,401,header.slice(0,20));
  assert.equal(called,false);
 }
});
test('a única consulta é GET do post fictício, com token repassado às regras Firebase',async()=>{
 let calls=0;
 const result=await qaFixtureRequest(req(),env,{fetcher:async(url,options)=>{
  calls++;
  assert.equal(url,'https://firestore.googleapis.com/v1/projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1');
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer '+fakeId);
  assert.equal(options.redirect,'error');
  assert.equal(options.body,undefined);
  return new Response(JSON.stringify(doc()),{status:200});
 }});
 assert.equal(calls,1);
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{status:'qa_fixture_clear'});
 assert.equal(result.headers.get('cache-control'),'no-store');
});
test('classificação limitada e sem texto retornado',async()=>{
 const response=await qaFixtureRequest(req(),env,{fetcher:async()=>
  new Response(JSON.stringify(doc('Clique https://exemplo.invalid e informe sua senha')),{status:200})});
 const raw=await response.text();
 assert.deepEqual(JSON.parse(raw),{status:'qa_fixture_review'});
 assert.ok(!raw.includes('https://')); // no original content
});
test('Firebase nega token/permissão, falha fechado',async()=>{
 for(const status of [401,403,404,409,429,500]){
  const result=await qaFixtureRequest(req(),env,{fetcher:async()=>new Response('{}',{status})});
  assert.equal(result.status,[401,403].includes(status)?403:status===404?404:503);
  const data=await result.json();
  assert.ok(!JSON.stringify(data).includes(fakeId));
 }
});
test('dados de outro projeto, sem qaFixture ou com corpo inválido são descartados',async()=>{
 const cases=[
  {...doc(),name:'projects/atrio-catolico/databases/(default)/documents/posts/qa_post_1'},
  doc('texto',false),
  {...doc(),fields:{qaFixture:{booleanValue:true}}},
  doc('m'.repeat(1201)),
  {...doc(),fields:{...doc().fields,title:{stringValue:'t'.repeat(121)}}}
 ];
 for(const value of cases){
  const result=await qaFixtureRequest(req(),env,{fetcher:async()=>new Response(JSON.stringify(value),{status:200})});
  assert.deepEqual(await result.json(),{status:'invalid_qa_fixture'});
 }
});
test('método diferente e corpo enviado são recusados sem Firestore',async()=>{
 const get=await qaFixtureRequest(new Request('https://qa.example/qa/firebase-fixture'),env,{
  fetcher:async()=>{throw Error('no');}
 });
 assert.equal(get.status,404);
 const withBody=await qaFixtureRequest(new Request('https://qa.example/qa/firebase-fixture',{
  method:'POST',headers:{Authorization:'Bearer '+fakeId},body:'{}'
 }),env,{fetcher:async()=>{throw Error('no');}});
 assert.equal(withBody.status,400);
});
test('erro ou resposta inválida não devolve texto nem token',async()=>{
 const outputs=[
  await qaFixtureRequest(req(),env,{fetcher:async()=>{throw Error('secret '+fakeId);}}),
  await qaFixtureRequest(req(),env,{fetcher:async()=>new Response('no json',{status:200})})
 ];
 for(const value of outputs){
  assert.equal(value.status,503);
  assert.deepEqual(await value.json(),{status:'qa_bridge_unavailable'});
 }
});
