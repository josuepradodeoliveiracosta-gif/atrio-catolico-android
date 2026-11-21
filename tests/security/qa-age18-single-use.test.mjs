import assert from 'node:assert/strict';
import test from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createQaAge18Restoration}
  from '../../firebase/qa-geral-celular/pilot/qa-age18-restoration.mjs';
import {conversationPushIdentity as identity}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';

assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);
assert.equal(process.env.GCLOUD_PROJECT,'demo-atrio-v11');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const app=initializeApp({projectId:'demo-atrio-v11'},'qa-age18-single-use');
const db=getFirestore(app);
const [a,b]=Object.keys(identity.accounts);
const principal='qa-age18-reviewer';
const consumer='qa-age18-consumer';
let time=Date.now();
const service=createQaAge18Restoration({
  db,identity,serverTimestamp:()=>FieldValue.serverTimestamp(),
  now:()=>time,
  authorize:(who,cap)=>who===principal?cap==='manage_age18_restoration':
    who===consumer&&cap==='consume_age18_restoration',
});
const tokenPath=id=>db.doc('qaAge18RestorationAuthorizations/'+id);
const agePath=uid=>db.doc('users/'+uid+'/chatAgeEligibility/current');
const statePath=uid=>db.doc('users/'+uid+'/chatAgeRestorationState/current');
const issue=uid=>service.issue({
  uid,principal,expiresAt:new Date(time+60000),
  reviewExpiresAt:new Date(time+120000),
});
const consume=(uid,tokenId)=>service.consume({uid,tokenId,principal:consumer});
const revoke=(uid,tokenId)=>service.revoke({uid,tokenId,principal});
try {
  await test('credencial sem capacidade não emite, consome nem revoga',async()=>{
    await assert.rejects(service.issue({uid:a,principal:consumer,expiresAt:new Date(time+60000),reviewExpiresAt:new Date(time+120000)}),/operator_forbidden/);
    await assert.rejects(service.consume({uid:a,tokenId:'not_a_valid_token',principal}),/operator_forbidden/);
    await assert.rejects(service.revoke({uid:a,tokenId:'not_a_valid_token',principal:consumer}),/operator_forbidden/);
  });
  await test('autorização válida é consumida exatamente uma vez',async()=>{
    const {tokenId}=await issue(a);
    assert.deepEqual(await consume(a,tokenId),{restored:true});
    assert.equal((await agePath(a).get()).data().status,'eligible');
    assert.equal((await agePath(a).get()).data().minimumAge,18);
    assert.equal((await tokenPath(tokenId).get()).data().status,'consumed');
    await assert.rejects(consume(a,tokenId),/age18_authorization_unavailable/);
    assert.equal((await agePath(a).get()).data().status,'eligible');
  });
  await test('autorização expirada falha fechada',async()=>{
    const {tokenId}=await issue(b);
    time+=60000;
    await assert.rejects(consume(b,tokenId),/age18_authorization_unavailable/);
    assert.equal((await tokenPath(tokenId).get()).data().status,'issued');
    assert.notEqual((await agePath(b).get()).data()?.status,'eligible');
  });
  await test('revogação antes do consumo recusa a autorização',async()=>{
    const {tokenId}=await issue(b);
    await revoke(b,tokenId);
    await assert.rejects(consume(b,tokenId),/age18_authorization_unavailable/);
    assert.notEqual((await agePath(b).get()).data()?.status,'eligible');
  });
  await test('revogação concorrente ao consumo não deixa elegibilidade indevida',async()=>{
    const {tokenId}=await issue(b);
    const results=await Promise.allSettled([consume(b,tokenId),revoke(b,tokenId)]);
    assert.equal(results[1].status,'fulfilled');
    assert.equal((await tokenPath(tokenId).get()).data().status,'revoked');
    assert.notEqual((await agePath(b).get()).data()?.status,'eligible');
    await assert.rejects(consume(b,tokenId),/age18_authorization_unavailable/);
  });
  await test('revogar depois de consumir também invalida a elegibilidade restaurada',async()=>{
    const {tokenId}=await issue(b);
    await consume(b,tokenId);
    assert.equal((await agePath(b).get()).data().status,'eligible');
    await revoke(b,tokenId);
    assert.equal((await agePath(b).get()).data().status,'revoked');
    assert.equal((await statePath(b).get()).data().lastStatus,'revoked');
  });
  await test('revogar outra autorização preserva a referência à restauração ativa',async()=>{
    const active=await issue(b);
    const other=await issue(b);
    await consume(b,active.tokenId);
    await revoke(b,other.tokenId);
    assert.equal((await agePath(b).get()).data().status,'eligible');
    await revoke(b,active.tokenId);
    assert.equal((await agePath(b).get()).data().status,'revoked');
  });
} finally {
  await deleteApp(app);
}
