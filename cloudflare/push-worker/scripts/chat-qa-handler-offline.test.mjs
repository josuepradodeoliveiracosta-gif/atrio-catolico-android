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

function makeScenario(type,change) {
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
    'chats/'+chatId:makeDoc({requesterUid:uid,recipientUid:recipient,
      status:'accepted',initialId:'m1'}),
    'chat_groups/'+groupId:makeDoc({status:'active',memberUids:[uid,recipient]}),
    [messagePath]:messageDoc(),
    'users/'+uid+'/chatAgeEligibility/current':age(),
    'users/'+recipient+'/chatAgeEligibility/current':age(),
    'users/'+uid+'/chatGroupAccess/eligibility':groupPermission(),
    'users/'+recipient+'/chatGroupAccess/eligibility':groupPermission()
  };
  const event=group
    ?{type:'group_message',groupId,messageId}
    :{type:'chat_message',chatId,messageId};
  let sawDevices=false,markerWrites=0,fcmCalls=0,firestoreReads=0,authCalls=0;
  const stat={get sawDevices(){return sawDevices;},
    get markerWrites(){return markerWrites;},get fcmCalls(){return fcmCalls;},
    get firestoreReads(){return firestoreReads;},get authCalls(){return authCalls;}};
  const db={prepare(sql){
    if(sql.includes('atrio_qa_identity'))
      return {bind(name){
        assert.equal(name,'atrio-qa-geral');
        return {first:async()=>({project_id:project})};
      }};
    if(sql.startsWith('DELETE FROM delivered'))
      return {bind(){return {run:async()=>({meta:{changes:0}})}}};
    if(sql.startsWith('INSERT OR IGNORE INTO delivered'))
      return {bind(){return {run:async()=>{
        markerWrites++;
        return {meta:{changes:1}};
      }}}};
    if(sql.startsWith('INSERT INTO push_delivery_stats'))
      return {bind(){return {run:async()=>({meta:{changes:1}})}}};
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
      return okJson({name:'offline-synthetic-only'});
    }
    if(target.startsWith(documentRoot)){
      const relative=decodeURIComponent(url.pathname.split('/documents/')[1]||'');
      if(relative==='users/'+recipient+'/pushDevices'){
        sawDevices=true;
        return okJson({documents:[{
          name:'projects/'+project+'/databases/(default)/documents/users/'+
            recipient+'/pushDevices/offline-phone',
          fields:{
            token:{stringValue:'synthetic_fcm_token_1234567890'},
            updatedAt:{timestampValue:recent()}
          },
          updateTime:recent()
        }]});
      }
      firestoreReads++;
      if(sawDevices){
        if(change==='remove_message' && relative===messagePath)
          return okJson({},404);
        if(change==='revoke_age' &&
            relative==='users/'+recipient+'/chatAgeEligibility/current')
          return okJson({},404);
        if(change==='block_contact' &&
            relative==='users/'+recipient+'/blockedMembers/'+uid)
          return okJson(makeDoc({createdAt:recent()}));
        if(change==='disable_chat' && relative==='app_config/conversations')
          return okJson(makeDoc({enabled:false,minorPolicyApproved:true,
            safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'}));
        if(change==='remove_membership' && relative==='chat_groups/'+groupId)
          return okJson(makeDoc({status:'active',memberUids:[uid,'chat-charlie']}));
        if(change==='disable_group_push' && relative==='app_config/chat_groups')
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
  return {stat,mockFetch,env,request};
}

test('rota Worker QA completa: revogacao apos busca de dispositivos impede D1 e FCM',async()=>{
  const worker=(await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(generated))).default;
  const originalFetch=globalThis.fetch;
  try{
    for(const [type,change] of [
      ['dm','remove_message'],
      ['dm','revoke_age'],
      ['dm','block_contact'],
      ['dm','disable_chat'],
      ['group','remove_message'],
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
