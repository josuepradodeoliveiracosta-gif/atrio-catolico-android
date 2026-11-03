/** QA only: simulate privileged Guardião review end-to-end with no real Firebase.
 * These fixtures must not use production credentials or network.
 */
import test,{afterEach,before} from 'node:test';
import assert from 'node:assert/strict';
import {handleGuardiaoReview,filterNonReplyRecipientsForDeletion} from './index.js';

const PREFIX='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const ID='guard_'+'a'.repeat(32);
const AT='2026-11-01T12:00:00.123Z';
let service;
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
before(async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify']);
 const binary=await crypto.subtle.exportKey('pkcs8',pair.privateKey);
 service=JSON.stringify({project_id:'atrio-catolico',
  client_email:'qa-guard-review@atrio-catolico.iam.gserviceaccount.com',
  private_key:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(binary).toString('base64')+'\n-----END PRIVATE KEY-----'});
});
const str=v=>({stringValue:v});
function createFixture({adminFrozen=false,ownerFrozen=false,ownerFailed=false,
 actor='moderador',owner='alice',action='confirm'}={}){
 const calls=[],commits=[],ids=[];
 const guard={name:PREFIX+'/guardiao_quarantine/'+ID,updateTime:AT,fields:{
  status:str('held'),ownerUid:str(owner),postId:str('p1'),replyId:str(''),
  targetType:str('post'),targetPath:str(PREFIX+'/posts/p1'),
  originalFields:{mapValue:{fields:{uid:str(owner),body:str('conteudo sintético')}}}
 }};
 const report={name:PREFIX+'/reports/'+ID,updateTime:AT,fields:{
  status:str('pending'),source:str('guardiao'),reporterUid:str('atrio_guardiao'),
  postId:str('p1'),replyId:str('')
 }};
 globalThis.fetch=async(input,options={})=>{
  const url=String(input);
  const method=options.method||'GET';
  calls.push({url,method});
  if(url.startsWith('https://identitytoolkit.googleapis.com/')){
   ids.push(actor);
   return Response.json({users:[{localId:actor,disabled:false}]});
  }
  if(url==='https://oauth2.googleapis.com/token')
   return Response.json({access_token:'qa-only-token',expires_in:3600});
  if(url.endsWith('/admins/'+actor))
   return Response.json({fields:{enabled:{booleanValue:true}}});
  if(url.endsWith('/account_deletion_freeze/'+actor))
   return Response.json(adminFrozen?{fields:{status:str('draining')}}:{},
    {status:adminFrozen?200:404});
  if(url.endsWith('/account_deletion_freeze/'+owner))
   return Response.json(ownerFrozen?{fields:{status:str('draining')}}:{},
    {status:ownerFailed?503:ownerFrozen?200:404});
  if(url.endsWith('/guardiao_quarantine/'+ID))return Response.json(guard);
  if(url.endsWith('/reports/'+ID))return Response.json(report);
  if(url.endsWith(':commit')) {
   assert.equal(method,'POST');
   const payload=JSON.parse(options.body);
   commits.push(payload);
   return Response.json({});
  }
  throw Error('unexpected QA request: '+url);
 };
 const env={GUARDIAO_ENABLED:'true',FIREBASE_WEB_API_KEY:'qa',
  FIREBASE_SERVICE_ACCOUNT_JSON:service};
 const request=new Request('https://test.invalid/moderation/review',{
  method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(120)},
  body:JSON.stringify({action,caseId:ID,note:'Revisão humana fundamentada no contexto.'})
 });
 return {calls,commits,ids,request,env};
}
test('revisor congelado nao acessa o conteudo nem faz commit',async()=>{
 const x=createFixture({adminFrozen:true});
 const response=await handleGuardiaoReview(x.request,x.env);
 assert.equal(response.status,409);
 assert.deepEqual(await response.json(),{status:'account_deletion_in_progress'});
 assert.equal(x.commits.length,0);
 assert.equal(x.calls.some(c=>c.url.includes('/guardiao_quarantine/')),false);
});
test('titular congelado nao pode ser restaurado nem confirmado removido',async()=>{
 for(const action of ['confirm','restore']){
  const x=createFixture({ownerFrozen:true,action});
  const response=await handleGuardiaoReview(x.request,x.env);
  assert.equal(response.status,409);
  assert.equal((await response.json()).status,'account_deletion_in_progress');
  assert.equal(x.commits.length,0);
  assert.ok(x.calls.some(c=>c.url.endsWith('/account_deletion_freeze/alice')));
 }
});
test('falha na consulta do titular impede qualquer commit de revisão',async()=>{
 const x=createFixture({ownerFailed:true});
 const response=await handleGuardiaoReview(x.request,x.env);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:'review_unavailable'});
 assert.equal(x.commits.length,0);
});
test('conta e moderador sem marker permitem apenas revisao condicionada',async()=>{
 const x=createFixture();
 const response=await handleGuardiaoReview(x.request,x.env);
 assert.equal(response.status,200);
 assert.equal((await response.json()).status,'confirmed_removed');
 assert.equal(x.commits.length,1);
 assert.equal(x.commits[0].writes.length,2);
 assert.ok(x.commits[0].writes.every(w=>w.update?.name &&
  w.currentDocument?.updateTime===AT));
 assert.ok(x.calls.some(c=>c.url.endsWith('/account_deletion_freeze/moderador')));
 assert.ok(x.calls.some(c=>c.url.endsWith('/account_deletion_freeze/alice')));
 assert.ok(!x.calls.some(c=>c.url.includes('fcm.googleapis.com')));
});
test('restauracao permitida usa precondicao para conteudo arquivado',async()=>{
 const x=createFixture({action:'restore'});
 const response=await handleGuardiaoReview(x.request,x.env);
 assert.equal(response.status,200);
 assert.equal((await response.json()).status,'restored');
 assert.equal(x.commits.length,1);
 assert.equal(x.commits[0].writes.length,3);
 const [restored]=x.commits[0].writes;
 assert.equal(restored.update.name,PREFIX+'/posts/p1');
 assert.equal(restored.currentDocument.exists,false);
 assert.equal(restored.update.fields.uid.stringValue,'alice');
});
test('UID de titular incorreto recusa revisao em vez de ampliar escopo',async()=>{
 const x=createFixture({owner:'../admins'});
 const response=await handleGuardiaoReview(x.request,x.env);
 assert.equal(response.status,409);
 assert.deepEqual(await response.json(),{status:'inconsistent_case'});
 assert.equal(x.commits.length,0);
});

test('broadcast: fundador congelado nao consome limite D1 nem dispara FCM',async()=>{
 const requests=[];
 globalThis.fetch=async(input,options={})=>{
   const url=String(input);
   requests.push(url);
   if(url.startsWith('https://identitytoolkit.googleapis.com/'))
     return Response.json({users:[{localId:'moderador',disabled:false}]});
   if(url==='https://oauth2.googleapis.com/token')
     return Response.json({access_token:'qa-only',expires_in:3600});
   if(url.endsWith('/admins/moderador'))
     return Response.json({fields:{enabled:{booleanValue:true}}});
   if(url.endsWith('/app_config/founder'))
     return Response.json({fields:{uid:{stringValue:'moderador'}}});
   if(url.endsWith('/account_deletion_freeze/moderador'))
     return Response.json({fields:{status:{stringValue:'draining'}}});
   throw Error('broadcast must not reach external sink');
 };
 const env={PUSH_ENABLED:'true',BROADCAST_ENABLED:'true',
   FIREBASE_WEB_API_KEY:'qa-only',FIREBASE_SERVICE_ACCOUNT_JSON:service,
   PUSH_DB:{prepare(){throw Error('should not consume cooldown')}}};
 const request=new Request('https://test.invalid/broadcast',{method:'POST',
   headers:{Authorization:'Bearer '+'x'.repeat(120)},
   body:JSON.stringify({
     title:'Comunicado sintético',
     body:'Mensagem exclusivamente fictícia para testar o bloqueio seguro.',
     requestId:'c1247c32-96ed-4e36-8e40-223344556677'
   })});
 const result=await (await import('./index.js')).default.fetch(request,env);
 assert.equal(result.status,409);
 assert.deepEqual(await result.json(),{status:'account_deletion_in_progress'});
 assert.ok(!requests.some(x=>x.includes('fcm.googleapis.com')));
});

test('avisos administrativos ignoram destinatarios em exclusao e nao consultam seus dispositivos',async()=>{
 const calls=[];
 globalThis.fetch=async input=>{
  const url=String(input);calls.push(url);
  if(url.endsWith('/account_deletion_freeze/autor')||
     url.endsWith('/account_deletion_freeze/livre'))
   return Response.json({}, {status:404});
  if(url.endsWith('/account_deletion_freeze/apagando'))
   return Response.json({fields:{status:{stringValue:'draining'}}});
  throw Error('consulta fora dos marcadores de exclusao');
 };
 assert.deepEqual(await filterNonReplyRecipientsForDeletion('qa','autor',
  ['apagando','livre','livre','autor']),['livre']);
 assert.ok(!calls.some(url=>url.includes('pushDevices')));
 assert.equal(calls.filter(url=>url.endsWith('/account_deletion_freeze/livre')).length,1);
});

test('emissor de avisos administrativos congelado bloqueia destinatarios antes de consultá-los',async()=>{
 const calls=[];
 globalThis.fetch=async input=>{
  const url=String(input);calls.push(url);
  if(url.endsWith('/account_deletion_freeze/autor'))
   return Response.json({fields:{status:{stringValue:'draining'}}});
  throw Error('nenhum destinatario pode ser consultado depois do freeze');
 };
 assert.deepEqual(await filterNonReplyRecipientsForDeletion('qa','autor',['livre']),[]);
 assert.equal(calls.length,1);
});

test('falha no marcador de qualquer destinatario aborta o evento inteiro sem entrega parcial',async()=>{
 const calls=[];
 globalThis.fetch=async input=>{
  const url=String(input);calls.push(url);
  if(url.endsWith('/account_deletion_freeze/indisponivel'))
   return Response.json({}, {status:503});
  return Response.json({}, {status:404});
 };
 await assert.rejects(()=>filterNonReplyRecipientsForDeletion('qa','autor',
  ['livre','indisponivel']),/Firestore indisponível/);
 assert.ok(!calls.some(url=>url.includes('fcm.googleapis.com')||
  url.includes('pushDevices')));
});

test('ids e capacidade invalidos nao consultam backend administrativo',async()=>{
 let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('nao consultar');};
 for(const list of [['../admin'],Array.from({length:9},(_,i)=>'m'+i)]) {
  await assert.rejects(()=>filterNonReplyRecipientsForDeletion('qa','autor',list),
   /push_privacy_recipient_scope_invalid/);
 }
 await assert.rejects(()=>filterNonReplyRecipientsForDeletion('','autor',['m1']),
  /push_privacy_recipient_scope_invalid/);
 assert.equal(calls,0);
});

test('evento real de selo nao consulta dispositivos nem FCM para destinatario congelado',async()=>{
 const calls=[];
 const documents={
  'admins/revisor':{fields:{enabled:{booleanValue:true}}},
  'badge_requests/membro':{fields:{
   status:{stringValue:'approved'},reviewedBy:{stringValue:'revisor'},
   reviewedAt:{timestampValue:new Date(Date.now()-2000).toISOString()}
  }},
  'account_deletion_freeze/membro':{fields:{status:{stringValue:'draining'}}}
 };
 globalThis.fetch=async (input,options={})=>{
  const url=String(input);calls.push(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/'))
   return Response.json({users:[{localId:'revisor',disabled:false}]});
  if(url==='https://oauth2.googleapis.com/token')
   return Response.json({access_token:'qa-service-token',expires_in:3600});
  if(url.startsWith(PREFIX+'/')){
   const path=decodeURIComponent(new URL(url).pathname).split('/documents/')[1];
   if(documents[path])return Response.json(documents[path]);
   return Response.json({}, {status:404});
  }
  throw Error('FCM ou endpoint externo nao autorizado: '+url);
 };
 const db={prepare(sql){
  assert.match(sql,/^DELETE FROM delivered/);
  return {bind(){return {async run(){return {meta:{changes:0}};}};}};
 }};
 const env={PUSH_ENABLED:'true',PUSH_DB:db,FIREBASE_WEB_API_KEY:'qa-only',
  FIREBASE_SERVICE_ACCOUNT_JSON:service};
 const request=new Request('https://test.invalid/event',{method:'POST',
  headers:{Authorization:'Bearer '+'x'.repeat(120)},
  body:JSON.stringify({type:'badge_result',targetUid:'membro'})});
 const result=await (await import('./index.js')).default.fetch(request,env);
 assert.equal(result.status,202);
 assert.deepEqual(await result.json(),{status:'no_devices_or_duplicate'});
 assert.ok(calls.some(url=>url.endsWith('/account_deletion_freeze/membro')));
 assert.ok(!calls.some(url=>url.includes('/pushDevices')||url.includes('fcm.googleapis.com')));
});


test('congelamento entre consulta de dispositivos e reserva D1 bloqueia FCM',async()=>{
 const calls=[],sqlCalls=[];
 let recipientFreezeChecks=0;
 const now=new Date(Date.now()-2000).toISOString();
 const docsPrefix=PREFIX+'/users/membro/pushDevices';
 const deviceRecord={
  name:docsPrefix+'/qa-device-one',
  updateTime:now,
  fields:{token:{stringValue:'qa-fake-fcm-token-not-real-123456789'},
   updatedAt:{timestampValue:now}}
 };
 globalThis.fetch=async(input,options={})=>{
  const url=String(input);
  calls.push({url,method:options.method||'GET'});
  if(url.startsWith('https://identitytoolkit.googleapis.com/'))
   return Response.json({users:[{localId:'revisor',disabled:false}]});
  if(url==='https://oauth2.googleapis.com/token')
   return Response.json({access_token:'qa-service-token',expires_in:3600});
  if(url.endsWith('/admins/revisor'))
   return Response.json({fields:{enabled:{booleanValue:true}}});
  if(url.endsWith('/badge_requests/membro'))
   return Response.json({fields:{status:{stringValue:'approved'},
    reviewedBy:{stringValue:'revisor'},
    reviewedAt:{timestampValue:now}}});
  if(url.endsWith('/account_deletion_freeze/revisor'))
   return Response.json({}, {status:404});
  if(url.endsWith('/account_deletion_freeze/membro')){
   recipientFreezeChecks++;
   // Initially eligible; after the Worker reads pushDevices,
   // another admin freezes the same synthetic account.
   if(recipientFreezeChecks===1)return Response.json({}, {status:404});
   return Response.json({fields:{state:{stringValue:'frozen'}}});
  }
  if(url.startsWith(docsPrefix+'?pageSize='))
   return Response.json({documents:[deviceRecord]});
  throw Error('late-freeze must prevent any FCM or unapproved HTTP request: '+url);
 };
 const db={prepare(sql){
  sqlCalls.push(sql);
  if(sql.startsWith('DELETE FROM delivered'))return{
   bind(){return {async run(){return {meta:{changes:0}};}};}
  };
  throw Error('late-freeze must prevent D1 reservation');
 }};
 const env={PUSH_ENABLED:'true',PUSH_DB:db,
  FIREBASE_WEB_API_KEY:'qa-only',
  FIREBASE_SERVICE_ACCOUNT_JSON:service};
 const request=new Request('https://test.invalid/event',{
  method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(120)},
  body:JSON.stringify({type:'badge_result',targetUid:'membro'})
 });
 const response=await (await import('./index.js')).default.fetch(request,env);
 assert.equal(response.status,202);
 assert.deepEqual(await response.json(),{status:'no_devices_or_duplicate'});
 assert.equal(recipientFreezeChecks,2);
 assert.ok(calls.some(x=>x.url.startsWith(docsPrefix+'?pageSize=')));
 assert.ok(!calls.some(x=>x.url.includes('fcm.googleapis.com')));
 assert.ok(!sqlCalls.some(sql=>sql.startsWith('INSERT OR IGNORE INTO delivered')));
});

test('erro no segundo marcador após consultar devices bloqueia a entrega',async()=>{
 const calls=[],sqlCalls=[];
 let checks=0;
 const now=new Date(Date.now()-2000).toISOString();
 const devicePath=PREFIX+'/users/membro/pushDevices';
 globalThis.fetch=async(input,options={})=>{
  const url=String(input);calls.push(url);
  if(url.startsWith('https://identitytoolkit.googleapis.com/'))
   return Response.json({users:[{localId:'revisor',disabled:false}]});
  if(url==='https://oauth2.googleapis.com/token')
   return Response.json({access_token:'qa-service-token',expires_in:3600});
  if(url.endsWith('/admins/revisor'))
   return Response.json({fields:{enabled:{booleanValue:true}}});
  if(url.endsWith('/badge_requests/membro'))
   return Response.json({fields:{status:{stringValue:'approved'},
    reviewedBy:{stringValue:'revisor'},reviewedAt:{timestampValue:now}}});
  if(url.endsWith('/account_deletion_freeze/revisor'))
   return Response.json({}, {status:404});
  if(url.endsWith('/account_deletion_freeze/membro')){
   checks++;
   return Response.json({}, {status:checks===1?404:503});
  }
  if(url.startsWith(devicePath+'?pageSize='))
   return Response.json({documents:[{
    name:devicePath+'/qa-device-one',updateTime:now,
    fields:{token:{stringValue:'qa-fcm-token-is-fake-only-123456789'},
     updatedAt:{timestampValue:now}}
   }]});
  throw Error('no external delivery permitted: '+url);
 };
 const db={prepare(sql){
  sqlCalls.push(sql);
  if(sql.startsWith('DELETE FROM delivered'))return{
   bind(){return {async run(){return {meta:{changes:0}};}};}
  };
  throw Error('should not reserve D1 after freeze read error');
 }};
 const env={PUSH_ENABLED:'true',PUSH_DB:db,
  FIREBASE_WEB_API_KEY:'qa-only',
  FIREBASE_SERVICE_ACCOUNT_JSON:service};
 const request=new Request('https://test.invalid/event',{
  method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(120)},
  body:JSON.stringify({type:'badge_result',targetUid:'membro'})
 });
 const response=await (await import('./index.js')).default.fetch(request,env);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:'unavailable'});
 assert.equal(checks,2);
 assert.ok(!calls.some(x=>x.includes('fcm.googleapis.com')));
 assert.ok(!sqlCalls.some(x=>x.startsWith('INSERT OR IGNORE INTO delivered')));
});
