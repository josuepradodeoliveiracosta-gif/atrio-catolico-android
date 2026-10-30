import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guardianProductionIdentityApproved,token} from './firestore.js';

// All identities/keys in this file are fake and never sent to Google.
const email='guardian-v2-moderator@atrio-catolico.iam.gserviceaccount.com';
const env={
 GUARDIAN_FIREBASE_PROJECT_ID:'atrio-catolico',
 GUARDIAN_V2_TEST_MODE:'false',
 GUARDIAN_V2_PRODUCTION_APPROVED:'true',
 GUARDIAN_V2_IDENTITY_APPROVED:'true',
 GUARDIAN_V2_SERVICE_ACCOUNT_EMAIL:email
};
const service={
 type:'service_account',project_id:'atrio-catolico',client_email:email,
 token_uri:'https://oauth2.googleapis.com/token',
 private_key_id:'a'.repeat(40),
 private_key:'-----BEGIN PRIVATE KEY-----\nFAKE_TEST_ONLY\n-----END PRIVATE KEY-----'
};
test('identidade exata e três travas de produção; nenhuma ação externa',()=>{
 assert.equal(guardianProductionIdentityApproved(env,service),true);
 for(const patch of [
  {GUARDIAN_V2_PRODUCTION_APPROVED:'false'},
  {GUARDIAN_V2_IDENTITY_APPROVED:'false'},
  {GUARDIAN_V2_TEST_MODE:'true'},
  {GUARDIAN_FIREBASE_PROJECT_ID:'atrio-catolico-qa-v2'},
  {GUARDIAN_V2_SERVICE_ACCOUNT_EMAIL:'owner@atrio-catolico.iam.gserviceaccount.com'},
  {GUARDIAN_V2_SERVICE_ACCOUNT_EMAIL:'guardian-v2-moderator@atrio-catolico-qa-v2.iam.gserviceaccount.com'}
 ])assert.equal(guardianProductionIdentityApproved({...env,...patch},service),false);
});
test('bloqueia credencial de outro projeto, usuário de app, ou conta ampla',()=>{
 const bad=[
  {project_id:'atrio-catolico-qa-v2'},
  {client_email:'firebase-adminsdk@atrio-catolico.iam.gserviceaccount.com'},
  {client_email:'guardian-v2-moderator@atrio-catolico-qa-v2.iam.gserviceaccount.com'},
  {type:'authorized_user'},
  {type:'external_account'},
  {token_uri:'https://fake.example.invalid/oauth'},
  {private_key_id:'not-a-real-key-id'},
  {private_key:''}
 ];
 for(const patch of bad)
  assert.equal(guardianProductionIdentityApproved(env,{...service,...patch}),false,JSON.stringify(Object.keys(patch)));
});
test('a aprovação isolada não consegue solicitar OAuth nem acionar Firebase',async()=>{
 const request={...env,GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(service)};
 const original=globalThis.fetch;
 let external=0;
 globalThis.fetch=async()=>{external++;throw Error('must not fetch');};
 try{
  for(const patch of [
   {GUARDIAN_V2_PRODUCTION_APPROVED:'false'},
   {GUARDIAN_V2_IDENTITY_APPROVED:'false'},
   {GUARDIAN_V2_TEST_MODE:'true'},
   {GUARDIAN_V2_SERVICE_ACCOUNT_EMAIL:'owner@atrio-catolico.iam.gserviceaccount.com'},
   {GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({...service,project_id:'atrio-catolico-qa-v2'})},
   {GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({...service,client_email:'owner@atrio-catolico.iam.gserviceaccount.com'})}
  ])await assert.rejects(token({...request,...patch}),/not_approved/);
  assert.equal(external,0);
 }finally{globalThis.fetch=original;}
});
test('sem segredo, acesso de produção continua bloqueado mesmo com flags ligadas',async()=>{
 await assert.rejects(token(env),/identity_not_approved/);
 assert.equal(guardianProductionIdentityApproved(env,null),false);
});

// Positive structural validation of legacy JSON is not authorization to use it.
// Even a fully approved service account must NEVER sign a production OAuth JWT.
test('produção bloqueia chave privada permanente mesmo com aprovações completas',async()=>{
 const request={...env,GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(service)};
 assert.equal(guardianProductionIdentityApproved(request,service),true);
 const original=globalThis.fetch;
 let outbound=0;
 globalThis.fetch=async()=>{outbound++;throw Error('unexpected_external_request');};
 try{
  await assert.rejects(token(request),/production_key_auth_disabled/);
  assert.equal(outbound,0,'no OAuth, metadata, Firestore or network requests');
 }finally{globalThis.fetch=original;}
});
