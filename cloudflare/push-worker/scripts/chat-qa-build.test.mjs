import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderQaWorker,renderQaWrangler,renderQaSchema,validateQaIdentity} from './chat-qa-build.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const original=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const qaProject='atrio-catolico-qa-geral';
const qaD1='11111111-2222-4333-8444-555555555555';
const generated=renderQaWorker(original,qaProject);

test('bundle QA contém o projeto segregado sem literal do Firebase oficial',()=>{
  assert.match(generated,/const PROJECT = 'atrio-catolico-qa-geral'/);
  assert.doesNotMatch(generated,/const PROJECT = 'atrio-catolico';/);
  assert.match(generated,/ATRIO_GENERAL_QA_MODE/);
  assert.match(generated,/ATRIO_GENERAL_QA_PROJECT/);
});
test('QA desativa bots, política externa oficial e fila de usuários',()=>{
  assert.doesNotMatch(generated,/from '.\/qa-manual\.js'/);
  assert.doesNotMatch(generated,/email-verification-policy\.mjs/);
  assert.match(generated,/verified === true/);
  assert.match(generated,/for \(const item of batch.messages\) item.ack\(\)/);
});
test('QA só aceita rotas/eventos de chat, grupos e health',()=>{
  assert.match(generated,/qa_route_denied/);
  assert.match(generated,/\['chat_message','group_message'\].includes\(data.type\)/);
  assert.match(generated,/qa_configuration_denied/);
  assert.match(generated,/qa_service_identity_denied/);
});
test('QA exige e-mail do domínio da service account do projeto aprovado',()=>{
  assert.match(generated,/client_email\?\.endsWith\('@' \+ PROJECT \+ '\.iam\.gserviceaccount\.com'\)/);
});
test('produção permanece imutável: fonte de entrada ainda usa projeto oficial',()=>{
  assert.match(original,/const PROJECT = 'atrio-catolico';/);
  assert.match(original,/from '.\/qa-manual.js';/);
});
test('identidade QA rejeita projeto oficial, suspeito ou vazia',()=>{
  for (const p of ['atrio-catolico','', 'prod-atrio','qa/x','abc_qa','qa-atrio-conversas-2026','atrio-catolico-qa-v2']) {
    assert.throws(()=>validateQaIdentity(p,qaD1),/chat_qa_/);
  }
});
test('identidade QA exige D1 diferente do oficial',()=>{
  for (const id of ['', 'invalid','6b04fad3-619a-4cc5-a4b3-d31c3a18e911']) {
    assert.throws(()=>validateQaIdentity(qaProject,id),/chat_qa_/);
  }
});
test('falha fechada diante de mudanças nas âncoras do código original',()=>{
  assert.throws(()=>renderQaWorker(original.replace("const PROJECT = 'atrio-catolico';",
    "const PROJECT = 'outro';"),qaProject),/chat_qa_/);
  assert.throws(()=>renderQaWorker(original.replace('  async queue(batch,env) {',
    '  async queue(messages,env) {'),qaProject),/chat_qa_/);
});
test('configuração de QA não reutiliza nome, projeto, D1 ou switches de produção',()=>{
  const config=renderQaWrangler(qaProject,qaD1);
  assert.match(config,/name = "atrio-qa-geral"/);
  assert.match(config,/PUSH_ENABLED = "false"/);
  assert.match(config,/QA_MANUAL_ENABLED = "false"/);
  assert.match(config,/database_id = "11111111-2222-4333-8444-555555555555"/);
  assert.doesNotMatch(config,/name = "atrio-push"|database_name = "atrio-push-delivery"|6b04fad3-619a-4cc5-a4b3-d31c3a18e911/);
});
test('worker QA bloqueia por padrão, antes de acessar banco ou Firebase',async()=>{
  const workerModule=await import('data:text/javascript;charset=utf-8,' +
    encodeURIComponent(generated));
  const worker=workerModule.default;
  for(const [url,method,env,code] of [
    ['https://qa.example/event','POST',{},503],
    ['https://qa.example/event','POST',
      {ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:'atrio-catolico'},503],
    ['https://qa.example/moderation/event','POST',
      {ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:qaProject},404],
    ['https://qa.example/event','POST',
      {ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:qaProject,
        FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'atrio-catolico'})},503],
    ['https://qa.example/event','POST',
      {ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:qaProject,PUSH_ENABLED:'false'},503]
  ]) {
    const result=await worker.fetch(new Request(url,{method,body:'{}'}),env);
    assert.equal(result.status,code);
  }
});

test('schema QA inclui marcador persistente e tabelas mínimas de entrega',()=>{
  const sql=renderQaSchema(qaProject,qaD1);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS atrio_qa_identity/);
  assert.match(sql,/VALUES \('atrio-qa-geral', 'atrio-catolico-qa-geral'\)/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS delivered/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS push_delivery_stats/);
  assert.doesNotMatch(sql,/guardiao_ai_budget|atrio-push-delivery|6b04fad3-619a-4cc5-a4b3-d31c3a18e911/);
});
test('schema QA recusa D1 oficial antes de gerar comandos SQL',()=>{
  assert.throws(()=>renderQaSchema(qaProject,
    '6b04fad3-619a-4cc5-a4b3-d31c3a18e911'),/chat_qa_/);
});
test('Worker QA recusa D1 incorreto, ausente ou sem tabela antes de Auth e Firestore',async()=>{
  const workerModule=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated));
  const worker=workerModule.default;
  const base={ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:qaProject,
    PUSH_ENABLED:'false'};
  for(const db of [
    undefined, {},
    {prepare:()=>({bind:()=>({first:async()=>null})})},
    {prepare:()=>({bind:()=>({first:async()=>({project_id:'atrio-catolico'})})})},
    {prepare:()=>({bind:()=>({first:async()=>{throw Error('no_table')}})})}
  ]) {
    const result=await worker.fetch(new Request('https://qa.example/health'),
      {...base,PUSH_DB:db});
    assert.equal(result.status,503);
    assert.equal((await result.json()).status,'qa_d1_identity_denied');
  }
});
test('D1 QA correto libera apenas health desativado; não autoriza envio sem segredos',async()=>{
  let lookups=0;
  const db={prepare:(query)=>{
    assert.match(query,/atrio_qa_identity/);
    lookups++;
    return {bind:(name)=>{
      assert.equal(name,'atrio-qa-geral');
      return {first:async()=>({project_id:qaProject})};
    }};
  }};
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const env={ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:qaProject,
    PUSH_ENABLED:'false',PUSH_DB:db};
  const health=await worker.fetch(new Request('https://qa.example/health'),env);
  assert.equal(health.status,200);
  assert.equal((await health.json()).status,'disabled');
  const event=await worker.fetch(new Request('https://qa.example/event',{
    method:'POST',body:JSON.stringify({type:'chat_message',chatId:'c1',messageId:'m1'})
  }),env);
  assert.equal(event.status,503);
  assert.equal((await event.json()).status,'disabled');
  assert.equal(lookups,2);
});

test('Worker QA rejeita JWT de outro projeto antes de acessar Firebase',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const {verifyIdentity}=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated));
  const previousFetch=globalThis.fetch;
  let remoteCalls=0;
  globalThis.fetch=async()=>{remoteCalls++;throw Error('rede não autorizada')};
  const fakeJwt=(aud,iss)=>{
    const b64=s=>Buffer.from(JSON.stringify(s)).toString('base64url');
    return b64({alg:'RS256',typ:'JWT'})+'.'+b64({
      aud,iss,sub:'qa_user',iat:1762621200,exp:1762624800
    })+'.'+'a'.repeat(120);
  };
  const req=jwt=>new Request('https://qa.example/event',
    {headers:{Authorization:'Bearer '+jwt}});
  try {
    const qaIssuer='https://securetoken.google.com/'+qaProject;
    for(const token of [
      fakeJwt('atrio-catolico','https://securetoken.google.com/atrio-catolico'),
      fakeJwt(qaProject,'https://securetoken.google.com/atrio-catolico'),
      fakeJwt('atrio-catolico',qaIssuer),
      'z'.repeat(160),
      'a'.repeat(160)+'.x.y'
    ]) {
      assert.equal(await verifyIdentity(req(token),{FIREBASE_WEB_API_KEY:'fake-qa-key'}),null);
    }
    assert.equal(remoteCalls,0);
    assert.equal(typeof worker.fetch,'function');
  } finally {globalThis.fetch=previousFetch;}
});
test('token do projeto QA continua exigindo confirmação do Firebase Auth',async()=>{
  const {verifyIdentity}=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated));
  const b64=s=>Buffer.from(JSON.stringify(s)).toString('base64url');
  const token=b64({alg:'RS256',typ:'JWT'})+'.'+b64({
    aud:qaProject,iss:'https://securetoken.google.com/'+qaProject,
    sub:'qa_user',iat:1762621200,exp:1762624800
  })+'.'+'a'.repeat(120);
  const savedFetch=globalThis.fetch;
  let lookupCalls=0;
  globalThis.fetch=async(url,options)=>{
    assert.match(String(url),/^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:lookup\?key=/);
    assert.match(options.body,/"idToken"/);
    lookupCalls++;
    return new Response(JSON.stringify({users:[{localId:'qa_user',emailVerified:true}]}),
      {status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    const result=await verifyIdentity(new Request('https://qa.example/event',
      {headers:{Authorization:'Bearer '+token}}),{FIREBASE_WEB_API_KEY:'fake-qa-key'});
    assert.equal(result,'qa_user');
    assert.equal(lookupCalls,1);
  } finally {globalThis.fetch=savedFetch;}
});

test('QA geral mantem outros modulos bloqueados',()=>{
  const cfg=renderQaWrangler(qaProject,qaD1);
  assert.match(cfg,/name = "atrio-qa-geral"/);
  assert.match(cfg,/database_name = "atrio-qa-geral-db"/);
  assert.ok(generated.includes("!['chat_message','group_message'].includes(data.type)"));
});
