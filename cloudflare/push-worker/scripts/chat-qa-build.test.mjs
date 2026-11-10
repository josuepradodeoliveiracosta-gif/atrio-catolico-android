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
test('gerador de push QA exige gate 18+ por remetente e destinatario',()=>{
  assert.match(generated,/qaChatAge18ValidForPush/);
  assert.ok(generated.includes('chatAgeEligibility/current'));
  assert.doesNotMatch(original,/qaChatAge18ValidForPush/);
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
  assert.match(config,/workers_dev = false/);
  assert.match(config,/preview_urls = false/);
  assert.doesNotMatch(config,/workers_dev = true|preview_urls = true/);
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


const qaFuture=()=>new Date(Date.now()+86_400_000).toISOString();
function qaDoc(fields) {
  const entries=Object.entries(fields).map(([key,value])=>{
    if(typeof value==='boolean')return [key,{booleanValue:value}];
    if(key==='minimumAge')return [key,{integerValue:String(value)}];
    if(key.endsWith('At'))return [key,{timestampValue:value}];
    if(Array.isArray(value))return [key,{arrayValue:{values:value.map(v=>({stringValue:v}))}}];
    return [key,{stringValue:value}];
  });
  return {fields:Object.fromEntries(entries)};
}
function qaMockFirestore(docs) {
  globalThis.fetch=async input=>{
    const path=decodeURIComponent(new URL(input).pathname.split('/documents/').slice(1).join('/documents/'));
    return docs[path]
      ?new Response(JSON.stringify(docs[path]),{status:200})
      :new Response('{}',{status:404});
  };
}

test('Worker QA exige prova 18+ individual antes de push privado, inclusive apos revogacao',async()=>{
  const {resolveEvent}=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated));
  const goodAge=()=>qaDoc({status:'eligible',minimumAge:18,
    policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:qaFuture()});
  const standard={
    'app_config/conversations':qaDoc({enabled:true,minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'}),
    'chats/chat-alice__chat-bob':qaDoc({requesterUid:'chat-alice',
      recipientUid:'chat-bob',status:'accepted',initialId:'m1'}),
    'chats/chat-alice__chat-bob/messages/m2':qaDoc({uid:'chat-alice',
      kind:'text',createdAt:new Date(Date.now()-1000).toISOString()}),
    'users/chat-alice/chatAgeEligibility/current':goodAge(),
    'users/chat-bob/chatAgeEligibility/current':goodAge()
  };
  const event={type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'};
  const saved=globalThis.fetch;
  try {
    qaMockFirestore(standard);
    assert.deepEqual((await resolveEvent(event,'chat-alice','fake')).recipients,['chat-bob']);
    for(const invalid of [
      null,
      qaDoc({status:'revoked',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:qaFuture()}),
      qaDoc({status:'eligible',minimumAge:18,policyVersion:'2026-11-16plus-qa-v1',reviewExpiresAt:qaFuture()}),
      qaDoc({status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:new Date(Date.now()-60000).toISOString()}),
      {fields:{...goodAge().fields,cpf:{stringValue:'00000000000'}}},
      {fields:{...goodAge().fields,minimumAge:{stringValue:'18'}}}
    ]) {
      qaMockFirestore({...standard,'users/chat-bob/chatAgeEligibility/current':invalid});
      assert.equal(await resolveEvent(event,'chat-alice','fake'),null);
    }
    qaMockFirestore({...standard,'users/chat-alice/chatAgeEligibility/current':null});
    assert.equal(await resolveEvent(event,'chat-alice','fake'),null);
  } finally {globalThis.fetch=saved;}
});

test('Worker QA filtra push de grupo para destinatarios sem prova 18+ e autor inelegivel',async()=>{
  const {resolveEvent}=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated));
  const goodAge=()=>qaDoc({status:'eligible',minimumAge:18,
    policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:qaFuture()});
  const groupAccess=()=>qaDoc({status:'approved',policyVersion:'2026-11-group-safety-v1',
    reviewExpiresAt:qaFuture()});
  const docs={
    'app_config/conversations':qaDoc({enabled:true,minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'}),
    'app_config/chat_groups':qaDoc({enabled:true,pushEnabled:true,
      minorPolicyApproved:true,version:'2026-11-groups-v1'}),
    'chat_groups/grp-qa':qaDoc({status:'active',
      memberUids:['chat-alice','chat-bob','chat-charlie']}),
    'chat_groups/grp-qa/messages/m3':qaDoc({uid:'chat-alice',kind:'text',
      createdAt:new Date(Date.now()-1000).toISOString()}),
    'users/chat-alice/chatGroupAccess/eligibility':groupAccess(),
    'users/chat-bob/chatGroupAccess/eligibility':groupAccess(),
    'users/chat-charlie/chatGroupAccess/eligibility':groupAccess(),
    'users/chat-alice/chatAgeEligibility/current':goodAge(),
    'users/chat-bob/chatAgeEligibility/current':goodAge(),
    'users/chat-charlie/chatAgeEligibility/current':goodAge()
  };
  const event={type:'group_message',groupId:'grp-qa',messageId:'m3'};
  const saved=globalThis.fetch;
  try {
    qaMockFirestore(docs);
    assert.deepEqual((await resolveEvent(event,'chat-alice','fake')).recipients,
      ['chat-bob','chat-charlie']);
    qaMockFirestore({...docs,'users/chat-bob/chatAgeEligibility/current':null});
    assert.deepEqual((await resolveEvent(event,'chat-alice','fake')).recipients,
      ['chat-charlie']);
    qaMockFirestore({...docs,'users/chat-alice/chatAgeEligibility/current':null});
    assert.equal(await resolveEvent(event,'chat-alice','fake'),null);
  } finally {globalThis.fetch=saved;}
});

test('QA revalida idade apos selecao de destinatarios e antes do despacho',async()=>{
  assert.ok(generated.includes('qaChatPushPreSendAllowed(token,uid,recipient)'));
  const {resolveEvent,qaChatPushPreSendAllowed}=await import(
    'data:text/javascript;charset=utf-8,'+encodeURIComponent(generated));
  const goodAge=()=>qaDoc({status:'eligible',minimumAge:18,
    policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:qaFuture()});
  const base={
    'app_config/conversations':qaDoc({enabled:true,minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'}),
    'chats/chat-alice__chat-bob':qaDoc({
      requesterUid:'chat-alice',recipientUid:'chat-bob',
      status:'accepted',initialId:'m1'
    }),
    'chats/chat-alice__chat-bob/messages/m2':qaDoc({
      uid:'chat-alice',kind:'text',createdAt:new Date(Date.now()-1000).toISOString()
    }),
    'users/chat-alice/chatAgeEligibility/current':goodAge(),
    'users/chat-bob/chatAgeEligibility/current':goodAge()
  };
  const event={type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'};
  const saved=globalThis.fetch;
  try {
    qaMockFirestore(base);
    const selected=await resolveEvent(event,'chat-alice','fake');
    assert.deepEqual(selected.recipients,['chat-bob']);
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),true);
    // A escolha antiga da fila nao pode superar uma revogacao posterior.
    qaMockFirestore({...base,
      'users/chat-bob/chatAgeEligibility/current':qaDoc({
        status:'revoked',minimumAge:18,
        policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:qaFuture()
      })
    });
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),false);
    qaMockFirestore({...base,'users/chat-alice/chatAgeEligibility/current':null});
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),false);
    qaMockFirestore({...base,'users/chat-bob/chatAgeEligibility/current':null});
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),false);
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-alice'),false);
    assert.equal(await qaChatPushPreSendAllowed('fake','../outside','chat-bob'),false);
    globalThis.fetch=async()=>{throw Error('qa-offline-simulated-outage')};
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),false);
  } finally { globalThis.fetch=saved; }
});

test('QA bloqueia aviso de grupo apos saida, revogacao e encerramento antes do FCM',async()=>{
  assert.ok(generated.includes('qaChatPushPreSendAllowed(token,uid,recipient,event.groupId)'));
  const {qaChatPushPreSendAllowed}=await import(
    'data:text/javascript;charset=utf-8,'+encodeURIComponent(generated));
  const age=()=>qaDoc({status:'eligible',minimumAge:18,
    policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:qaFuture()});
  const access=()=>qaDoc({status:'approved',
    policyVersion:'2026-11-group-safety-v1',reviewExpiresAt:qaFuture()});
  const group=()=>qaDoc({status:'active',memberUids:['chat-alice','chat-bob']});
  const base={
    'users/chat-alice/chatAgeEligibility/current':age(),
    'users/chat-bob/chatAgeEligibility/current':age(),
    'users/chat-alice/chatGroupAccess/eligibility':access(),
    'users/chat-bob/chatGroupAccess/eligibility':access(),
    'chat_groups/grp-qa':group()
  };
  const allowed=()=>qaChatPushPreSendAllowed('fake','chat-alice','chat-bob','grp-qa');
  const saved=globalThis.fetch;
  try {
    qaMockFirestore(base);
    assert.equal(await allowed(),true);
    // O envio privado continua usando apenas a prova etaria.
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),true);
    const denied=[
      {'chat_groups/grp-qa':null},
      {'chat_groups/grp-qa':qaDoc({status:'closed',memberUids:['chat-alice','chat-bob']})},
      {'chat_groups/grp-qa':qaDoc({status:'active',memberUids:['chat-alice','chat-charlie']})},
      {'chat_groups/grp-qa':qaDoc({status:'active',memberUids:['chat-bob','chat-charlie']})},
      {'chat_groups/grp-qa':qaDoc({status:'active',memberUids:['chat-alice','chat-bob','chat-bob']})},
      {'users/chat-bob/chatGroupAccess/eligibility':null},
      {'users/chat-alice/chatGroupAccess/eligibility':null},
      {'users/chat-bob/chatGroupAccess/eligibility':qaDoc({status:'revoked',
        policyVersion:'2026-11-group-safety-v1',reviewExpiresAt:qaFuture()})},
      {'users/chat-alice/chatGroupAccess/eligibility':qaDoc({status:'approved',
        policyVersion:'2026-11-group-safety-v1',
        reviewExpiresAt:new Date(Date.now()-60_000).toISOString()})},
      {'users/chat-bob/chatAgeEligibility/current':null}
    ];
    for(const change of denied){
      qaMockFirestore({...base,...change});
      assert.equal(await allowed(),false,JSON.stringify(Object.keys(change)));
    }
    qaMockFirestore(base);
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob','../bad'),false);
    globalThis.fetch=async()=>{throw Error('QA Firestore offline');};
    assert.equal(await allowed(),false);
  } finally {globalThis.fetch=saved;}
});

test('QA revalida bloqueio bilateral apos selecao de aviso privado',async()=>{
  const {resolveEvent,qaChatPushPreSendAllowed}=await import(
    'data:text/javascript;charset=utf-8,'+encodeURIComponent(generated));
  const age=()=>qaDoc({status:'eligible',minimumAge:18,
    policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:qaFuture()});
  const base={
    'app_config/conversations':qaDoc({enabled:true,minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'}),
    'chats/chat-alice__chat-bob':qaDoc({
      requesterUid:'chat-alice',recipientUid:'chat-bob',status:'accepted',initialId:'m1'}),
    'chats/chat-alice__chat-bob/messages/m2':qaDoc({
      uid:'chat-alice',kind:'text',createdAt:new Date(Date.now()-1000).toISOString()}),
    'users/chat-alice/chatAgeEligibility/current':age(),
    'users/chat-bob/chatAgeEligibility/current':age()
  };
  const event={type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'};
  const saved=globalThis.fetch;
  try {
    qaMockFirestore(base);
    assert.deepEqual((await resolveEvent(event,'chat-alice','fake')).recipients,['chat-bob']);
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),true);
    for(const path of [
      'users/chat-alice/blockedMembers/chat-bob',
      'users/chat-bob/blockedMembers/chat-alice'
    ]) {
      qaMockFirestore({...base,[path]:qaDoc({createdAt:qaFuture()})});
      assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),false,
        'Bloqueio novo deve impedir push: '+path);
    }
    qaMockFirestore(base);
    assert.equal(await qaChatPushPreSendAllowed('fake','chat-alice','chat-bob'),true);
  } finally {globalThis.fetch=saved;}
});

test('QA revalida bloqueios e silenciamento de grupo antes de reservar D1',async()=>{
  const {resolveEvent,qaChatPushPreSendAllowed}=await import(
    'data:text/javascript;charset=utf-8,'+encodeURIComponent(generated));
  assert.ok(generated.includes('qaChatPushPreSendAllowed(token,uid,recipient,event.groupId)'));
  const age=()=>qaDoc({status:'eligible',minimumAge:18,
    policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:qaFuture()});
  const access=()=>qaDoc({status:'approved',
    policyVersion:'2026-11-group-safety-v1',reviewExpiresAt:qaFuture()});
  const base={
    'app_config/conversations':qaDoc({enabled:true,minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'}),
    'app_config/chat_groups':qaDoc({enabled:true,pushEnabled:true,
      minorPolicyApproved:true,version:'2026-11-groups-v1'}),
    'chat_groups/grp-qa':qaDoc({status:'active',
      memberUids:['chat-alice','chat-bob']}),
    'chat_groups/grp-qa/messages/m2':qaDoc({uid:'chat-alice',kind:'text',
      createdAt:new Date(Date.now()-1000).toISOString()}),
    'users/chat-alice/chatGroupAccess/eligibility':access(),
    'users/chat-bob/chatGroupAccess/eligibility':access(),
    'users/chat-alice/chatAgeEligibility/current':age(),
    'users/chat-bob/chatAgeEligibility/current':age()
  };
  const event={type:'group_message',groupId:'grp-qa',messageId:'m2'};
  const allowed=()=>qaChatPushPreSendAllowed('fake','chat-alice','chat-bob','grp-qa');
  const saved=globalThis.fetch;
  try {
    qaMockFirestore(base);
    assert.deepEqual((await resolveEvent(event,'chat-alice','fake')).recipients,['chat-bob']);
    assert.equal(await allowed(),true);
    const denied=[
      {'users/chat-alice/blockedMembers/chat-bob':qaDoc({active:true})},
      {'users/chat-bob/blockedMembers/chat-alice':qaDoc({active:true})},
      {'users/chat-bob/chatGroupBox/grp-qa':qaDoc({muted:true})}
    ];
    for(const change of denied){
      qaMockFirestore({...base,...change});
      assert.equal(await allowed(),false,'Revogacao tardia '+Object.keys(change)[0]);
    }
    qaMockFirestore({...base,'users/chat-bob/chatGroupBox/grp-qa':qaDoc({muted:false})});
    assert.equal(await allowed(),true);
    qaMockFirestore(base);
    assert.equal(await allowed(),true);
  } finally {globalThis.fetch=saved;}
});
