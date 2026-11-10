// Teste da ROTA /event do Worker QA inteiramente em memoria.
// Sem token, conta, D1, HTTP ou FCM reais. Nunca publicar o Worker neste teste.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
import {renderQaWorker} from './chat-qa-build.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const production=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const project='atrio-catolico-qa-geral';
const generated=renderQaWorker(production,project);
const documentRoot='https://firestore.googleapis.com/v1/projects/'+project+
  '/databases/(default)/documents/';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const service={
  project_id:project,
  client_email:'qa-offline@'+project+'.iam.gserviceaccount.com',
  private_key:privateKey.export({type:'pkcs8',format:'pem'})
};
const uid='chat-alice',recipient='chat-bob';
const future=()=>new Date(Date.now()+86_400_000).toISOString();
const recent=()=>new Date(Date.now()-1_000).toISOString();
const makeDoc=(fields)=>({fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>{
  if(typeof v==='boolean')return [k,{booleanValue:v}];
  if(k==='minimumAge')return [k,{integerValue:String(v)}];
  if(k.endsWith('At'))return [k,{timestampValue:v}];
  if(Array.isArray(v))return [k,{arrayValue:{values:v.map(x=>({stringValue:x}))}}];
  return [k,{stringValue:v}];
}))});
const age=()=>makeDoc({status:'eligible',minimumAge:18,
  policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:future()});
const groupPermission=()=>makeDoc({status:'approved',
  policyVersion:'2026-11-group-safety-v1',reviewExpiresAt:future()});
const chatConfig=()=>makeDoc({enabled:true,minorPolicyApproved:true,
  safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'});
const groupConfig=()=>makeDoc({enabled:true,pushEnabled:true,
  minorPolicyApproved:true,version:'2026-11-groups-v1'});
const jwtB64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const fakeJwt=()=>{
  const now=Math.floor(Date.now()/1000);
  return jwtB64({alg:'RS256',typ:'JWT'})+'.'+jwtB64({
    aud:project,iss:'https://securetoken.google.com/'+project,
    sub:uid,iat:now-5,exp:now+3000
  })+'.'+'a'.repeat(120);
};
const okJson=(value,status=200)=>new Response(JSON.stringify(value),
  {status,headers:{'Content-Type':'application/json'}});
const messageDoc=()=>makeDoc({uid,kind:'text',createdAt:recent()});

function makeScenario(type,change,deviceCount=1) {
  assert.ok(Number.isInteger(deviceCount) && deviceCount>=1 && deviceCount<=3);
  const group=type==='group';
  const chatId='chat-alice__chat-bob';
  const groupId='grp-qa';
  const messageId='m2';
  const messagePath=group
    ?'chat_groups/'+groupId+'/messages/'+messageId
    :'chats/'+chatId+'/messages/'+messageId;
  const docs={
    'app_config/conversations':chatConfig(),
    'app_config/chat_groups':groupConfig(),
    ['chats/'+chatId]:makeDoc({requesterUid:uid,recipientUid:recipient,
      status:'accepted',initialId:'m1'}),
    ['chat_groups/'+groupId]:makeDoc({status:'active',memberUids:[uid,recipient]}),
    [messagePath]:messageDoc(),
    ['users/'+uid+'/chatAgeEligibility/current']:age(),
    ['users/'+recipient+'/chatAgeEligibility/current']:age(),
    ['users/'+uid+'/chatGroupAccess/eligibility']:groupPermission(),
    ['users/'+recipient+'/chatGroupAccess/eligibility']:groupPermission()
  };
  const event=group
    ?{type:'group_message',groupId,messageId}
    :{type:'chat_message',chatId,messageId};
  let sawDevices=false,markerWrites=0,fcmCalls=0,firestoreReads=0,authCalls=0;
  let currentChange=change;
  const auditOutcomes=[];
  const insertedMarkers=new Set(); // D1 sintetico retido entre chamadas
  const stat={get sawDevices(){return sawDevices;},
    get markerWrites(){return markerWrites;},get fcmCalls(){return fcmCalls;},
    get uniqueMarkers(){return insertedMarkers.size;},
    get firestoreReads(){return firestoreReads;},get authCalls(){return authCalls;},
    get auditOutcomes(){return auditOutcomes.map(item=>({...item}));}};
  const db={prepare(sql){
    if(sql.includes('atrio_qa_identity'))
      return {bind(name){
        assert.equal(name,'atrio-qa-geral');
        return {first:async()=>({project_id:project})};
      }};
    if(sql.startsWith('DELETE FROM delivered'))
      return {bind(){return {run:async()=>({meta:{changes:0}})}}};
    if(sql.startsWith('INSERT OR IGNORE INTO delivered'))
      return {bind(marker){return {run:async()=>{
        assert.ok(typeof marker==='string' && marker.endsWith(':'+recipient));
        markerWrites++;
        if(insertedMarkers.has(marker)) return {meta:{changes:0}};
        insertedMarkers.add(marker);
        return {meta:{changes:1}};
      }}}};
    if(sql.startsWith('INSERT INTO push_delivery_stats'))
      return {bind(_hour,kind,outcome,http,attempted,accepted){
        auditOutcomes.push({kind,outcome,http,attempted,accepted});
        return {run:async()=>({meta:{changes:1}})};
      }};
    throw Error('Unexpected QA D1 SQL: '+sql.slice(0,75));
  }};
  const mockFetch=async(input,options={})=>{
    const target=String(input);
    const url=new URL(target);
    if(url.origin==='https://identitytoolkit.googleapis.com' &&
        url.pathname==='/v1/accounts:lookup'){
      authCalls++;
      assert.equal(JSON.parse(options.body).idToken,fakeToken);
      return okJson({users:[{localId:uid,emailVerified:true}]});
    }
    if(url.origin==='https://oauth2.googleapis.com' &&
        url.pathname==='/token'){
      assert.match(String(options.body),/grant_type=/);
      return okJson({access_token:'offline-qa-service-token',expires_in:3600});
    }
    if(url.origin==='https://fcm.googleapis.com'){
      fcmCalls++;
      assert.equal(url.pathname,'/v1/projects/'+project+'/messages:send');
      assert.equal(JSON.parse(options.body).message.data.kind,event.type);
      if(currentChange==='fcm_transport_error' ||
          (currentChange==='fcm_second_transport_error' && fcmCalls===2))
        throw Error('synthetic_network_exception_no_provider_receipt');
      if(currentChange==='fcm_failure' ||
          (currentChange==='fcm_second_failure' && fcmCalls===2))
        return okJson({error:{status:'UNAVAILABLE'}},503);
      if(currentChange==='fcm_second_rate_limited' && fcmCalls===2)
        return okJson({error:{status:'RESOURCE_EXHAUSTED'}},429);
      return okJson({name:'offline-synthetic-only'});
    }
    if(target.startsWith(documentRoot)){
      const relative=decodeURIComponent(url.pathname.split('/documents/')[1]||'');
      if(relative==='users/'+recipient+'/pushDevices'){
        sawDevices=true;
        return okJson({documents:Array.from({length:deviceCount},(_,i)=>({
          name:'projects/'+project+'/databases/(default)/documents/users/'+
            recipient+'/pushDevices/offline-phone-'+i,
          fields:{
            token:{stringValue:'synthetic_fcm_token_1234567890_'+i},
            updatedAt:{timestampValue:recent()}
          },
          updateTime:recent()
        }))});
      }
      firestoreReads++;
      if(fcmCalls>0 && sawDevices){
        if(currentChange==='after_first_revoke_age' &&
            relative==='users/'+recipient+'/chatAgeEligibility/current')
          return okJson({},404);
        if(currentChange==='after_first_block' &&
            relative==='users/'+recipient+'/blockedMembers/'+uid)
          return okJson(makeDoc({createdAt:recent()}));
        if(currentChange==='after_first_disable_chat' &&
            relative==='app_config/conversations')
          return okJson(makeDoc({enabled:false,minorPolicyApproved:true,
            safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'}));
        if(currentChange==='after_first_soft_delete' && relative===messagePath)
          return okJson(makeDoc({uid,kind:'text',createdAt:recent(),
            deletedForAll:true,deletedAt:recent(),text:'[Mensagem removida]'}));
        if(currentChange==='after_first_remove_membership' &&
            relative==='chat_groups/'+groupId)
          return okJson(makeDoc({status:'active',memberUids:[uid,'chat-charlie']}));
        if(currentChange==='after_first_disable_group_push' &&
            relative==='app_config/chat_groups')
          return okJson(makeDoc({enabled:true,pushEnabled:false,
            minorPolicyApproved:true,version:'2026-11-groups-v1'}));
        if(currentChange==='after_first_mute' &&
            (relative==='users/'+recipient+'/chatBox/'+chatId ||
             relative==='users/'+recipient+'/chatGroupBox/'+groupId))
          return okJson(makeDoc({muted:true}));
      }
      if(sawDevices){
        if(currentChange==='remove_message' && relative===messagePath)
          return okJson({},404);
        // Marcador da operacao 'remover para todos' preserva o documento.
        if(currentChange==='soft_delete_message' && relative===messagePath)
          return okJson(makeDoc({uid,kind:'text',createdAt:recent(),
            text:'[Mensagem removida]',deletedForAll:true,deletedAt:recent()}));
        // Campo injetado e mal tipado deve falhar fechado, nunca virar false.
        if(currentChange==='invalid_delete_flag' && relative===messagePath)
          return okJson(makeDoc({uid,kind:'text',createdAt:recent(),
            text:'[Mensagem removida]',deletedForAll:'true'}));
        if(currentChange==='false_delete_flag' && relative===messagePath)
          return okJson(makeDoc({uid,kind:'text',createdAt:recent(),
            text:'[Mensagem removida]',deletedForAll:false}));
        if(currentChange==='revoke_age' &&
            relative==='users/'+recipient+'/chatAgeEligibility/current')
          return okJson({},404);
        if(currentChange==='block_contact' &&
            relative==='users/'+recipient+'/blockedMembers/'+uid)
          return okJson(makeDoc({createdAt:recent()}));
        if(currentChange==='disable_chat' && relative==='app_config/conversations')
          return okJson(makeDoc({enabled:false,minorPolicyApproved:true,
            safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'}));
        if(currentChange==='remove_membership' && relative==='chat_groups/'+groupId)
          return okJson(makeDoc({status:'active',memberUids:[uid,'chat-charlie']}));
        if(currentChange==='disable_group_push' && relative==='app_config/chat_groups')
          return okJson(makeDoc({enabled:true,pushEnabled:false,
            minorPolicyApproved:true,version:'2026-11-groups-v1'}));
      }
      return docs[relative]?okJson(docs[relative]):okJson({},404);
    }
    throw Error('External network denied in QA test: '+url.origin);
  };
  const fakeToken=fakeJwt();
  const env={
    ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:project,
    PUSH_ENABLED:'true',FIREBASE_WEB_API_KEY:'offline-fake-key',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(service),
    PUSH_DB:db
  };
  const request=()=>new Request('https://offline-qa.example/event',{
    method:'POST',
    headers:{Authorization:'Bearer '+fakeToken,'Content-Type':'application/json'},
    body:JSON.stringify(event)
  });
  return {stat,mockFetch,env,request,setChange(value){currentChange=value;}};
}

test('rota Worker QA completa: revogacao apos busca de dispositivos impede D1 e FCM',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const originalFetch=globalThis.fetch;
  try{
    for(const [type,change] of [
      ['dm','remove_message'],
      ['dm','soft_delete_message'],
      ['dm','invalid_delete_flag'],
      ['dm','false_delete_flag'],
      ['dm','revoke_age'],
      ['dm','block_contact'],
      ['dm','disable_chat'],
      ['group','remove_message'],
      ['group','soft_delete_message'],
      ['group','invalid_delete_flag'],
      ['group','false_delete_flag'],
      ['group','remove_membership'],
      ['group','disable_group_push'],
      ['group','revoke_age']
    ]){
      const scenario=makeScenario(type,change);
      globalThis.fetch=scenario.mockFetch;
      const result=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(result.status,202,type+'/'+change);
      assert.equal((await result.json()).status,'no_devices_or_duplicate',
        type+'/'+change);
      assert.equal(scenario.stat.sawDevices,true,type+'/'+change);
      assert.equal(scenario.stat.authCalls,1,type+'/'+change);
      assert.ok(scenario.stat.firestoreReads>0,type+'/'+change);
      assert.equal(scenario.stat.markerWrites,0,type+'/'+change);
      assert.equal(scenario.stat.fcmCalls,0,type+'/'+change);
    }
  }finally{globalThis.fetch=originalFetch;}
});

test('rota Worker QA completa: controle positivo sintético usa somente projeto QA',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const originalFetch=globalThis.fetch;
  try{
    for(const type of ['dm','group']){
      const scenario=makeScenario(type,'none');
      globalThis.fetch=scenario.mockFetch;
      const result=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(result.status,202,type);
      assert.equal((await result.json()).status,'accepted_by_fcm',type);
      assert.equal(scenario.stat.sawDevices,true);
      assert.equal(scenario.stat.markerWrites,1);
      assert.equal(scenario.stat.fcmCalls,1);
    }
  }finally{globalThis.fetch=originalFetch;}
});


test('rota QA: o mesmo evento nao pode reservar D1 ou enviar FCM duas vezes',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try{
    for(const type of ['dm','group']){
      const scenario=makeScenario(type,'none');
      globalThis.fetch=scenario.mockFetch;
      const first=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(first.status,202,type);
      assert.equal((await first.json()).status,'accepted_by_fcm');
      const duplicate=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(duplicate.status,202,type);
      assert.equal((await duplicate.json()).status,'no_devices_or_duplicate',type);
      assert.equal(scenario.stat.markerWrites,2,'D1 testou duas reservas');
      assert.equal(scenario.stat.uniqueMarkers,1,'D1 aceitou um identificador');
      assert.equal(scenario.stat.fcmCalls,1,'FCM ficticio recebeu um envio');
    }
  }finally{globalThis.fetch=oldFetch;}
});

test('rota QA: recusa nao consome deduplicacao; restauracao permite envio unico',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try{
    for(const [type,revoke] of [['dm','revoke_age'],['group','remove_membership']]){
      const scenario=makeScenario(type,revoke);
      globalThis.fetch=scenario.mockFetch;
      const blocked=await worker.fetch(scenario.request(),scenario.env);
      assert.equal((await blocked.json()).status,'no_devices_or_duplicate',type);
      assert.equal(scenario.stat.markerWrites,0,'Evento negado nao reserva D1');
      assert.equal(scenario.stat.fcmCalls,0,'Evento negado nao envia FCM');
      scenario.setChange('none'); // documento QA ficticio restaurado pelo mock
      const permitted=await worker.fetch(scenario.request(),scenario.env);
      assert.equal((await permitted.json()).status,'accepted_by_fcm',type);
      assert.equal(scenario.stat.uniqueMarkers,1);
      const again=await worker.fetch(scenario.request(),scenario.env);
      assert.equal((await again.json()).status,'no_devices_or_duplicate',type);
      assert.equal(scenario.stat.fcmCalls,1,'Nao repetir apos restauracao');
    }
  }finally{globalThis.fetch=oldFetch;}
});

test('rota QA: falha FCM apos reserva segue at-most-once, sem retry implicito',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try{
    const scenario=makeScenario('dm','fcm_failure');
    globalThis.fetch=scenario.mockFetch;
    const first=await worker.fetch(scenario.request(),scenario.env);
    assert.equal(first.status,503);
    assert.equal((await first.json()).status,'delivery_failed');
    assert.equal(scenario.stat.uniqueMarkers,1);
    assert.equal(scenario.stat.fcmCalls,1);
    scenario.setChange('none');
    const second=await worker.fetch(scenario.request(),scenario.env);
    assert.equal(second.status,202);
    assert.equal((await second.json()).status,'no_devices_or_duplicate');
    assert.equal(scenario.stat.uniqueMarkers,1);
    assert.equal(scenario.stat.fcmCalls,1,
      'Garantia de nao duplicar pode perder notificacao com HTTP 503');
  }finally{globalThis.fetch=oldFetch;}
});

test('QA: FCM parcialmente aceito nao pode retornar sucesso global (DM e grupo)',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try{
    for(const type of ['dm','group']){
      const scenario=makeScenario(type,'fcm_second_failure',2);
      globalThis.fetch=scenario.mockFetch;
      const first=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(first.status,503,type);
      assert.equal((await first.json()).status,'partial_delivery_failed',type);
      assert.equal(scenario.stat.markerWrites,1,type);
      assert.equal(scenario.stat.uniqueMarkers,1,type);
      assert.equal(scenario.stat.fcmCalls,2,type);
      const outcomes=scenario.stat.auditOutcomes;
      assert.deepEqual(outcomes.at(-1),{
        kind:type==='dm'?'chat_message':'group_message',
        outcome:'partial_delivery_failed',http:503,attempted:2,accepted:1
      },type);
      // Nao alterar politica at-most-once: novo POST do mesmo evento
      // nao deve reenviar sequer aos dispositivos que falharam.
      scenario.setChange('none');
      const repeat=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(repeat.status,202,type);
      assert.equal((await repeat.json()).status,'no_devices_or_duplicate',type);
      assert.equal(scenario.stat.uniqueMarkers,1,type);
      assert.equal(scenario.stat.fcmCalls,2,type);
    }
  }finally{globalThis.fetch=oldFetch;}
});

test('QA: retorno 429 apos um aceite e falha parcial, nao um GO',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try{
    const scenario=makeScenario('dm','fcm_second_rate_limited',2);
    globalThis.fetch=scenario.mockFetch;
    const result=await worker.fetch(scenario.request(),scenario.env);
    assert.equal(result.status,503);
    assert.equal((await result.json()).status,'partial_delivery_failed');
    assert.deepEqual(scenario.stat.auditOutcomes.at(-1),{
      kind:'chat_message',outcome:'partial_delivery_failed',
      http:429,attempted:2,accepted:1
    });
    assert.equal(scenario.stat.fcmCalls,2);
  }finally{globalThis.fetch=oldFetch;}
});

test('QA: excecao de transporte apos reservar D1 permanece sem retry inseguro',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try{
    for(const type of ['dm','group']){
      const scenario=makeScenario(type,'fcm_transport_error');
      globalThis.fetch=scenario.mockFetch;
      const first=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(first.status,503,type);
      assert.equal((await first.json()).status,'delivery_transport_unknown',type);
      assert.deepEqual(scenario.stat.auditOutcomes.at(-1),{
        kind:type==='dm'?'chat_message':'group_message',
        outcome:'delivery_transport_unknown',http:0,attempted:1,accepted:0
      },type);
      assert.equal(scenario.stat.uniqueMarkers,1,type);
      assert.equal(scenario.stat.fcmCalls,1,type);
      scenario.setChange('none');
      const repeated=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(repeated.status,202,type);
      assert.equal((await repeated.json()).status,'no_devices_or_duplicate',type);
      assert.equal(scenario.stat.fcmCalls,1,type);
    }
  }finally{globalThis.fetch=oldFetch;}
});

test('QA: excecao no segundo aparelho gera parcial desconhecido sem retry',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try {
    for(const type of ['dm','group']){
      const scenario=makeScenario(type,'fcm_second_transport_error',2);
      globalThis.fetch=scenario.mockFetch;
      const first=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(first.status,503,type);
      assert.equal((await first.json()).status,'partial_delivery_unknown',type);
      assert.deepEqual(scenario.stat.auditOutcomes.at(-1),{
        kind:type==='dm'?'chat_message':'group_message',
        outcome:'partial_delivery_unknown',http:0,attempted:2,accepted:1
      },type);
      assert.equal(scenario.stat.fcmCalls,2,type);
      assert.equal(scenario.stat.uniqueMarkers,1,type);
      scenario.setChange('none');
      const repeated=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(repeated.status,202,type);
      assert.equal((await repeated.json()).status,'no_devices_or_duplicate',type);
      assert.equal(scenario.stat.fcmCalls,2,type);
    }
  } finally { globalThis.fetch=oldFetch; }
});

test('QA: revalidar apos primeiro FCM bloqueia os demais aparelhos',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  const changes=[
    ['dm','after_first_revoke_age'],['dm','after_first_block'],
    ['dm','after_first_disable_chat'],['dm','after_first_soft_delete'],
    ['dm','after_first_mute'],
    ['group','after_first_revoke_age'],['group','after_first_block'],
    ['group','after_first_disable_chat'],['group','after_first_soft_delete'],
    ['group','after_first_remove_membership'],
    ['group','after_first_disable_group_push'],['group','after_first_mute']
  ];
  try{
    for(const [type,change] of changes){
      const scenario=makeScenario(type,change,3);
      globalThis.fetch=scenario.mockFetch;
      const first=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(first.status,503,type+'/'+change);
      assert.equal((await first.json()).status,'authorization_interrupted',
        type+'/'+change);
      assert.equal(scenario.stat.fcmCalls,1,type+'/'+change);
      assert.equal(scenario.stat.uniqueMarkers,1,type+'/'+change);
      assert.deepEqual(scenario.stat.auditOutcomes.at(-1),{
        kind:type==='dm'?'chat_message':'group_message',
        outcome:'authorization_interrupted',http:0,attempted:1,accepted:1
      },type+'/'+change);
      const again=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(again.status,202,type+'/'+change);
      // A nova resolucao pode recusar o evento antes do D1 ('ignored');
      // sem mudança persistida, a reserva anterior impede o replay.
      assert.ok(['ignored','no_devices_or_duplicate'].includes(
        (await again.json()).status),type+'/'+change);
      assert.equal(scenario.stat.fcmCalls,1,'Sem replay de dispositivo revogado');
    }
  } finally { globalThis.fetch=oldFetch; }
});

test('QA: tres aparelhos elegiveis aceitos; replay nao duplica',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try{
    for(const type of ['dm','group']){
      const scenario=makeScenario(type,'none',3);
      globalThis.fetch=scenario.mockFetch;
      const first=await worker.fetch(scenario.request(),scenario.env);
      assert.equal(first.status,202,type);
      assert.equal((await first.json()).status,'accepted_by_fcm',type);
      assert.equal(scenario.stat.fcmCalls,3,type);
      assert.equal(scenario.stat.uniqueMarkers,1,type);
      assert.deepEqual(scenario.stat.auditOutcomes.at(-1),{
        kind:type==='dm'?'chat_message':'group_message',
        outcome:'accepted_by_fcm',http:0,attempted:3,accepted:3
      },type);
      const again=await worker.fetch(scenario.request(),scenario.env);
      assert.equal((await again.json()).status,'no_devices_or_duplicate',type);
      assert.equal(scenario.stat.fcmCalls,3,type);
    }
  } finally { globalThis.fetch=oldFetch; }
});

test('QA: duas chamadas simultaneas compartilham uma reserva D1',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const oldFetch=globalThis.fetch;
  try{
    for(const type of ['dm','group']){
      const scenario=makeScenario(type,'none');
      globalThis.fetch=scenario.mockFetch;
      const results=await Promise.all(
        Array.from({length:6},()=>worker.fetch(scenario.request(),scenario.env))
      );
      const statuses=await Promise.all(results.map(async x=>(await x.json()).status));
      assert.equal(statuses.filter(x=>x==='accepted_by_fcm').length,1,type);
      assert.equal(statuses.filter(x=>x==='no_devices_or_duplicate').length,5,type);
      assert.equal(scenario.stat.markerWrites,6,type);
      assert.equal(scenario.stat.uniqueMarkers,1,type);
      assert.equal(scenario.stat.fcmCalls,1,type);
    }
  } finally { globalThis.fetch=oldFetch; }
});
