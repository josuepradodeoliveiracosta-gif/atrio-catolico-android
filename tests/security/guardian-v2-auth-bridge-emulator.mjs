// Pré-lançamento: Firebase Auth + Firestore REST em emuladores locais APENAS.
// A autenticação de produção não é simulada por JWTs assinados: Auth Emulator
// emite tokens sem assinatura. O Worker continua exigindo formato de token real.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
import {qaFixtureRequest} from '../../cloudflare/guardian-worker/src/qa-user-firestore-bridge.js';

const PROJECT='atrio-catolico-qa-v2';
const ROOT='projects/'+PROJECT+'/databases/(default)/documents';
const LIVE='https://firestore.googleapis.com/v1/'+ROOT+'/posts/qa_post_1';
const LOCAL='http://127.0.0.1:8089/v1/'+ROOT;
const AUTH='http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only';
const TEST_BEARER='a'.repeat(20)+'.'+'b'.repeat(40)+'.'+'c'.repeat(60);
const FLAGS={
 GUARDIAN_V2_TEST_MODE:'true',
 GUARDIAN_V2_ENABLED:'false',
 GUARDIAN_V2_HOLD_ENABLED:'false',
 GUARDIAN_V2_QA_SHADOW_READS:'false',
 GUARDIAN_V2_QA_AUTO_DISPATCH:'false',
 GUARDIAN_QA_DISPATCH_READY:'false',
 GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'true', // Apenas injeção local, nunca deploy.
 GUARDIAN_V2_QA_BRIDGE_NOT_BEFORE:new Date(Date.now()-1000).toISOString(),
 GUARDIAN_V2_QA_BRIDGE_EXPIRES_AT:new Date(Date.now()+300000).toISOString(),
 GUARDIAN_V2_QA_READER_PROJECT:PROJECT,
 // Mock in-process: no remote Cloudflare binding and no paid calls.
 GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>({success:true})},
 GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>({success:true})},
 GUARDIAN_QA_BUDGET_DB:{prepare:()=>({bind:()=>({first:async()=>({used:1})})})}
};
const localHost=v=>/^(?:127\.0\.0\.1|localhost):[0-9]+$/.test(v||'');
assert.ok(localHost(process.env.FIRESTORE_EMULATOR_HOST),'Firestore Emulator obrigatório');
assert.ok(localHost(process.env.FIREBASE_AUTH_EMULATOR_HOST),'Auth Emulator obrigatório');
assert.equal(process.env.FIREBASE_PROJECT_ID,PROJECT,'Projeto de teste obrigatório');

const env=await initializeTestEnvironment({
 projectId:PROJECT,
 firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
let count=0;
async function check(name,fn){await fn();console.log('AUTH BRIDGE EMULATOR PASS',++count,name);}
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await setDoc(doc(db,'posts/qa_post_1'),{
   qaFixture:true,uid:'qa-synthetic-user',title:'Dúvida sobre a Missa',
   body:'Como funciona o calendário litúrgico?'
  });
  await setDoc(doc(db,'guardian_config/policy'),{
   enabled:false,allowHold:false,emergencyStop:true
  });
 });
 const response=await fetch(AUTH,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({returnSecureToken:true})});
 assert.equal(response.status,200,'Cadastro exclusivamente no Auth Emulator');
 const account=await response.json();
 assert.ok(typeof account.idToken==='string'&&account.idToken.length>30);
 assert.ok(typeof account.localId==='string'&&account.localId.length>5);
 const emulatorId=account.idToken;

 await check('usuário fictício autenticado consegue ler a fixture pelas regras Firestore',async()=>{
  const r=await fetch(LOCAL+'/posts/qa_post_1',{headers:{Authorization:'Bearer '+emulatorId}});
  assert.equal(r.status,200);
  const fixture=await r.json();
  assert.equal(fixture.name,ROOT+'/posts/qa_post_1');
  assert.equal(fixture.fields?.qaFixture?.booleanValue,true);
 });
 await check('requisição sem login não consegue ler a fixture',async()=>{
  const r=await fetch(LOCAL+'/posts/qa_post_1');
  assert.equal(r.status,403);
 });
 await check('usuário fictício não pode mudar a política administrativa',async()=>{
  const r=await fetch(LOCAL+'/guardian_config/policy?updateMask.fieldPaths=enabled',{
   method:'PATCH',headers:{Authorization:'Bearer '+emulatorId,'content-type':'application/json'},
   body:JSON.stringify({fields:{enabled:{booleanValue:true}}})
  });
  assert.equal(r.status,403);
  let read;
  await env.withSecurityRulesDisabled(async ctx=>{
   read=await getDoc(doc(ctx.firestore(),'guardian_config/policy'));
  });
  assert.ok(read.exists());
  assert.equal(read.data().enabled,false);
 });
 await check('ponte classifica GET autorizado, sem devolver conteúdo nem token',async()=>{
  let calls=0;
  // O emulador emite JWT SEM assinatura. Por isso, este adaptador de teste
  // traduz um Bearer de FORMATO real em token emulado antes do GET local.
  // Não autoriza tokens fictícios na implementação real do Worker.
  const proxy=async(url,options)=>{
   calls++;
   assert.equal(url,LIVE);
   assert.equal(options.method,'GET');
   assert.equal(options.headers.Authorization,'Bearer '+TEST_BEARER);
   assert.equal(options.redirect,'manual');
   return fetch(LOCAL+'/posts/qa_post_1',{
    method:'GET',headers:{...options.headers,Authorization:'Bearer '+emulatorId},
    redirect:'manual',signal:options.signal
   });
  };
  const request=new Request('https://qa.example/qa/firebase-fixture',{
   method:'POST',headers:{Authorization:'Bearer '+TEST_BEARER}
  });
  const result=await qaFixtureRequest(request,FLAGS,{fetcher:proxy});
  assert.equal(calls,1);
  assert.equal(result.status,200);
  const raw=await result.text();
  assert.equal(raw,'{"status":"qa_fixture_clear"}');
  assert.ok(!raw.includes(account.localId));
  assert.ok(!raw.includes('Dúvida'));
  assert.ok(!raw.includes(emulatorId));
 });
 await check('ponte desligada não consulta Firestore',async()=>{
  let calls=0;
  const request=new Request('https://qa.example/qa/firebase-fixture',{
   method:'POST',headers:{Authorization:'Bearer '+TEST_BEARER}
  });
  const result=await qaFixtureRequest(request,{
   ...FLAGS,GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false'
  },{fetcher:async()=>{calls++;throw Error('rede proibida');}});
  assert.equal(result.status,503);
  assert.equal(calls,0);
  assert.deepEqual(await result.json(),{status:'qa_bridge_disabled'});
 });
 console.log('GUARDIAN AUTH + FIRESTORE QA:',count,'PASS; produção intocada');
}finally{await env.cleanup();}
