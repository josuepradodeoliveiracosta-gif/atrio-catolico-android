/** QA only: simulate privileged Guardião review end-to-end with no real Firebase.
 * These fixtures must not use production credentials or network.
 */
import test,{afterEach,before} from 'node:test';
import assert from 'node:assert/strict';
import {handleGuardiaoReview} from './index.js';

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
