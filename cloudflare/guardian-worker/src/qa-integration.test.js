import {test} from 'node:test';
import assert from 'node:assert/strict';
import entrypoint,{handleRequest,settingsOf} from './index.js';
import {Firestore,ROOT,str} from './firestore.js';

test('modo QA impede moderação mesmo que configurações sejam ativadas',()=>{
  const config={fields:{enabled:{booleanValue:true},allowHold:{booleanValue:true}}};
  const flags={GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'true',GUARDIAN_V2_HOLD_ENABLED:'true'};
  assert.deepEqual(settingsOf(config,flags),{enabled:false,allowHold:false});
});
test('endpoint QA rejeita configuração e revisão mesmo com token',async()=>{
  const e={GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'true'};
  for(const path of ['/admin/config','/admin/review']){
    const response=await handleRequest(new Request('https://qa.example'+path,{method:'POST',headers:{Authorization:'Bearer fake'},body:'{}'}),e);
    assert.equal(response.status,503);assert.equal((await response.json()).status,'qa_read_only');
  }
});
test('health do QA reporta ambiente separado',async()=>{
  const r=await handleRequest(new Request('https://qa.example/health'),{GUARDIAN_V2_TEST_MODE:'true'});
  assert.equal((await r.json()).status,'guardian_v2_qa_safe');
});
test('cron de QA não chama Firebase nem usa credenciais',async()=>{
  let pending=false;const original=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('Nunca chamar rede no QA');};
  const previous=console.log;console.log=()=>{};
  try{
    await entrypoint.scheduled({cron:'*/15 * * * *'},{GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'true'},{waitUntil(){pending=true;}});
    assert.equal(pending,false);
  }finally{globalThis.fetch=original;console.log=previous;}
});
test('cron desativado não chama rede nem agenda trabalho',async()=>{
  const original=globalThis.fetch;let pending=false;globalThis.fetch=()=>{throw Error('não deve chamar rede');};
  try{
    await entrypoint.scheduled({}, {GUARDIAN_V2_ENABLED:'false'}, {waitUntil(){pending=true;}});
    assert.equal(pending,false);
  }finally{globalThis.fetch=original;}
});
test('adaptador Firestore REST usa apenas janela limitada em coleção',async()=>{
  const original=globalThis.fetch;let query=null;
  globalThis.fetch=async(url,opts)=>{
    assert.equal(url,ROOT+':runQuery');assert.equal(opts.method,'POST');
    query=JSON.parse(opts.body);return new Response(JSON.stringify([{document:{name:ROOT+'/posts/qa1',fields:{uid:str('qa')},updateTime:'2026-10-29T20:00:00Z'}}]),{status:200});
  };
  try{
    const docs=await new Firestore('fake-token').scan('posts',20,30);
    assert.equal(docs.length,1);
    assert.equal(query.structuredQuery.limit,30);
    assert.equal(query.structuredQuery.where.fieldFilter.field.fieldPath,'createdAt');
    assert.equal(query.structuredQuery.from[0].allDescendants,false);
  }finally{globalThis.fetch=original;}
});
test('adaptador usa consulta collection-group para respostas',async()=>{
  const original=globalThis.fetch;let query;
  globalThis.fetch=async(url,opts)=>{query=JSON.parse(opts.body);return new Response('[]',{status:200});};
  try{await new Firestore('token-falso').scan('replies',20,30);assert.equal(query.structuredQuery.from[0].allDescendants,true);}
  finally{globalThis.fetch=original;}
});
test('precondição Firestore REST real vira conflito idempotente',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:400,status:'FAILED_PRECONDITION'}}),{status:400});
  try{await assert.rejects(new Firestore('falso').commit([]),e=>e.status===409);}
  finally{globalThis.fetch=original;}
});
test('erro Firestore não relacionado não é mascarado como duplicidade',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:400,status:'INVALID_ARGUMENT'}}),{status:400});
  try{await assert.rejects(new Firestore('falso').commit([]),e=>e.status===400);}
  finally{globalThis.fetch=original;}
});
test('conta de produção não se torna QA só por acesso ao health',async()=>{
  const r=await handleRequest(new Request('https://qa.example/health'),{});
  assert.equal((await r.json()).status,'guardian_v2_isolated');
});


test('adaptador QA usa raiz de projeto isolado sem tocar produção',async()=>{
  const root='http://127.0.0.1:8089/v1/projects/demo-atrio-v11/databases/(default)/documents';
  const store=new Firestore('emulator-token','demo-atrio-v11','http://127.0.0.1:8089/v1');
  assert.equal(store.root,root);
  const original=globalThis.fetch;let requested='';
  globalThis.fetch=async(url)=>{requested=url;return new Response(JSON.stringify({name:root+'/posts/qa'}),{status:200});};
  try{await store.get('posts/qa');assert.equal(requested,root+'/posts/qa');}
  finally{globalThis.fetch=original;}
});
test('rejeita URL arbitrária como backend de teste',()=>{
  assert.throws(()=>new Firestore('fake','demo-atrio-v11','https://untrusted.example/v1'),/invalid_backend/);
});
test('operações do QA nunca gravam no projeto de produção',async()=>{
  const root='http://127.0.0.1:8089/v1/projects/demo-atrio-v11/databases/(default)/documents';
  const store=new Firestore('fake','demo-atrio-v11','http://127.0.0.1:8089/v1');
  const original=globalThis.fetch;let payload;
  globalThis.fetch=async(url,opts)=>{payload=JSON.parse(opts.body);assert.equal(url,root+':commit');return new Response('{}',{status:200});};
  try{
    await store.create('guardian_runtime/qa-only',{active:{booleanValue:false}});
    assert.equal(payload.writes[0].update.name,root+'/guardian_runtime/qa-only');
    assert.ok(!payload.writes[0].update.name.includes('projects/atrio-catolico/'));
  }finally{globalThis.fetch=original;}
});


import {token} from './firestore.js';
test('sem autorização expressa credenciais não acessam a produção',async()=>{
  await assert.rejects(token({GUARDIAN_FIREBASE_PROJECT_ID:'atrio-catolico'}),/production_access_not_approved/);
});
test('QA recusa credencial pertencente a outro projeto Firebase',async()=>{
  await assert.rejects(token({GUARDIAN_FIREBASE_PROJECT_ID:'demo-atrio-v11',
    GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'atrio-catolico',client_email:'fake@example.invalid',private_key:'fake'})}),/service_not_configured/);
});
