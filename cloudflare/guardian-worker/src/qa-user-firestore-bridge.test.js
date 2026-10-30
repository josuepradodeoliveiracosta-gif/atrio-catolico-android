import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qaBridgeEnabled,qaFixtureRequest} from './qa-user-firestore-bridge.js';
import {QA_DAILY_READ_LIMIT,QA_D1_RESERVE_SQL,reserveQaDailyRead} from './qa-d1-budget.js';

const allowLimiter={limit:async()=>({success:true})};
const allowD1={prepare:sql=>{
 assert.equal(sql,QA_D1_RESERVE_SQL);
 return {bind:(day,limit)=>{
  assert.match(day,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(limit,12);
  return {first:async()=>({used:1})};
 }};
}};
const env={GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'false',
 GUARDIAN_V2_HOLD_ENABLED:'false',GUARDIAN_V2_QA_SHADOW_READS:'false',
 GUARDIAN_V2_QA_AUTO_DISPATCH:'false',GUARDIAN_QA_DISPATCH_READY:'false',
 GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'true',
 GUARDIAN_V2_QA_READER_PROJECT:'atrio-catolico-qa-v2',
 GUARDIAN_QA_GLOBAL_LIMITER:allowLimiter,
 GUARDIAN_QA_TOKEN_LIMITER:allowLimiter,
 GUARDIAN_QA_BUDGET_DB:allowD1};
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
  assert.equal(options.redirect,'manual');
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
test('respostas HTTP da API QA são categorizadas sem revelar dados',async()=>{
 const codes={400:[403,'forbidden'],401:[403,'forbidden'],403:[403,'forbidden'],
  404:[404,'fixture_missing'],409:[503,'qa_upstream_http_unavailable'],
  429:[503,'qa_upstream_throttled'],500:[503,'qa_upstream_http_unavailable']};
 for(const [status,[expected,code]] of Object.entries(codes)){
  const res=await qaFixtureRequest(req(),env,{fetcher:async()=>new Response('secret '+fakeId,{status:Number(status)})});
  assert.equal(res.status,expected);
  assert.equal(await res.text(),JSON.stringify({status:code}));
 }
});
test('redirecionamento do Firebase não encaminha bearer nem faz segundo GET',async()=>{
 let network=0;
 const redirectResponse=await qaFixtureRequest(req(),env,{fetcher:async(url,options)=>{
  network++;
  assert.equal(options.redirect,'manual');
  assert.ok(url.startsWith('https://firestore.googleapis.com/'));
  return new Response(null,{status:302,headers:{
   Location:'https://untrusted.invalid/?token='+fakeId
  }});
 }});
 assert.equal(network,1);
 assert.equal(redirectResponse.status,503);
 assert.deepEqual(await redirectResponse.json(),{status:'qa_upstream_redirect_blocked'});
 assert.ok(!JSON.stringify(await redirectResponse.headers.entries()).includes(fakeId));
});
test('falha de fetch diferencia rede de HTTP, sem retornar o token',async()=>{
 const res=await qaFixtureRequest(req(),env,{fetcher:async()=>{throw Error('secret '+fakeId);}});
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{status:'qa_upstream_network_unavailable'});
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
test('POST real com stream vazio nao e confundido com payload',async()=>{
 let calls=0;
 const empty=new Request('https://qa.example/qa/firebase-fixture',{
  method:'POST',headers:{Authorization:'Bearer '+fakeId},body:''
 });
 assert.notEqual(empty.body,null); // Emulates Cloudflare's streamed empty POST.
 const result=await qaFixtureRequest(empty,env,{fetcher:async(url,opts)=>{
  calls++;
  assert.equal(opts.method,'GET');
  return new Response(JSON.stringify(doc()),{status:200});
 }});
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{status:'qa_fixture_clear'});
 assert.equal(calls,1);
});
test('POST com stream vazio sem Bearer retorna 401 e nao consome quota',async()=>{
 let limiter=0,db=0;
 const response=await qaFixtureRequest(new Request('https://qa.example/qa/firebase-fixture',{
  method:'POST',body:''
 }),{...env,GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>{limiter++;throw Error('not expected');}},
   GUARDIAN_QA_BUDGET_DB:{prepare:()=>{db++;throw Error('not expected');}}});
 assert.equal(response.status,401);
 assert.deepEqual(await response.json(),{status:'unauthorized'});
 assert.equal(limiter,0);
 assert.equal(db,0);
});
test('payload nao vazio ainda e negado antes de limitar ou consultar Firebase',async()=>{
 let calls=0;
 for(const data of ['{}',' ','00']){
  const response=await qaFixtureRequest(new Request('https://qa.example/qa/firebase-fixture',{
    method:'POST',headers:{Authorization:'Bearer '+fakeId},body:data
   }),{...env,GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>{calls++;throw Error('no');}}});
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{status:'invalid_request'});
 }
 assert.equal(calls,0);
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
test('falha de rede e resposta inválida não revelam token',async()=>{
 const outputs=[
  [await qaFixtureRequest(req(),env,{fetcher:async()=>{throw Error('secret '+fakeId);}}),'qa_upstream_network_unavailable'],
  [await qaFixtureRequest(req(),env,{fetcher:async()=>new Response('no json',{status:200})}),'qa_upstream_response_invalid']
 ];
 for(const [r,code] of outputs){
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{status:code});
 }
});

test('rota HTTP do Worker QA não pode ser ativada por configuração normal',async()=>{
 const {handleRequest}=await import('./index.js');
 const response=await handleRequest(req(),{
  ...env,GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false'
 });
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:'qa_bridge_disabled'});
});
test('todas as rotas de administração continuam fechadas no Worker QA',async()=>{
 const {handleRequest}=await import('./index.js');
 const call=new Request('https://qa.example/admin/config',{method:'POST',
  headers:{'content-type':'application/json'},body:'{"enabled":true,"allowHold":true,"emergencyStop":false}'});
 const result=await handleRequest(call,env);
 assert.equal(result.status,503);
 assert.deepEqual(await result.json(),{status:'qa_read_only'});
});

test('rejeita Content-Length excessivo sem carregar payload remoto',async()=>{
 let calls=0;
 const response=await qaFixtureRequest(req(),env,{fetcher:async()=>{
  calls++;
  return new Response(JSON.stringify(doc()),{status:200,
   headers:{'content-length':'9000'}});
 }});
 assert.equal(calls,1);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:'qa_upstream_response_invalid'});
});
test('rejeita resposta grande mesmo sem Content-Length e não devolve dados',async()=>{
 const payload={...doc(),extra:'SEGREDO_NAO_DEVOLVE_'+'x'.repeat(9000)};
 const response=await qaFixtureRequest(req(),env,{fetcher:async()=>new Response(
  JSON.stringify(payload),{status:200})});
 assert.equal(response.status,503);
 const raw=await response.text();
 assert.equal(raw,'{"status":"qa_upstream_response_invalid"}');
 assert.ok(!raw.includes('SEGREDO_NAO_DEVOLVE_'));
});
test('rejeita UTF-8 inválido na resposta remota sem exceção pública',async()=>{
 const response=await qaFixtureRequest(req(),env,{fetcher:async()=>
  new Response(Uint8Array.of(0xff,0xfe),{status:200})});
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:'qa_upstream_response_invalid'});
});

test('limites obrigatórios: ausência de binding falha sem consulta Firebase',async()=>{
 let calls=0;
 for(const patch of [
  {GUARDIAN_QA_GLOBAL_LIMITER:undefined},
  {GUARDIAN_QA_TOKEN_LIMITER:undefined},
  {GUARDIAN_QA_GLOBAL_LIMITER:{limit:null}},
  {GUARDIAN_QA_TOKEN_LIMITER:{limit:null}}
 ]){
  const res=await qaFixtureRequest(req(),{...env,...patch},{
   fetcher:async()=>{calls++;throw Error('não deveria consultar');}
  });
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{status:'qa_rate_limit_unavailable'});
 }
 assert.equal(calls,0);
});
test('limite global 429 impede chamada e dispensa limite individual',async()=>{
 let perToken=0,network=0;
 const res=await qaFixtureRequest(req(),{
  ...env,
  GUARDIAN_QA_GLOBAL_LIMITER:{limit:async({key})=>{
   assert.equal(key,'qa-firebase-fixture');return {success:false};}},
  GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>{perToken++;return {success:true};}}
 },{fetcher:async()=>{network++;throw Error('no');}});
 assert.equal(res.status,429);
 assert.deepEqual(await res.json(),{status:'qa_rate_limited'});
 assert.equal(perToken,0);
 assert.equal(network,0);
});
test('limite por token 429 impede chamada Firestore',async()=>{
 let network=0;
 const res=await qaFixtureRequest(req(),{
  ...env,GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>({success:false})}
 },{fetcher:async()=>{network++;throw Error('no');}});
 assert.equal(res.status,429);
 assert.equal(network,0);
 assert.deepEqual(await res.json(),{status:'qa_rate_limited'});
});
test('limites que falham ou retornam resposta inesperada negam por padrão',async()=>{
 let network=0;
 for(const patch of [
  {GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>{throw Error(fakeId);}}},
  {GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>({})}},
  {GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>{throw Error(fakeId);}}},
  {GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>({success:'true'})}}
 ]){
  const res=await qaFixtureRequest(req(),{...env,...patch},{
   fetcher:async()=>{network++;throw Error('no');}
  });
  assert.equal(res.status,503);
  const raw=await res.text();
  assert.equal(raw,'{"status":"qa_rate_limit_unavailable"}');
  assert.ok(!raw.includes(fakeId));
 }
 assert.equal(network,0);
});
test('tokens viram chaves SHA-256 estáveis sem enviar o JWT bruto ao limitador',async()=>{
 const keys=[];
 const second='z'.repeat(20)+'.'+'y'.repeat(30)+'.'+'x'.repeat(60);
 const localEnv={...env,
  GUARDIAN_QA_GLOBAL_LIMITER:{limit:async({key})=>{
   assert.equal(key,'qa-firebase-fixture');return {success:true};}},
  GUARDIAN_QA_TOKEN_LIMITER:{limit:async({key})=>{
   keys.push(key);return {success:true};}}
 };
 const fetcher=async()=>new Response(JSON.stringify(doc()),{status:200});
 for(const header of ['Bearer '+fakeId,'Bearer '+fakeId,'Bearer '+second]){
  const res=await qaFixtureRequest(req(header),localEnv,{fetcher});
  assert.equal(res.status,200);
 }
 assert.equal(keys.length,3);
 assert.match(keys[0],/^qa-fixture:[0-9a-f]{64}$/);
 assert.equal(keys[0],keys[1]);
 assert.notEqual(keys[0],keys[2]);
 assert.ok(keys.every(k=>!k.includes(fakeId)&&!k.includes(second)));
});
test('caminho desligado e bearer inválido não consultam quota nem Firestore',async()=>{
 let checks=0,requests=0;
 const blocked={...env,GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false',
  GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>{checks++;throw Error('no');}},
  GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>{checks++;throw Error('no');}}};
 const fetcher=async()=>{requests++;throw Error('no');};
 assert.equal((await qaFixtureRequest(req(),blocked,{fetcher})).status,503);
 assert.equal((await qaFixtureRequest(req('Bearer malformed'),env,{fetcher})).status,401);
 assert.equal(checks,0);
 assert.equal(requests,0);
});

test('D1 obrigatório: ausência ou quebra recusa GET sem tocar Firebase',async()=>{
 let calls=0;
 const replacements=[
  {GUARDIAN_QA_BUDGET_DB:undefined},
  {GUARDIAN_QA_BUDGET_DB:{prepare:null}},
  {GUARDIAN_QA_BUDGET_DB:{prepare:()=>({})}},
  {GUARDIAN_QA_BUDGET_DB:{prepare:()=>({bind:()=>({first:async()=>{throw Error(fakeId)}})})}},
  {GUARDIAN_QA_BUDGET_DB:{prepare:()=>({bind:()=>({first:async()=>({used:13})})})}}
 ];
 for(const patch of replacements){
  const res=await qaFixtureRequest(req(),{...env,...patch},{fetcher:async()=>{
   calls++;throw Error('never');
  }});
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{status:'qa_daily_budget_unavailable'});
 }
 assert.equal(calls,0);
});
test('D1 retorna zero linhas com orçamento esgotado: 429 sem GET',async()=>{
 let calls=0;
 const exhausted={...env,GUARDIAN_QA_BUDGET_DB:{
  prepare:sql=>({bind:(date,limit)=>{
   assert.equal(sql,QA_D1_RESERVE_SQL);
   assert.equal(limit,QA_DAILY_READ_LIMIT);
   return {first:async()=>null};
  }})
 }};
 const res=await qaFixtureRequest(req(),exhausted,{fetcher:async()=>{calls++;throw Error('never');}});
 assert.equal(res.status,429);
 assert.deepEqual(await res.json(),{status:'qa_daily_budget_exhausted'});
 assert.equal(calls,0);
});
test('D1 utiliza dia UTC e orçamento fixo sem aceitar dados da requisição',async()=>{
 const observed=[];
 const store={prepare:sql=>{
  assert.equal(sql,QA_D1_RESERVE_SQL);
  return {bind:(day,limit)=>{
   observed.push({day,limit});
   return {first:async()=>({used:1})};
  }};
 }};
 assert.equal(await reserveQaDailyRead({GUARDIAN_QA_BUDGET_DB:store},
  {clock:()=>Date.parse('2026-10-29T23:59:59Z')}),'allowed');
 assert.equal(await reserveQaDailyRead({GUARDIAN_QA_BUDGET_DB:store},
  {clock:()=>Date.parse('2026-10-30T00:00:00Z')}),'allowed');
 assert.deepEqual(observed,[
  {day:'2026-10-29',limit:12},{day:'2026-10-30',limit:12}
 ]);
});
test('flag desligada, token inválido e limiter 429 não tocam D1',async()=>{
 let d1=0,network=0;
 const db={prepare:()=>{d1++;throw Error('no D1 expected');}};
 const fetcher=async()=>{network++;throw Error('no Firestore expected');};
 assert.equal((await qaFixtureRequest(req(),{
  ...env,GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false',GUARDIAN_QA_BUDGET_DB:db
 },{fetcher})).status,503);
 assert.equal((await qaFixtureRequest(req('Bearer malformed'),{
  ...env,GUARDIAN_QA_BUDGET_DB:db
 },{fetcher})).status,401);
 assert.equal((await qaFixtureRequest(req(),{
  ...env,GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>({success:false})},
  GUARDIAN_QA_BUDGET_DB:db
 },{fetcher})).status,429);
 assert.equal(d1,0);assert.equal(network,0);
});
test('D1 consome um orçamento por tentativa, inclusive falha no Firebase',async()=>{
 const days=new Map();let dbCalls=0,fetches=0;
 const database={prepare:sql=>{
  assert.equal(sql,QA_D1_RESERVE_SQL);
  return {bind:(date,limit)=>({first:async()=>{
   dbCalls++;
   const used=days.get(date)||0;
   if(used>=limit)return null;
   days.set(date,used+1);
   return {used:used+1};
  }})};
 }};
 const cfg={...env,GUARDIAN_QA_BUDGET_DB:database};
 const opts={clock:()=>Date.parse('2026-10-29T14:00:00Z'),
  fetcher:async()=>{fetches++;return new Response('{}',{status:503});}};
 for(let i=0;i<12;i++){
  const res=await qaFixtureRequest(req(),cfg,opts);
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{status:'qa_upstream_http_unavailable'});
 }
 const refused=await qaFixtureRequest(req(),cfg,opts);
 assert.equal(refused.status,429);
 assert.equal(fetches,12);
 assert.equal(dbCalls,13);
 assert.equal(days.get('2026-10-29'),12);
});
