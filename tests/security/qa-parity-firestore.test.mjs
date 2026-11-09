// COMPOSIÇÃO DE PARIDADE LOCAL. NUNCA CONECTAR AO FIREBASE REAL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,Timestamp}
  from 'firebase/firestore';

const rules=readFileSync('qa-parity.generated.rules','utf8');
if(!rules.includes('BEGIN QA PARITY ADDITIVE') ||
   !rules.includes('END QA PARITY ADDITIVE') ||
   !rules.includes('match /chats/{chatId}') ||
   !rules.includes('match /chat_groups/{groupId}'))
  throw Error('qa_parity_rules_not_generated');
const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules}
});
const alice=env.authenticatedContext('qa-alice',{email_verified:true}).firestore();
const aliceUnverified=env.authenticatedContext('qa-alice',{email_verified:false}).firestore();
const bob=env.authenticatedContext('qa-bob',{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const chat='chats/qa-alice__qa-bob';
const group='chat_groups/qa-private-group';
try {
  await env.clearFirestore();
  // Direitos preexistentes da base versionada: comprova paridade positiva.
  await assertSucceeds(getDoc(doc(guest,'app_config/opening_video')));
  await assertSucceeds(getDoc(doc(alice,'profiles/qa-alice')));
  await assertFails(getDoc(doc(bob,'profiles/qa-alice')));
  await assertFails(setDoc(doc(alice,'admins/qa-alice'),{enabled:true}));
  // Nenhuma configuração de ativação: a inclusão não pode abrir DMs/grupos.
  await assertFails(getDoc(doc(alice,chat)));
  await assertFails(getDoc(doc(alice,group)));
  const future=Timestamp.fromDate(new Date('2035-01-01T00:00:00Z'));
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'app_config/conversations'),{
      enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1'
    });
    await setDoc(doc(db,'app_config/chat_groups'),{
      enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
    });
    await setDoc(doc(db,'users/qa-alice/chatGroupAccess/eligibility'),{
      status:'approved',policyVersion:'2026-11-group-safety-v1',
      reviewExpiresAt:future
    });
    await setDoc(doc(db,chat),{
      participants:['qa-alice','qa-bob'],requesterUid:'qa-alice',
      recipientUid:'qa-bob',status:'accepted'
    });
    await setDoc(doc(db,group),{
      ownerUid:'qa-alice',memberUids:['qa-alice'],adminUids:['qa-alice'],
      status:'active'
    });
  });
  // Controle positivo: regras experimentais funcionam APENAS em fixtures.
  await assertSucceeds(getDoc(doc(alice,chat)));
  await assertSucceeds(getDoc(doc(alice,group)));
  await assertFails(getDoc(doc(aliceUnverified,chat)));
  await assertFails(getDoc(doc(aliceUnverified,group)));
  await assertFails(getDoc(doc(bob,group)));

  // Um único gate desligado precisa negar mesmo o histórico existente.
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
      enabled:false,version:'2026-11-v1',minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1'
    });
  });
  await assertFails(getDoc(doc(alice,chat)));
  await assertFails(getDoc(doc(alice,group)));
  // A rota pública legada continua legível: não é um falso negativo global.
  await assertSucceeds(getDoc(doc(guest,'app_config/opening_video')));
  console.log('Paridade QA: controles legados e gates de chat/grupo OK (EMULATOR).');
}finally {
  await env.cleanup();
}
